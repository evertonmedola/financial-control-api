import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../transactions/entities/transaction.entity';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { Account } from './entities/account.entity';

@Module({
  // Transaction is registered independently (the same precedent as
  // TransfersModule) so AccountsService.remove can count live transactions
  // without importing TransactionsModule/TransactionsService — those modules
  // already import AccountsModule, so importing them back would be circular.
  imports: [TypeOrmModule.forFeature([Account, Transaction])],
  controllers: [AccountsController],
  providers: [AccountsService],
  // Mirrors AuthModule exporting AuthService — ARCHITECTURE.md requires
  // Phase 4's TransactionsModule to inject AccountsService rather than
  // reach into the Account repository directly.
  exports: [AccountsService],
})
export class AccountsModule {}
