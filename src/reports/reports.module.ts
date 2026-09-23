import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    // Reports has NO entity of its own (CONTEXT.md's Phase Boundary) — no
    // TypeOrmModule.forFeature() call here, unlike every prior module.
    // AccountsModule added in 06-02-PLAN.md for GET /reports/net-balance.
    AccountsModule,
    CategoriesModule,
    TransactionsModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  // Nothing imports it back.
  exports: [ReportsService],
})
export class ReportsModule {}
