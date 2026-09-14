import { Transaction } from '../../transactions/entities/transaction.entity';

/**
 * The only shape of a Transfer ever returned to a client. Constructed
 * explicitly from a Transaction entity, field by field — never spreads the
 * entity — narrowed to the transfer-relevant fields only (no `type`/
 * `accountId`/`categoryId`, always implicitly TRANSFER/null/null for a row
 * reached through this endpoint). Mirrors TransactionResponseDto's
 * explicit-construction pattern.
 */
export class TransferResponseDto {
  id!: string;
  amount!: string;
  fromAccountId!: string | null;
  toAccountId!: string | null;
  date!: string;
  description!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(transaction: Transaction): TransferResponseDto {
    const dto = new TransferResponseDto();
    dto.id = transaction.id;
    dto.amount = transaction.amount;
    dto.fromAccountId = transaction.fromAccountId;
    dto.toAccountId = transaction.toAccountId;
    dto.date = transaction.date;
    dto.description = transaction.description;
    dto.createdAt = transaction.createdAt;
    dto.updatedAt = transaction.updatedAt;
    return dto;
  }
}
