import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * PATCH /transactions/:id — description/date only. Deliberately omits
 * `amount`, `accountId`, `categoryId` (D-04: these are locked after creation
 * — mirrors UpdateAccountDto's/UpdateCategoryDto's doc-comment pattern
 * explaining why the fields are intentionally absent). Global
 * forbidNonWhitelisted:true (APP_PIPE in AppModule) rejects any request body
 * containing them with 400 automatically — no manual guard code is needed
 * here.
 */
export class UpdateTransactionDto {
  // CR-01 (05-REVIEW.md, iteration 3): @IsOptional() alone lets
  // `{"description": null}` / `{"date": null}` through untouched —
  // class-validator's IsOptional short-circuits ALL subsequent validators
  // whenever the value is `null` OR `undefined`. Mirrors the
  // UpdateBudgetDto CR-02 fix: @ValidateIf() replaces @IsOptional()
  // entirely, only skipping validation when the field is absent
  // (`undefined`), so an explicit `null` reaches @IsString()/@IsDateString()
  // and correctly fails with a 400 instead of reaching the NOT NULL
  // `description`/`date` columns and crashing with an unhandled 500.
  //
  // Trimmed before validation, same rationale as CreateTransactionDto:
  // prevents a whitespace-only description.
  @ApiPropertyOptional({
    description:
      'New description (only description and date are editable). Trimmed.',
    minLength: 1,
    maxLength: 255,
    example: 'Weekly groceries and cleaning supplies',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({
    description:
      'New transaction date (only description and date are editable).',
    format: 'date',
    example: '2026-09-14',
  })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsDateString()
  date?: string;
}
