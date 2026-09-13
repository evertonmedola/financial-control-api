import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateAccountDto } from './dto/create-account.dto';
import { Account } from './entities/account.entity';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
  ) {}

  async create(userId: string, dto: CreateAccountDto): Promise<Account> {
    const account = this.accountsRepository.create({ ...dto, userId });
    return this.accountsRepository.save(account);
  }

  // ARCHITECTURE.md's single write-path for balance mutation — the only
  // method Phase 4's TransactionsService will ever call to change a
  // balance. Not exposed via any controller route in this phase; reserved
  // stub establishes ACCT-04's "no drift" invariant ahead of schedule.
  // Kept `async` (despite no `await`) so the reserved stub's error surfaces
  // as a rejected Promise, matching the real Phase 4 signature callers will
  // depend on.
  // eslint-disable-next-line @typescript-eslint/require-await
  async adjustBalance(
    _userId: string,
    _id: string,
    _delta: string,
  ): Promise<Account> {
    throw new Error('not implemented until Phase 4');
  }
}
