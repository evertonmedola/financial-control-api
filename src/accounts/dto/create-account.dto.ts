import {
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AccountType } from '../entities/account.entity';

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  // Rejects any value outside the four canonical types with 400 rather than
  // silently defaulting — the concrete mitigation for prohibition P1.
  @IsEnum(AccountType)
  type!: AccountType;

  // D-01/Pitfall 1: validated as a decimal string, never @IsNumber() — money
  // must never round-trip through floating point. No @IsOptional() — ACCT-01
  // requires an initial balance at creation. The optional leading `-` allows
  // negative balances at creation for non-credit-card types (CONTEXT.md
  // discretion: real accounts can start overdrawn); no type-specific
  // restriction is applied here.
  @Matches(/^-?\d+(\.\d{1,2})?$/, {
    message: 'balance deve ser uma string decimal com até 2 casas',
  })
  balance!: string;
}
