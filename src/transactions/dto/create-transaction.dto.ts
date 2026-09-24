import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TransactionType } from '../entities/transaction.entity';

export class CreateTransactionDto {
  // Deliberately @IsIn with an explicit two-value allowlist, NOT
  // @IsEnum(TransactionType) — @IsEnum would also accept 'transfer',
  // violating D-02's "this endpoint only ever accepts income/expense" rule.
  @IsIn([TransactionType.INCOME, TransactionType.EXPENSE])
  type!: TransactionType;

  // The negative lookahead excludes an all-zero value ('0', '0.0', '0.00')
  // while \d{1,10} caps the integer part at 10 digits — matching
  // numeric(12,2)'s maximum representable value 9999999999.99, so an
  // overflowing amount is rejected here (400) rather than as a raw Postgres
  // overflow error later. No sign character is permitted at all — the
  // balance-effect sign comes only from `type`, never from a client-
  // supplied sign (Prohibition, T-04-01).
  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/, {
    message:
      'amount deve ser uma string decimal positiva, sem sinal, com até 2 casas decimais, e não pode ser zero',
  })
  amount!: string;

  @IsUUID()
  accountId!: string;

  @IsUUID()
  categoryId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description!: string;

  // No future-date restriction applied — allowed, per 04-CONTEXT.md's
  // discretion note default.
  @IsDateString()
  date!: string;
}
