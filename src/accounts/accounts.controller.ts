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
import { AccountsService } from './accounts.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

// Guard applied at controller level (not per-route as in AuthController)
// since every Accounts route requires authentication — a deliberate small
// deviation from AuthController's per-route placement, per 02-PATTERNS.md.
@ApiTags('Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @ApiOperation({ summary: 'Create an account' })
  @ApiEnvelopedResponse({
    status: 201,
    description: 'Account created.',
    model: AccountResponseDto,
  })
  @ApiErrorResponses(400, 401)
  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    const account = await this.accountsService.create(userId, dto);
    return AccountResponseDto.fromEntity(account);
  }

  @ApiOperation({ summary: "List the authenticated user's accounts" })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'List of accounts.',
    model: AccountResponseDto,
    isArray: true,
  })
  @ApiErrorResponses(401)
  @Get()
  async findAll(@CurrentUser() userId: string): Promise<AccountResponseDto[]> {
    const accounts = await this.accountsService.findAll(userId);
    return accounts.map((account) => AccountResponseDto.fromEntity(account));
  }

  @ApiOperation({ summary: 'Get an account by id' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Account id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'The account.',
    model: AccountResponseDto,
  })
  @ApiErrorResponses(401, 404)
  @Get(':id')
  async findOne(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<AccountResponseDto> {
    const account = await this.accountsService.findOne(userId, id);
    return AccountResponseDto.fromEntity(account);
  }

  @ApiOperation({ summary: 'Rename an account (only the name is editable)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Account id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'The updated account.',
    model: AccountResponseDto,
  })
  @ApiErrorResponses(400, 401, 404)
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
  @ApiOperation({ summary: 'Delete an account (soft delete)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Account id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'Account deleted; the payload is an empty object.',
  })
  @ApiErrorResponses(401, 404)
  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<Record<string, never>> {
    await this.accountsService.remove(userId, id);
    return {};
  }
}
