import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiEnvelopedResponse } from '../common/swagger/api-envelope-response.decorator';
import { ApiErrorResponses } from '../common/swagger/api-error-responses.decorator';
import { CategorySummaryQueryDto } from './dto/category-summary-query.dto';
import { CategorySummaryResponseDto } from './dto/category-summary-response.dto';
import { MonthComparisonQueryDto } from './dto/month-comparison-query.dto';
import { MonthComparisonResponseDto } from './dto/month-comparison-response.dto';
import { NetBalanceQueryDto } from './dto/net-balance-query.dto';
import { NetBalanceResponseDto } from './dto/net-balance-response.dto';
import { ReportsService } from './reports.service';

// Guard applied at controller level (not per-route) — mirrors every prior
// domain controller's class-level guard placement; every Reports route
// requires authentication.
@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @ApiOperation({
    summary:
      'Spending total per category within a date range (transfers excluded)',
  })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'Total spent per category within the range.',
    model: CategorySummaryResponseDto,
    isArray: true,
  })
  @ApiErrorResponses(400, 401)
  @Get('category-summary')
  async categorySummary(
    @CurrentUser() userId: string,
    @Query() query: CategorySummaryQueryDto,
  ): Promise<CategorySummaryResponseDto[]> {
    return this.reportsService.getCategorySummary(userId, query.from, query.to);
  }

  // No query parameters — narrowest possible input surface (T-06-05).
  // Still binds @Query() to an empty DTO so the global
  // forbidNonWhitelisted ValidationPipe structurally rejects any
  // unexpected/spoofed param (e.g. userId) with 400, consistent with the
  // other two Reports endpoints (WR-02).
  @ApiOperation({
    summary:
      'Consolidated net balance across all accounts (credit-card balances count as debt)',
  })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'The consolidated net balance.',
    model: NetBalanceResponseDto,
  })
  @ApiErrorResponses(400, 401)
  @Get('net-balance')
  async netBalance(
    @CurrentUser() userId: string,
    @Query() _query: NetBalanceQueryDto,
  ): Promise<NetBalanceResponseDto> {
    return this.reportsService.getNetBalance(userId);
  }

  @ApiOperation({
    summary:
      'Per-category spending of a month compared with the previous month',
  })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'Per-category totals for the month and the previous month.',
    model: MonthComparisonResponseDto,
    isArray: true,
  })
  @ApiErrorResponses(400, 401)
  @Get('month-comparison')
  async monthComparison(
    @CurrentUser() userId: string,
    @Query() query: MonthComparisonQueryDto,
  ): Promise<MonthComparisonResponseDto[]> {
    return this.reportsService.getMonthComparison(userId, query.month);
  }
}
