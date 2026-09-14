import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferResponseDto } from './dto/transfer-response.dto';
import { TransfersService } from './transfers.service';

// Guard applied at controller level, mirroring TransactionsController/
// AccountsController — every Transfers route requires authentication. No
// @Patch route exists anywhere in this controller (D-05) — a structural
// absence, not a stub that returns an error.
@UseGuards(JwtAuthGuard)
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateTransferDto,
  ): Promise<TransferResponseDto> {
    const transfer = await this.transfersService.create(userId, dto);
    return TransferResponseDto.fromEntity(transfer);
  }
}
