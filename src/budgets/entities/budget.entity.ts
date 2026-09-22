import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// D-01: standing limit per category — no `month`/`year` columns. This is the
// entire budget shape; it applies to whichever month is being evaluated
// (BudgetsService computes the current calendar month at read time).
@Entity('budgets')
export class Budget {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Tenant-scoping column (ARCHITECTURE.md's composite-index guidance for
  // every tenant-scoped table) — indexed so every userId-scoped query
  // (Pitfall 3, IDOR) stays fast as the table grows.
  @Index()
  @Column({ name: 'user_id' })
  userId!: string;

  // Explicit `type: 'uuid'` required — mirrors Transaction.categoryId: a
  // plain `string` column needs the explicit type or TypeORM's
  // reflect-metadata inference produces DataTypeNotSupportedError.
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  // Pitfall 1: decimal string, never a JS number — mirrors
  // Transaction.amount/Account.balance exactly.
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  limit!: string;

  // D-07: soft delete. Mirrors Account/Category's deletedAt precedent —
  // never a hard-delete.
  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
