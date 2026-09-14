import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { CategoriesService } from '../categories/categories.service';
import { negateDecimalString } from '../common/decimal.util';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { Transaction, TransactionType } from './entities/transaction.entity';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly accountsService: AccountsService,
    private readonly categoriesService: CategoriesService,
  ) {}

  // Ownership-chain validation (Pitfall 3) happens OUTSIDE the DB
  // transaction — accountId/categoryId must belong to the authenticated
  // userId before any mutation is attempted; a 404 here never opens/rolls
  // back a QueryRunner transaction. The balance mutation itself
  // (accountsService.adjustBalance) and the transaction row insert both
  // happen inside ONE QueryRunner transaction (ARCHITECTURE.md's single
  // write-path rule) so a failure after the balance update rolls back the
  // whole request.
  async create(
    userId: string,
    dto: CreateTransactionDto,
  ): Promise<Transaction> {
    await this.accountsService.findOne(userId, dto.accountId);
    await this.categoriesService.findOne(userId, dto.categoryId);

    const delta =
      dto.type === TransactionType.EXPENSE ? `-${dto.amount}` : dto.amount;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await this.accountsService.adjustBalance(
        queryRunner.manager,
        userId,
        dto.accountId,
        delta,
      );
      const transaction = queryRunner.manager.create(Transaction, {
        ...dto,
        userId,
        fromAccountId: null,
        toAccountId: null,
      });
      const saved = await queryRunner.manager.save(transaction);
      await queryRunner.commitTransaction();
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // D-09: plain list, no query filters (date-range/account/category
  // filtering is Phase 6 Reports' job, REP-01). D-03: includes ALL types
  // (income/expense/transfer) — do not filter by `type` here. D-10: `date`
  // DESC primary sort with an explicit `createdAt` DESC tiebreak when two
  // rows share the exact same date — repeated calls with no intervening
  // writes must return the same order.
  async findAll(userId: string): Promise<Transaction[]> {
    return this.transactionsRepository.find({
      where: { userId, deletedAt: IsNull() },
      order: { date: 'DESC', createdAt: 'DESC' },
    });
  }

  // The `type: In([INCOME, EXPENSE])` filter is the key architectural
  // decision here: single-record view/update/delete on /transactions/:id is
  // scoped to income/expense rows ONLY — a transfer's id looked up through
  // this method returns 404, exactly as if it didn't exist for this
  // endpoint, forcing all transfer mutation through the dedicated
  // /transfers/:id routes (04-03). This is necessary, not just stylistic:
  // remove()'s single-account reversal logic below would be actively wrong
  // (it reads transaction.accountId, which is null on a transfer row) if a
  // transfer ever reached it — excluding transfers at the query level
  // closes that gap structurally rather than relying on a runtime
  // null-check.
  async findOne(userId: string, id: string): Promise<Transaction> {
    const transaction = await this.transactionsRepository.findOne({
      where: {
        id,
        userId,
        deletedAt: IsNull(),
        type: In([TransactionType.INCOME, TransactionType.EXPENSE]),
      },
    });
    if (!transaction) {
      throw new NotFoundException();
    }
    return transaction;
  }

  // Ownership + type-scope check (findOne) happens before mutation. `dto`
  // can never carry `amount`/`accountId`/`categoryId` — the DTO layer
  // already excludes them (D-04).
  async update(
    userId: string,
    id: string,
    dto: UpdateTransactionDto,
  ): Promise<Transaction> {
    await this.findOne(userId, id); // ownership + type-scope + not-deleted check
    // Scoped partial update (never touches `deletedAt`) instead of
    // load-then-full-save: if a concurrent DELETE soft-deletes this row
    // between the findOne() above and this write, `affected` is 0 and we
    // fail with 404 instead of silently resurrecting the row (CR-01).
    const result = await this.transactionsRepository.update(
      {
        id,
        userId,
        deletedAt: IsNull(),
        type: In([TransactionType.INCOME, TransactionType.EXPENSE]),
      },
      dto,
    );
    if (result.affected === 0) {
      throw new NotFoundException();
    }
    return this.findOne(userId, id);
  }

  // D-06: atomic locked reversal-then-soft-delete. The transaction row
  // itself is pessimistic-locked inside the same QueryRunner transaction
  // that reverses the balance — locking the transaction row (not just the
  // account) is what makes a second concurrent DELETE on the same id
  // resolve to 404 instead of double-reversing: the second call's findOne
  // (same WHERE, same lock) blocks until the first commits, then re-reads
  // with deleted_at IS NULL no longer true, finding nothing.
  async remove(userId: string, id: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const transaction = await queryRunner.manager.findOne(Transaction, {
        where: {
          id,
          userId,
          deletedAt: IsNull(),
          type: In([TransactionType.INCOME, TransactionType.EXPENSE]),
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!transaction) {
        throw new NotFoundException();
      }

      // Exact inverse of what create() applied: income was created as
      // +amount, so reversal is -amount; expense was created as -amount,
      // so reversal is +amount.
      const reversalDelta =
        transaction.type === TransactionType.INCOME
          ? negateDecimalString(transaction.amount)
          : transaction.amount;

      await this.accountsService.adjustBalance(
        queryRunner.manager,
        userId,
        transaction.accountId!,
        reversalDelta,
      );

      transaction.deletedAt = new Date();
      await queryRunner.manager.save(transaction);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
