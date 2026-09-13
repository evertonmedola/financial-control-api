import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CategoryType {
  RECEITA = 'receita',
  DESPESA = 'despesa',
}

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Tenant-scoping column (ARCHITECTURE.md's composite-index guidance for
  // every tenant-scoped table) — indexed so every userId-scoped query
  // (Pitfall 3, IDOR) stays fast as the table grows.
  @Index()
  @Column({ name: 'user_id' })
  userId!: string;

  @Column()
  name!: string;

  @Column({ type: 'enum', enum: CategoryType })
  type!: CategoryType;

  // D-01: soft delete. Created now (even though the DELETE endpoint itself
  // ships in 03-02-PLAN.md) so the migration only needs authoring once —
  // mirrors Account.deletedAt exactly.
  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
