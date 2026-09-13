import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { Transaction } from './entities/transaction.entity';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    // ARCHITECTURE.md's Transactions <-> Accounts / Transactions <->
    // Categories boundary — direct service injection for cross-service
    // ownership validation and adjustBalance calls, never reaching into
    // another module's repository directly.
    AccountsModule,
    CategoriesModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  // 04-03's TransfersModule does NOT import this module — it imports
  // AccountsModule directly and registers its own
  // TypeOrmModule.forFeature([Transaction]), per D-01's "no categoryId on a
  // transfer" boundary.
  exports: [TransactionsService],
})
export class TransactionsModule {}
