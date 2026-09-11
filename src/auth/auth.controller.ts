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

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    const user = await this.authService.register(dto.email, dto.password);
    return UserResponseDto.fromEntity(user);
  }

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
