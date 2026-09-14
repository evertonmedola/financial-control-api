import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionsService } from './transactions.service';

// Guard applied at controller level, mirroring AccountsController/
// CategoriesController — every Transactions route requires authentication.
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateTransactionDto,
  ): Promise<TransactionResponseDto> {
    const transaction = await this.transactionsService.create(userId, dto);
    return TransactionResponseDto.fromEntity(transaction);
  }

  @Get()
  async findAll(
    @CurrentUser() userId: string,
  ): Promise<TransactionResponseDto[]> {
    const transactions = await this.transactionsService.findAll(userId);
    return transactions.map((transaction) =>
      TransactionResponseDto.fromEntity(transaction),
    );
  }

  @Get(':id')
  async findOne(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<TransactionResponseDto> {
    const transaction = await this.transactionsService.findOne(userId, id);
    return TransactionResponseDto.fromEntity(transaction);
  }

  // description/date only — D-04.
  @Patch(':id')
  async update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
  ): Promise<TransactionResponseDto> {
    const transaction = await this.transactionsService.update(userId, id, dto);
    return TransactionResponseDto.fromEntity(transaction);
  }

  // Reverses the balance via adjustBalance before commit — D-06. Nest's
  // @Delete() default status is already 200 — no @HttpCode override needed.
  // Returns {} mirroring AccountsController.remove()'s established
  // empty-envelope convention.
  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<Record<string, never>> {
    await this.transactionsService.remove(userId, id);
    return {};
  }
}
