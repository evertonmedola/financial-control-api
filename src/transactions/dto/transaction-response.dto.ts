import { Transaction, TransactionType } from '../entities/transaction.entity';

/**
 * The only shape of a Transaction ever returned to a client. Constructed
 * explicitly from a Transaction entity, field by field — never spreads the
 * entity — so internal columns (e.g. deletedAt, userId) can never leak into
 * a response by accident, mirroring CategoryResponseDto's pattern.
 */
export class TransactionResponseDto {
  id!: string;
  type!: TransactionType;
  amount!: string;
  accountId!: string | null;
  fromAccountId!: string | null;
  toAccountId!: string | null;
  categoryId!: string | null;
  description!: string;
  date!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(transaction: Transaction): TransactionResponseDto {
    const dto = new TransactionResponseDto();
    dto.id = transaction.id;
    dto.type = transaction.type;
    dto.amount = transaction.amount;
    dto.accountId = transaction.accountId;
    dto.fromAccountId = transaction.fromAccountId;
    dto.toAccountId = transaction.toAccountId;
    dto.categoryId = transaction.categoryId;
    dto.description = transaction.description;
    dto.date = transaction.date;
    dto.createdAt = transaction.createdAt;
    dto.updatedAt = transaction.updatedAt;
    return dto;
  }
}
