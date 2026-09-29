import { ApiProperty } from '@nestjs/swagger';
import { Category, CategoryType } from '../entities/category.entity';

/**
 * The only shape of a Category ever returned to a client. Constructed
 * explicitly from a Category entity, field by field — never spreads the
 * entity — so internal columns (e.g. deletedAt, userId) can never leak into
 * a response by accident, mirroring AccountResponseDto's pattern.
 */
export class CategoryResponseDto {
  @ApiProperty({
    description: 'Unique category identifier.',
    format: 'uuid',
    example: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  })
  id!: string;

  @ApiProperty({ description: 'Category name.', example: 'Groceries' })
  name!: string;

  @ApiProperty({
    description: 'Category type.',
    enum: CategoryType,
    enumName: 'CategoryType',
    example: CategoryType.DESPESA,
  })
  type!: CategoryType;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Creation timestamp (ISO 8601).',
    example: '2026-09-13T14:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Last update timestamp (ISO 8601).',
    example: '2026-09-13T14:30:00.000Z',
  })
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
