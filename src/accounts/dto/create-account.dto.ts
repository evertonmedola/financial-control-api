import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AccountType } from '../entities/account.entity';

export class CreateAccountDto {
  @ApiProperty({
    description: 'Display name of the account.',
    minLength: 1,
    maxLength: 100,
    example: 'Nubank Checking',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  // Rejects any value outside the four canonical types with 400 rather than
  // silently defaulting — the concrete mitigation for prohibition P1.
  @ApiProperty({
    description:
      'Account type: corrente (checking), poupanca (savings), carteira (cash wallet) or cartao_credito (credit card).',
    enum: AccountType,
    enumName: 'AccountType',
    example: AccountType.CORRENTE,
  })
  @IsEnum(AccountType)
  type!: AccountType;

  // D-01/Pitfall 1: validated as a decimal string, never @IsNumber() — money
  // must never round-trip through floating point. No @IsOptional() — ACCT-01
  // requires an initial balance at creation. The optional leading `-` allows
  // negative balances at creation for every account type (real accounts can
  // start overdrawn); for cartao_credito a negative balance IS the open debt.
  // No type-specific restriction is applied here.
  @ApiProperty({
    type: String,
    description:
      'Initial balance as a decimal string with up to 2 decimals (negative allowed), never a JSON number. The convention is the same for every account type: a cartao_credito with an existing open debt must be created with a negative initial balance (for example "-300.00").',
    pattern: '^-?\\d+(\\.\\d{1,2})?$',
    example: '1500.00',
  })
  @Matches(/^-?\d+(\.\d{1,2})?$/, {
    message: 'balance deve ser uma string decimal com até 2 casas',
  })
  balance!: string;
}
