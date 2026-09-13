import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TransactionType {
  INCOME = 'income',
  EXPENSE = 'expense',
  TRANSFER = 'transfer',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Tenant-scoping column (ARCHITECTURE.md's composite-index guidance for
  // every tenant-scoped table) — indexed so every userId-scoped query
  // (Pitfall 3, IDOR) stays fast as the table grows.
  @Index()
  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ type: 'enum', enum: TransactionType })
  type!: TransactionType;

  // PITFALLS.md Pitfall 1: decimal string, never parseFloat'd anywhere —
  // identical precedent to Account.balance.
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount!: string;

  // D-01: mutually exclusive with fromAccountId/toAccountId — set for
  // income/expense rows, null for transfer rows. Explicit `type: 'uuid'` is
  // required here (unlike Account.deletedAt's `Date | null`, which TypeORM
  // can still infer via reflect-metadata) — a `string | null` union reflects
  // as `Object` via design:type, which Postgres rejects with
  // DataTypeNotSupportedError if no explicit column type is given.
  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId!: string | null;

  // D-01: set only for type=TRANSFER.
  @Column({ name: 'from_account_id', type: 'uuid', nullable: true })
  fromAccountId!: string | null;

  // D-01: set only for type=TRANSFER.
  @Column({ name: 'to_account_id', type: 'uuid', nullable: true })
  toAccountId!: string | null;

  // D-01: null for TRANSFER rows — transfers aren't categorized.
  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @Column()
  description!: string;

  @Column({ type: 'date' })
  date!: string;

  // Soft delete, mirroring Account/Category's deletedAt precedent.
  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
