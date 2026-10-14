import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import {
  addDecimalStrings,
  isWithinDecimalRange,
  NUMERIC_12_2_MAX_ABS,
} from '../common/decimal.util';
import { Transaction } from '../transactions/entities/transaction.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { Account } from './entities/account.entity';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    // Entity-only dependency, independently registered in AccountsModule
    // (same precedent as TransfersModule) — never TransactionsService, which
    // would make AccountsModule and TransactionsModule circular.
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
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
    await this.findOne(userId, id); // ownership + not-deleted check
    // Scoped partial update (never touches `deletedAt`) instead of
    // load-then-full-save: if a concurrent DELETE soft-deletes this row
    // between the findOne() above and this write, `affected` is 0 and we
    // fail with 404 instead of silently resurrecting the row (WR-02, same
    // race as CR-01).
    const result = await this.accountsRepository.update(
      { id, userId, deletedAt: IsNull() },
      dto,
    );
    if (result.affected === 0) {
      throw new NotFoundException();
    }
    return this.findOne(userId, id);
  }

  // D-03: soft delete only. Never .delete()/.remove() on the repository —
  // Phase 4's transactions table will carry a foreign key to accounts.id.
  //
  // An account that still carries live history cannot be deleted: while at
  // least one non-deleted transaction (deleted_at IS NULL) references the
  // account as account_id (income/expense) or as from_account_id /
  // to_account_id (either side of a transfer), remove() fails with 409.
  // Soft-deleted transactions do not block. Ownership (findOne -> 404) runs
  // BEFORE the count, and the count is scoped by userId too, so the 409 can
  // never be used to probe another user's accounts. The message is static:
  // no id, count, SQL or table name.
  async remove(userId: string, id: string): Promise<void> {
    await this.findOne(userId, id); // ownership + not-deleted check
    const liveTransactions = await this.transactionsRepository.count({
      where: [
        { accountId: id, userId, deletedAt: IsNull() },
        { fromAccountId: id, userId, deletedAt: IsNull() },
        { toAccountId: id, userId, deletedAt: IsNull() },
      ],
    });
    if (liveTransactions > 0) {
      throw new ConflictException(
        'Não é possível excluir a conta: existem transações vinculadas a ela',
      );
    }
    const result = await this.accountsRepository.update(
      { id, userId, deletedAt: IsNull() },
      { deletedAt: new Date() },
    );
    if (result.affected === 0) {
      throw new NotFoundException();
    }
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
    // `balance` is `numeric(12,2)` (1789300000000-CreateAccounts.ts): 12 total
    // digits, 2 after the decimal point, so the representable range is exactly
    // +/-NUMERIC_12_2_MAX_ABS. Checked before save() so an overflow is a
    // controlled 400, not an unhandled Postgres `numeric field overflow`
    // (WR-03).
    const newBalance = addDecimalStrings(account.balance, delta);
    if (!isWithinDecimalRange(newBalance, NUMERIC_12_2_MAX_ABS)) {
      throw new BadRequestException(
        'A operação excede o limite máximo permitido para o saldo da conta',
      );
    }
    account.balance = newBalance;
    return manager.save(account);
  }
}
