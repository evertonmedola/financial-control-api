import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { negateDecimalString } from '../common/decimal.util';
import {
  Transaction,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import { CreateTransferDto } from './dto/create-transfer.dto';

@Injectable()
export class TransfersService {
  constructor(
    // TransfersModule registers its OWN TypeOrmModule.forFeature([Transaction])
    // — the same table Transactions uses, independently injected. No
    // dependency on TransactionsService (D-01: transfers reuse the
    // Transaction row shape, not a separate entity).
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly accountsService: AccountsService,
  ) {}

  // D-01/D-02: a transfer is a single Transaction row with type=TRANSFER,
  // fromAccountId/toAccountId set, accountId/categoryId null. Both accounts
  // must be locked in a FIXED ascending-id order regardless of transfer
  // direction (Pitfall 2) — this is the only locking mechanism needed,
  // since adjustBalance's own pessimistic_write lock does the row-level
  // work.
  async create(userId: string, dto: CreateTransferDto): Promise<Transaction> {
    // Normalize BEFORE any comparison/use: `@IsUUID()` validates format,
    // not canonical casing, and Postgres's `uuid` column compares
    // case-insensitively. Without this, the same account submitted with
    // different casing on each side would pass the `!==` self-transfer
    // guard below, resolve to the same row via accountsService.findOne(),
    // and bypass the business rule (WR-01).
    const fromAccountId = dto.fromAccountId.toLowerCase();
    const toAccountId = dto.toAccountId.toLowerCase();

    // Cheap fail-fast — no DB round-trip for an obviously-invalid request.
    if (fromAccountId === toAccountId) {
      throw new BadRequestException(
        'fromAccountId e toAccountId não podem ser iguais',
      );
    }

    // Ownership chain validated OUTSIDE the transaction, both legs
    // (Pitfall 3) — a cross-tenant reference on either side 404s before any
    // mutation is attempted.
    await this.accountsService.findOne(userId, fromAccountId);
    await this.accountsService.findOne(userId, toAccountId);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // Ascending-id lock order — the single mechanism that prevents two
      // opposite-direction concurrent transfers between the same account
      // pair from deadlocking each other (Pitfall 2).
      const [firstId, secondId] = [fromAccountId, toAccountId].sort();
      const firstDelta =
        firstId === fromAccountId ? `-${dto.amount}` : dto.amount;
      const secondDelta =
        firstId === fromAccountId ? dto.amount : `-${dto.amount}`;

      await this.accountsService.adjustBalance(
        queryRunner.manager,
        userId,
        firstId,
        firstDelta,
      );
      await this.accountsService.adjustBalance(
        queryRunner.manager,
        userId,
        secondId,
        secondDelta,
      );

      const transfer = queryRunner.manager.create(Transaction, {
        type: TransactionType.TRANSFER,
        amount: dto.amount,
        fromAccountId,
        toAccountId,
        date: dto.date,
        description: dto.description,
        userId,
        accountId: null,
        categoryId: null,
      });
      const saved = await queryRunner.manager.save(transfer);
      await queryRunner.commitTransaction();
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // D-06: atomic locked reversal-then-soft-delete, mirroring
  // TransactionsService.remove's pattern but reversing BOTH accounts. The
  // transfer row itself is pessimistic-locked (with `type: TRANSFER` in the
  // WHERE clause — a transaction id looked up here 404s, the symmetric
  // exclusion of TransactionsService.findOne's `type: In([INCOME,
  // EXPENSE])`) inside the same QueryRunner transaction that reverses both
  // balances — a second concurrent DELETE blocks then finds nothing.
  async remove(userId: string, id: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const transfer = await queryRunner.manager.findOne(Transaction, {
        where: {
          id,
          userId,
          deletedAt: IsNull(),
          type: TransactionType.TRANSFER,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!transfer) {
        throw new NotFoundException();
      }

      // Exact inverse of create()'s deltas, still locked in the SAME fixed
      // ascending-id order to avoid deadlocking against a concurrent
      // transfer touching the same account pair: give back to
      // fromAccountId, take back from toAccountId.
      const [firstId, secondId] = [
        transfer.fromAccountId!,
        transfer.toAccountId!,
      ].sort();
      const firstDelta =
        firstId === transfer.fromAccountId
          ? transfer.amount
          : negateDecimalString(transfer.amount);
      const secondDelta =
        firstId === transfer.fromAccountId
          ? negateDecimalString(transfer.amount)
          : transfer.amount;

      await this.accountsService.adjustBalance(
        queryRunner.manager,
        userId,
        firstId,
        firstDelta,
      );
      await this.accountsService.adjustBalance(
        queryRunner.manager,
        userId,
        secondId,
        secondDelta,
      );

      transfer.deletedAt = new Date();
      await queryRunner.manager.save(transfer);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
