import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from '../accounts/accounts.module';
import { Transaction } from '../transactions/entities/transaction.entity';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [
    // Same table Transactions uses, independently registered/injected — no
    // service-level coupling to TransactionsModule.
    TypeOrmModule.forFeature([Transaction]),
    // Deliberately NOT CategoriesModule — transfers have no category (D-01).
    AccountsModule,
  ],
  controllers: [TransfersController],
  providers: [TransfersService],
  exports: [TransfersService],
})
export class TransfersModule {}
