import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
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
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';
import { TransfersService } from './transfers.service';

// Guard applied at controller level, mirroring TransactionsController/
// AccountsController — every Transfers route requires authentication. No
// @Patch route exists anywhere in this controller (D-05) — a structural
// absence, not a stub that returns an error.
@ApiTags('Transfers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @ApiOperation({
    summary: "Transfer money between two of the user's accounts",
  })
  @ApiEnvelopedResponse({
    status: 201,
    description: 'Transfer created.',
    model: TransferResponseDto,
  })
  @ApiErrorResponses(400, 401, 404)
  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateTransferDto,
  ): Promise<TransferResponseDto> {
    const transfer = await this.transfersService.create(userId, dto);
    return TransferResponseDto.fromEntity(transfer);
  }

  // Reverses both account balances via adjustBalance before commit — D-06.
  // Returns {} mirroring TransactionsController.remove()'s established
  // empty-envelope convention.
  @ApiOperation({
    summary: 'Delete a transfer and reverse both account balances',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Transfer id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'Transfer deleted; the payload is an empty object.',
  })
  @ApiErrorResponses(400, 401, 404)
  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, never>> {
    await this.transfersService.remove(userId, id);
    return {};
  }
}
