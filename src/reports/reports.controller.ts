import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CategorySummaryQueryDto } from './dto/category-summary-query.dto';
import { CategorySummaryResponseDto } from './dto/category-summary-response.dto';
import { NetBalanceResponseDto } from './dto/net-balance-response.dto';
import { ReportsService } from './reports.service';

// Guard applied at controller level (not per-route) — mirrors every prior
// domain controller's class-level guard placement; every Reports route
// requires authentication.
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('category-summary')
  async categorySummary(
    @CurrentUser() userId: string,
    @Query() query: CategorySummaryQueryDto,
  ): Promise<CategorySummaryResponseDto[]> {
    return this.reportsService.getCategorySummary(userId, query.from, query.to);
  }

  // No query parameters — narrowest possible input surface (T-06-05).
  @Get('net-balance')
  async netBalance(
    @CurrentUser() userId: string,
  ): Promise<NetBalanceResponseDto> {
    return this.reportsService.getNetBalance(userId);
  }
}
