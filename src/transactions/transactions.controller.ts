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
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionsService } from './transactions.service';

// Guard applied at controller level, mirroring AccountsController/
// CategoriesController — every Transactions route requires authentication.
@ApiTags('Transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @ApiOperation({
    summary:
      'Record an income or expense transaction (updates the account balance)',
  })
  @ApiEnvelopedResponse({
    status: 201,
    description: 'Transaction recorded.',
    model: TransactionResponseDto,
  })
  @ApiErrorResponses(400, 401, 404)
  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateTransactionDto,
  ): Promise<TransactionResponseDto> {
    const transaction = await this.transactionsService.create(userId, dto);
    return TransactionResponseDto.fromEntity(transaction);
  }

  @ApiOperation({
    summary: 'List all transactions, including transfers, newest first',
  })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'List of transactions.',
    model: TransactionResponseDto,
    isArray: true,
  })
  @ApiErrorResponses(401)
  @Get()
  async findAll(
    @CurrentUser() userId: string,
  ): Promise<TransactionResponseDto[]> {
    const transactions = await this.transactionsService.findAll(userId);
    return transactions.map((transaction) =>
      TransactionResponseDto.fromEntity(transaction),
    );
  }

  @ApiOperation({ summary: 'Get an income or expense transaction by id' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Transaction id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'The transaction.',
    model: TransactionResponseDto,
  })
  @ApiErrorResponses(401, 404)
  @Get(':id')
  async findOne(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<TransactionResponseDto> {
    const transaction = await this.transactionsService.findOne(userId, id);
    return TransactionResponseDto.fromEntity(transaction);
  }

  // description/date only — D-04.
  @ApiOperation({ summary: "Update a transaction's description or date" })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Transaction id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'The updated transaction.',
    model: TransactionResponseDto,
  })
  @ApiErrorResponses(400, 401, 404)
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
  @ApiOperation({
    summary: 'Delete a transaction and reverse its balance effect',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Transaction id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'Transaction deleted; the payload is an empty object.',
  })
  @ApiErrorResponses(401, 404)
  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<Record<string, never>> {
    await this.transactionsService.remove(userId, id);
    return {};
  }
}
