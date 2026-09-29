import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// D-02: a transfer's own dedicated DTO — no `type` field (always TRANSFER,
// never client-supplied). Mirrors CreateTransactionDto's amount regex
// exactly (Prohibition, T-04-13) — this is a separate DTO that must
// independently enforce the "no sign, no zero, no overflow, max 2 decimals"
// rule rather than relying on CreateTransactionDto's copy.
export class CreateTransferDto {
  @ApiProperty({
    description:
      'Id of the account the money leaves. Must differ from the destination.',
    format: 'uuid',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @IsUUID()
  fromAccountId!: string;

  @ApiProperty({
    description:
      'Id of the account the money goes to. Must differ from the source.',
    format: 'uuid',
    example: '0e8f5c2a-6b1d-4f3e-9a7c-5d2b8e1f4a36',
  })
  @IsUUID()
  toAccountId!: string;

  @ApiProperty({
    type: String,
    description:
      'Positive decimal string: no sign, not zero, max 2 decimals, max 10 integer digits.',
    pattern: '^(?!0+(\\.0{1,2})?$)\\d{1,10}(\\.\\d{1,2})?$',
    example: '250.00',
  })
  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/, {
    message:
      'amount deve ser uma string decimal positiva, sem sinal, com até 2 casas decimais, e não pode ser zero',
  })
  amount!: string;

  @ApiProperty({
    description: 'Transfer date (ISO 8601 date string).',
    format: 'date',
    example: '2026-09-13',
  })
  @IsDateString()
  date!: string;

  @ApiProperty({
    description: 'Free-text description. Trimmed.',
    minLength: 1,
    maxLength: 255,
    example: 'Move to savings',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description!: string;
}
