import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { CategoryType } from '../entities/category.entity';

export class CreateCategoryDto {
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
