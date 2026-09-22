import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BudgetsService } from './budgets.service';
import { BudgetResponseDto } from './dto/budget-response.dto';
import { BudgetStatusDto } from './dto/budget-status.dto';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

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

  // Plain REST resource-by-id lookup, by the budget's own id — NOT a
  // per-category lookup (D-06 only prohibits a
  // GET /budgets/by-category/:categoryId-style endpoint).
  @Get(':id')
  async findOne(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BudgetResponseDto> {
    const budget = await this.budgetsService.findOne(userId, id);
    return BudgetResponseDto.fromEntity(budget);
  }

  @Patch(':id')
  async update(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBudgetDto,
  ): Promise<BudgetResponseDto> {
    const budget = await this.budgetsService.update(userId, id, dto);
    return BudgetResponseDto.fromEntity(budget);
  }

  // Mirrors every other domain module's empty-envelope delete convention.
  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, never>> {
    await this.budgetsService.remove(userId, id);
    return {};
  }
}
