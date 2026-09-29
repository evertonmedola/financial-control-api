import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({
    description: 'Unique transfer identifier.',
    format: 'uuid',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  id!: string;

  @ApiProperty({
    type: String,
    description: 'Transferred amount as a decimal string, never a JSON number.',
    example: '250.00',
  })
  amount!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Account the money left.',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  fromAccountId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Account the money went to.',
    example: '0e8f5c2a-6b1d-4f3e-9a7c-5d2b8e1f4a36',
  })
  toAccountId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    description: 'Transfer date (YYYY-MM-DD).',
    example: '2026-09-13',
  })
  date!: string;

  @ApiProperty({ description: 'Description.', example: 'Move to savings' })
  description!: string;

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
