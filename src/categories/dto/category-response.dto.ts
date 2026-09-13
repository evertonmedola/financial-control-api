import { Category, CategoryType } from '../entities/category.entity';

/**
 * The only shape of a Category ever returned to a client. Constructed
 * explicitly from a Category entity, field by field — never spreads the
 * entity — so internal columns (e.g. deletedAt, userId) can never leak into
 * a response by accident, mirroring AccountResponseDto's pattern.
 */
export class CategoryResponseDto {
  id!: string;
  name!: string;
  type!: CategoryType;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(category: Category): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.name = category.name;
    dto.type = category.type;
    dto.createdAt = category.createdAt;
    dto.updatedAt = category.updatedAt;
    return dto;
  }
}
