import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
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

  // Explicit stable ordering (oldest-first) — repeated calls with no
  // intervening writes must return the same order (edge-probe: ordering).
  async findAll(userId: string): Promise<Account[]> {
    return this.accountsRepository.find({
      where: { userId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
  }

  // 404, never 403, when the account doesn't exist or belongs to another
  // user — mirrors AuthService's generic-error philosophy applied to
  // ownership checks (Pitfall 3, IDOR).
  async findOne(userId: string, id: string): Promise<Account> {
    const account = await this.accountsRepository.findOne({
      where: { id, userId, deletedAt: IsNull() },
    });
    if (!account) {
      throw new NotFoundException();
    }
    return account;
  }

  // Ownership check (findOne) happens before mutation. `dto` can never
  // carry `balance`/`type` — the DTO layer already excludes them (D-02,
  // prohibition P2).
  async update(
    userId: string,
    id: string,
    dto: UpdateAccountDto,
  ): Promise<Account> {
    const account = await this.findOne(userId, id);
    Object.assign(account, dto);
    return this.accountsRepository.save(account);
  }

  // D-03: soft delete only. Never .delete()/.remove() on the repository —
  // Phase 4's transactions table will carry a foreign key to accounts.id.
  async remove(userId: string, id: string): Promise<void> {
    const account = await this.findOne(userId, id);
    account.deletedAt = new Date();
    await this.accountsRepository.save(account);
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
