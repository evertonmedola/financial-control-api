import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AccountType {
  CORRENTE = 'corrente',
  POUPANCA = 'poupanca',
  CARTEIRA = 'carteira',
  CARTAO_CREDITO = 'cartao_credito',
}

@Entity('accounts')
export class Account {
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

  @Column({ type: 'enum', enum: AccountType })
  type!: AccountType;

  // PITFALLS.md Pitfall 1: money is numeric/decimal, never float/double, and
  // never parseFloat'd anywhere in this module. TypeORM/pg return decimal
  // columns as strings — keep this typed `string`, never `number`.
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  balance!: string;

  // D-03: soft delete. Created now (even though the DELETE endpoint itself
  // ships in the next plan) so the migration only needs authoring once.
  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
