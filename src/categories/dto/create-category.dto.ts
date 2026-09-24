import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { CategoryType } from '../entities/category.entity';

export class CreateCategoryDto {
  // Trimmed before validation (WR-02): a whitespace-only string would
  // otherwise pass @MinLength(1) and, because the D-03 unique index is on
  // the literal `name` column, leading/trailing whitespace could be used to
  // trivially defeat per-user (name, type) uniqueness (e.g. "Comida" vs
  // "Comida ").
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  // Rejects any value outside the two canonical types with 400 rather than
  // silently defaulting — the concrete mitigation for this plan's
  // Prohibition P1.
  @IsEnum(CategoryType)
  type!: CategoryType;
}
