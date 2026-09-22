import { Budget } from '../entities/budget.entity';

/**
 * The only shape of a Budget ever returned to a client for CRUD routes
 * (create/view/update). Constructed explicitly from a Budget entity, field
 * by field — never spreads the entity — so internal columns (userId,
 * deletedAt) can never leak into a response by accident, mirroring
 * CategoryResponseDto's pattern.
 */
export class BudgetResponseDto {
  id!: string;
  categoryId!: string;
  limit!: string;
  createdAt!: Date;
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
