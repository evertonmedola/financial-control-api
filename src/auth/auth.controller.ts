import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, seconds } from '@nestjs/throttler';
import { ApiEnvelopedResponse } from '../common/swagger/api-envelope-response.decorator';
import { ApiErrorResponses } from '../common/swagger/api-error-responses.decorator';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { User } from './entities/user.entity';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // T-01-12 (mitigate): mass-account-creation throttling — applied in the
  // same commit as login's, per 01-RESEARCH.md Pitfall 3's explicit warning
  // against forgetting this endpoint.
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Public: no bearer token is needed, the caller is creating credentials. Rate limited to 3 requests per minute.',
  })
  @ApiEnvelopedResponse({
    status: 201,
    description: 'User registered.',
    model: UserResponseDto,
  })
  @ApiErrorResponses(400, 409, 429)
  @Throttle({ default: { limit: 3, ttl: seconds(60) } })
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    const user = await this.authService.register(dto.email, dto.password);
    return UserResponseDto.fromEntity(user);
  }

  // T-01-11 (mitigate): brute-force/credential-stuffing throttling (D-06).
  @ApiOperation({
    summary: 'Log in with e-mail and password',
    description:
      'Public: authenticates with credentials, not a bearer token. Rate limited to 5 requests per minute.',
  })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'Access and refresh tokens.',
    model: TokenResponseDto,
  })
  @ApiErrorResponses(400, 401, 429)
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Req() request: { user: User },
    @Body() _dto: LoginDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    return this.authService.login(request.user);
  }

  @ApiOperation({ summary: 'Get the authenticated user' })
  @ApiBearerAuth()
  @ApiEnvelopedResponse({
    status: 200,
    description: 'The authenticated user.',
    model: UserResponseDto,
  })
  @ApiErrorResponses(401)
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() userId: string): Promise<UserResponseDto> {
    const user = await this.authService.findById(userId);
    return UserResponseDto.fromEntity(user);
  }

  // Unauthenticated by JwtAuthGuard on purpose — these two endpoints
  // authenticate via the refresh token itself, not a Bearer access token.
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair',
    description:
      'Public: authenticates with the refresh token itself, not a bearer token.',
  })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'New access and refresh tokens.',
    model: TokenResponseDto,
  })
  @ApiErrorResponses(400, 401)
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    return this.authService.refresh(dto.refreshToken);
  }

  @ApiOperation({
    summary: 'Revoke a refresh token (log out)',
    description:
      'Public: authenticates with the refresh token itself, not a bearer token.',
  })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'Refresh token revoked; the payload is an empty object.',
  })
  @ApiErrorResponses(400)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Body() dto: RefreshDto): Promise<Record<string, never>> {
    await this.authService.logout(dto.refreshToken);
    return {};
  }
}
