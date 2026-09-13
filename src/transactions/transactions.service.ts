import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { CategoriesService } from '../categories/categories.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
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
}
