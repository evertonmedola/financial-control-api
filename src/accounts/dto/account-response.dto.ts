import { ApiProperty } from '@nestjs/swagger';
import { Account, AccountType } from '../entities/account.entity';

/**
 * The only shape of an Account ever returned to a client. Constructed
 * explicitly from an Account entity, field by field — never spreads the
 * entity — so internal columns (e.g. deletedAt) can never leak into a
 * response by accident, mirroring UserResponseDto's pattern.
 */
export class AccountResponseDto {
  @ApiProperty({
    description: 'Unique account identifier.',
    format: 'uuid',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  id!: string;

  @ApiProperty({ description: 'Display name.', example: 'Nubank Checking' })
  name!: string;

  @ApiProperty({
    description: 'Account type.',
    enum: AccountType,
    enumName: 'AccountType',
    example: AccountType.CORRENTE,
  })
  type!: AccountType;

  @ApiProperty({
    type: String,
    description:
      'Current balance as a decimal string, never a JSON number. For cartao_credito it is the amount owed.',
    example: '1500.00',
  })
  balance!: string;

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

  static fromEntity(account: Account): AccountResponseDto {
    const dto = new AccountResponseDto();
    dto.id = account.id;
    dto.name = account.name;
    dto.type = account.type;
    dto.balance = account.balance;
    dto.createdAt = account.createdAt;
    dto.updatedAt = account.updatedAt;
    return dto;
  }
}
