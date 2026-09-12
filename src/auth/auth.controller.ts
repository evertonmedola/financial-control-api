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
import { Throttle, seconds } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { User } from './entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // T-01-12 (mitigate): mass-account-creation throttling — applied in the
  // same commit as login's, per 01-RESEARCH.md Pitfall 3's explicit warning
  // against forgetting this endpoint.
  @Throttle({ default: { limit: 3, ttl: seconds(60) } })
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    const user = await this.authService.register(dto.email, dto.password);
    return UserResponseDto.fromEntity(user);
  }

  // T-01-11 (mitigate): brute-force/credential-stuffing throttling (D-06).
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

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() userId: string): Promise<UserResponseDto> {
    const user = await this.authService.findById(userId);
    return UserResponseDto.fromEntity(user);
  }

  // Unauthenticated by JwtAuthGuard on purpose — these two endpoints
  // authenticate via the refresh token itself, not a Bearer access token.
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    return this.authService.refresh(dto.refreshToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Body() dto: RefreshDto): Promise<Record<string, never>> {
    await this.authService.logout(dto.refreshToken);
    return {};
  }
}
