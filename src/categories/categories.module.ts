import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { Category } from './entities/category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Category])],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  // Mirrors AccountsModule exporting AccountsService — Phase 4's
  // TransactionsModule and Phase 5's BudgetsModule will inject
  // CategoriesService rather than reach into the repository directly.
  exports: [CategoriesService],
})
export class CategoriesModule {}
