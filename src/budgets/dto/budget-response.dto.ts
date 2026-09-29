import { ApiProperty } from '@nestjs/swagger';
import { Budget } from '../entities/budget.entity';

/**
 * The only shape of a Budget ever returned to a client for CRUD routes
 * (create/view/update). Constructed explicitly from a Budget entity, field
 * by field — never spreads the entity — so internal columns (userId,
 * deletedAt) can never leak into a response by accident, mirroring
 * CategoryResponseDto's pattern.
 */
export class BudgetResponseDto {
  @ApiProperty({
    description: 'Unique budget identifier.',
    format: 'uuid',
    example: '0e8f5c2a-6b1d-4f3e-9a7c-5d2b8e1f4a36',
  })
  id!: string;

  @ApiProperty({
    description: 'Id of the expense category the budget applies to.',
    format: 'uuid',
    example: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  })
  categoryId!: string;

  @ApiProperty({
    type: String,
    description:
      'Monthly spending limit as a decimal string, never a JSON number.',
    example: '800.00',
  })
  limit!: string;

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

  static fromEntity(budget: Budget): BudgetResponseDto {
    const dto = new BudgetResponseDto();
    dto.id = budget.id;
    dto.categoryId = budget.categoryId;
    dto.limit = budget.limit;
    dto.createdAt = budget.createdAt;
    dto.updatedAt = budget.updatedAt;
    return dto;
  }
}
