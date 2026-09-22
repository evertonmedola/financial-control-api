import { Body, Controller, Post, UseGuards, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BudgetsService } from './budgets.service';
import { BudgetResponseDto } from './dto/budget-response.dto';
import { BudgetStatusDto } from './dto/budget-status.dto';
import { CreateBudgetDto } from './dto/create-budget.dto';

// Guard applied at controller level (not per-route), since every Budgets
// route requires authentication — mirrors CategoriesController.
@UseGuards(JwtAuthGuard)
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateBudgetDto,
  ): Promise<BudgetResponseDto> {
    const budget = await this.budgetsService.create(userId, dto);
    return BudgetResponseDto.fromEntity(budget);
  }

  // D-06: returns the computed BudgetStatusDto[] shape (limit/spent/
  // remaining/overBudget) for the current calendar month — no query
  // parameters accepted (D-04, Phase 6 Reports' job).
  @Get()
  async findAll(@CurrentUser() userId: string): Promise<BudgetStatusDto[]> {
    return this.budgetsService.findAllWithStatus(userId);
  }

  // Task 2 (05-01-PLAN.md) adds: GET /budgets/:id, PATCH /budgets/:id,
  // DELETE /budgets/:id.
}
