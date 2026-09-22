import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from '../categories/categories.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { Budget } from './entities/budget.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Budget]),
    // ARCHITECTURE.md's Budgets -> Categories / Budgets -> Transactions
    // read-only dependency direction — import TransactionsModule and call
    // its exported TransactionsService rather than registering a second
    // Transaction repository directly (05-PATTERNS.md discretion note).
    CategoriesModule,
    TransactionsModule,
  ],
  controllers: [BudgetsController],
  providers: [BudgetsService],
  // Nothing in this phase imports it back — only a future Phase 6
  // ReportsModule would.
  exports: [BudgetsService],
})
export class BudgetsModule {}
