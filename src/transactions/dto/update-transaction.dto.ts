import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
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
  // Trimmed before validation, same rationale as CreateTransactionDto:
  // prevents a whitespace-only description.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}
