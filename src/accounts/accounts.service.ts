import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { addDecimalStrings } from '../common/decimal.util';
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
  // method that may ever change Account.balance. Not exposed via any
  // controller route directly; TransactionsService (and 04-03's
  // TransfersService) are its only callers, always passing their own open
  // QueryRunner transaction's EntityManager so a multi-account mutation
  // (transfer) commits/rolls back atomically as one unit.
  //
  // `manager.findOne` with `lock: { mode: 'pessimistic_write' }` issues a
  // `SELECT ... FOR UPDATE` under the hood, serializing concurrent
  // mutations against the same account row (Pitfall 2) — verified against
  // the installed typeorm@1.1.1 EntityManager/FindOneOptions type
  // declarations.
  //
  // Deliberately no pre-mutation balance-sufficiency check (D-07): expenses
  // and transfers are never blocked for insufficient balance — checking/
  // savings/wallet accounts may go negative, matching real-world overdraft.
  // Also deliberately no credit-limit enforcement (D-08) — there is no
  // `creditLimit` field on Account (out of ACCT-01's scope). Both absences
  // are intentional, not oversights.
  async adjustBalance(
    manager: EntityManager,
    userId: string,
    id: string,
    delta: string,
  ): Promise<Account> {
    const account = await manager.findOne(Account, {
      where: { id, userId, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!account) {
      throw new NotFoundException();
    }
    account.balance = addDecimalStrings(account.balance, delta);
    return manager.save(account);
  }
}
