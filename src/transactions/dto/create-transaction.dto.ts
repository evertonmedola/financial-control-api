import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  IsMoneyString,
  POSITIVE_MONEY_REGEX,
} from '../../common/validators/is-money-string.decorator';
import { TransactionType } from '../entities/transaction.entity';

export class CreateTransactionDto {
  // Deliberately @IsIn with an explicit two-value allowlist, NOT
  // @IsEnum(TransactionType) — @IsEnum would also accept 'transfer',
  // violating D-02's "this endpoint only ever accepts income/expense" rule.
  @ApiProperty({
    description:
      'Transaction type: income or expense. Transfers are created through POST /transfers.',
    enum: [TransactionType.INCOME, TransactionType.EXPENSE],
    enumName: 'TransactionInputType',
    example: TransactionType.EXPENSE,
  })
  @IsIn([TransactionType.INCOME, TransactionType.EXPENSE])
  type!: TransactionType;

  // The shared IsMoneyString('positive') excludes an all-zero value and caps
  // the integer part at 10 digits — matching numeric(12,2)'s maximum
  // representable value 9999999999.99, so an overflowing amount is rejected
  // here (400) rather than as a raw Postgres overflow error later. No sign
  // character is permitted at all — the balance-effect sign comes only from
  // `type`, never from a client-supplied sign (Prohibition, T-04-01).
  @ApiProperty({
    type: String,
    description:
      'Positive decimal string: no sign, not zero, max 2 decimals, max 10 integer digits. The sign of the balance effect comes only from `type`.',
    pattern: POSITIVE_MONEY_REGEX.source,
    example: '89.90',
  })
  @IsMoneyString(
    'positive',
    'amount deve ser uma string decimal positiva, sem sinal, com até 2 casas decimais, e não pode ser zero',
  )
  amount!: string;

  @ApiProperty({
    description: 'Id of the account the transaction applies to.',
    format: 'uuid',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @IsUUID()
  accountId!: string;

  @ApiProperty({
    description: 'Id of the category the transaction is filed under.',
    format: 'uuid',
    example: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({
    description: 'Free-text description. Trimmed.',
    minLength: 1,
    maxLength: 255,
    example: 'Weekly groceries',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description!: string;

  // No future-date restriction applied — allowed, per 04-CONTEXT.md's
  // discretion note default.
  @ApiProperty({
    description: 'Transaction date (ISO 8601 date string).',
    format: 'date',
    example: '2026-09-13',
  })
  @IsDateString()
  date!: string;
}
