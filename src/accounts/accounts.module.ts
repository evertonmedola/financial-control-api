import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { Account } from './entities/account.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Account])],
  controllers: [AccountsController],
  providers: [AccountsService],
  // Mirrors AuthModule exporting AuthService — ARCHITECTURE.md requires
  // Phase 4's TransactionsModule to inject AccountsService rather than
  // reach into the Account repository directly.
  exports: [AccountsService],
})
export class AccountsModule {}
