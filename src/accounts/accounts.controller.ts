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
import { AccountsService } from './accounts.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

// Guard applied at controller level (not per-route as in AuthController)
// since every Accounts route requires authentication — a deliberate small
// deviation from AuthController's per-route placement, per 02-PATTERNS.md.
@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    const account = await this.accountsService.create(userId, dto);
    return AccountResponseDto.fromEntity(account);
  }

  @Get()
  async findAll(@CurrentUser() userId: string): Promise<AccountResponseDto[]> {
    const accounts = await this.accountsService.findAll(userId);
    return accounts.map((account) => AccountResponseDto.fromEntity(account));
  }

  @Get(':id')
  async findOne(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<AccountResponseDto> {
    const account = await this.accountsService.findOne(userId, id);
    return AccountResponseDto.fromEntity(account);
  }

  @Patch(':id')
  async update(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    const account = await this.accountsService.update(userId, id, dto);
    return AccountResponseDto.fromEntity(account);
  }

  // Nest's @Delete() default status is already 200 — no @HttpCode override
  // needed. Returns {} mirroring AuthController.logout()'s already-
  // established empty-envelope convention, for response-shape consistency.
  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<Record<string, never>> {
    await this.accountsService.remove(userId, id);
    return {};
  }
}
