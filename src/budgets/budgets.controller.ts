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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiEnvelopedResponse } from '../common/swagger/api-envelope-response.decorator';
import { ApiErrorResponses } from '../common/swagger/api-error-responses.decorator';
import { BudgetsService } from './budgets.service';
import { BudgetResponseDto } from './dto/budget-response.dto';
import { BudgetStatusDto } from './dto/budget-status.dto';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

// Guard applied at controller level (not per-route), since every Budgets
// route requires authentication — mirrors CategoriesController.
@ApiTags('Budgets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @ApiOperation({ summary: 'Create a monthly budget for an expense category' })
  @ApiEnvelopedResponse({
    status: 201,
    description: 'Budget created.',
    model: BudgetResponseDto,
  })
  @ApiErrorResponses(400, 401, 404, 409)
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
  @ApiOperation({
    summary:
      'List budgets with spent, remaining and over-budget status for the current month',
  })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'Budgets with their status for the current calendar month.',
    model: BudgetStatusDto,
    isArray: true,
  })
  @ApiErrorResponses(401)
  @Get()
  async findAll(@CurrentUser() userId: string): Promise<BudgetStatusDto[]> {
    return this.budgetsService.findAllWithStatus(userId);
  }

  // Plain REST resource-by-id lookup, by the budget's own id — NOT a
  // per-category lookup (D-06 only prohibits a
  // GET /budgets/by-category/:categoryId-style endpoint).
  @ApiOperation({ summary: 'Get a budget by id' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Budget id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'The budget.',
    model: BudgetResponseDto,
  })
  @ApiErrorResponses(400, 401, 404)
  @Get(':id')
  async findOne(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BudgetResponseDto> {
    const budget = await this.budgetsService.findOne(userId, id);
    return BudgetResponseDto.fromEntity(budget);
  }

  @ApiOperation({ summary: "Update a budget's limit" })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Budget id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'The updated budget.',
    model: BudgetResponseDto,
  })
  @ApiErrorResponses(400, 401, 404, 409)
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
  @ApiOperation({ summary: 'Delete a budget' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Budget id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'Budget deleted; the payload is an empty object.',
  })
  @ApiErrorResponses(400, 401, 404)
  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, never>> {
    await this.budgetsService.remove(userId, id);
    return {};
  }
}
