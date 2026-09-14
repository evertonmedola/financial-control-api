import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
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
    // Cheap fail-fast — no DB round-trip for an obviously-invalid request.
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException(
        'fromAccountId e toAccountId não podem ser iguais',
      );
    }

    // Ownership chain validated OUTSIDE the transaction, both legs
    // (Pitfall 3) — a cross-tenant reference on either side 404s before any
    // mutation is attempted.
    await this.accountsService.findOne(userId, dto.fromAccountId);
    await this.accountsService.findOne(userId, dto.toAccountId);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // Ascending-id lock order — the single mechanism that prevents two
      // opposite-direction concurrent transfers between the same account
      // pair from deadlocking each other (Pitfall 2).
      const [firstId, secondId] = [dto.fromAccountId, dto.toAccountId].sort();
      const firstDelta =
        firstId === dto.fromAccountId ? `-${dto.amount}` : dto.amount;
      const secondDelta =
        firstId === dto.fromAccountId ? dto.amount : `-${dto.amount}`;

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
        fromAccountId: dto.fromAccountId,
        toAccountId: dto.toAccountId,
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
}
