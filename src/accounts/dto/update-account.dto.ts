import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PATCH /accounts/:id — name only. Deliberately omits `balance` (D-02:
 * balance is locked against direct edits after creation — the only write
 * path to balance remains AccountsService.create()/adjustBalance()) and
 * `type` (narrows 02-PATTERNS.md's draft, which included an optional
 * `type` field — D-01 makes balance-sign meaning depend on type, so
 * permitting a type change after creation would misrepresent an existing
 * balance's meaning with no conversion path; this is the mitigation for
 * prohibition P2). Global forbidNonWhitelisted:true (APP_PIPE in
 * AppModule) rejects any request body containing `balance` or `type` with
 * 400 automatically — no manual guard code is needed here.
 */
export class UpdateAccountDto {
  @ApiPropertyOptional({
    description: 'New display name of the account (the only editable field).',
    minLength: 1,
    maxLength: 100,
    example: 'Nubank Savings',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}
