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
  @IsUUID()
  fromAccountId!: string;

  @IsUUID()
  toAccountId!: string;

  @Matches(/^(?!0+(\.0{1,2})?$)\d{1,10}(\.\d{1,2})?$/, {
    message:
      'amount deve ser uma string decimal positiva, sem sinal, com até 2 casas decimais, e não pode ser zero',
  })
  amount!: string;

  @IsDateString()
  date!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description!: string;
}
