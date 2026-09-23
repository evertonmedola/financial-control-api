import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    // Reports has NO entity of its own (CONTEXT.md's Phase Boundary) — no
    // TypeOrmModule.forFeature() call here, unlike every prior module.
    // AccountsModule is added in 06-02-PLAN.md when net-balance needs it.
    CategoriesModule,
    TransactionsModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  // Nothing imports it back.
  exports: [ReportsService],
})
export class ReportsModule {}
