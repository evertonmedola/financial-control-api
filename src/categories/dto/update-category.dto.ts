import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PATCH /categories/:id — name only. Deliberately omits `type` (D-02: type
 * is set only at category creation and is locked against direct edits after
 * creation — this is the mitigation for this plan's Prohibition P2, mirrors
 * UpdateAccountDto's doc-comment pattern). Global forbidNonWhitelisted:true
 * (APP_PIPE in AppModule) rejects any request body containing `type` with
 * 400 automatically — no manual guard code is needed here.
 */
export class UpdateCategoryDto {
  // Trimmed before validation (WR-02) — same rationale as CreateCategoryDto:
  // prevents a whitespace-only name and prevents leading/trailing whitespace
  // from defeating the D-03 unique index on the literal `name` column.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}
