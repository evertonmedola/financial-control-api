import { ApiProperty } from '@nestjs/swagger';
import { Transaction, TransactionType } from '../entities/transaction.entity';

/**
 * The only shape of a Transaction ever returned to a client. Constructed
 * explicitly from a Transaction entity, field by field — never spreads the
 * entity — so internal columns (e.g. deletedAt, userId) can never leak into
 * a response by accident, mirroring CategoryResponseDto's pattern.
 */
export class TransactionResponseDto {
  @ApiProperty({
    description: 'Unique transaction identifier.',
    format: 'uuid',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  id!: string;

  @ApiProperty({
    description: 'Transaction type.',
    enum: TransactionType,
    enumName: 'TransactionType',
    example: TransactionType.EXPENSE,
  })
  type!: TransactionType;

  @ApiProperty({
    type: String,
    description: 'Positive amount as a decimal string, never a JSON number.',
    example: '89.90',
  })
  amount!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Account of an income/expense transaction. Null for transfer rows.',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  accountId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Source account of a transfer row. Null for income/expense.',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  fromAccountId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Destination account of a transfer row. Null for income/expense.',
    example: '0e8f5c2a-6b1d-4f3e-9a7c-5d2b8e1f4a36',
  })
  toAccountId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Category of an income/expense transaction. Null for transfers.',
    example: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  })
  categoryId!: string | null;

  @ApiProperty({ description: 'Description.', example: 'Weekly groceries' })
  description!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    description: 'Transaction date (YYYY-MM-DD).',
    example: '2026-09-13',
  })
  date!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Creation timestamp (ISO 8601).',
    example: '2026-09-13T14:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Last update timestamp (ISO 8601).',
    example: '2026-09-13T14:30:00.000Z',
  })
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
