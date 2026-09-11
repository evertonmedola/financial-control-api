import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import ms, { type StringValue } from 'ms';
import { Repository } from 'typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';

const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — OWASP minimum-recommended (D-01)
  timeCost: 2,
  parallelism: 1,
};

// A fixed, pre-computed dummy hash — NOT tied to any real user. Used so a
// login attempt against a non-existent email still pays the argon2 cost,
// keeping the "user not found" and "wrong password" branches timing-
// indistinguishable (Pattern 2 / Pitfall 1 in 01-RESEARCH.md).
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$IuTu7dcbf2YfVxcqlWY5Wg$OyEfla3GRMj6yJ9lW+EEGHg9EXMrIAjEUmTgN9JpiFA';

const GENERIC_AUTH_ERROR = 'credenciais inválidas';

// Postgres unique-violation error code.
const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(email: string, password: string): Promise<User> {
    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);

    const user = this.usersRepository.create({ email, passwordHash });

    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('e-mail já cadastrado');
      }
      throw error;
    }
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { email } });
    const hashToVerify = user?.passwordHash ?? DUMMY_PASSWORD_HASH;

    // Always call argon2.verify(), whether or not the user was found, so
    // both branches take comparable time (D-05 + Pattern 2 timing mitigation).
    const isValid = await argon2.verify(hashToVerify, password);

    if (!user || !isValid) {
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    return user;
  }

  async findById(userId: string): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    return user;
  }

  async login(
    user: User,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    return this.issueTokenPair(user.id);
  }

  /**
   * Shared by login() and refresh() (Task 2) so token issuance has exactly
   * one implementation: sign a stateless access token, then generate,
   * hash, and persist a brand-new DB-backed refresh token (D-02/D-04).
   */
  private async issueTokenPair(
    userId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Payload carries ONLY `sub` — no email/PII (prohibition, AUTH-02).
    // expiresIn comes from the JwtModule's default sign options
    // (JWT_ACCESS_EXPIRES_IN, 15 minutes per D-03) — single source of truth.
    const accessToken = await this.jwtService.signAsync({ sub: userId });

    // High-entropy (512-bit) random value — never guessable, unlike a
    // Math.random()-based token. Hashed with SHA-256 (not argon2) before
    // persisting: this is already a random secret with no dictionary to
    // defend against, so a slow KDF adds latency for zero security gain
    // (01-RESEARCH.md Alternatives Considered).
    const rawRefreshToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const refreshExpiresIn = this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRES_IN',
    ) as StringValue;
    const expiresAt = new Date(Date.now() + ms(refreshExpiresIn));

    const refreshTokenEntity = this.refreshTokenRepository.create({
      userId,
      tokenHash,
      expiresAt,
      revokedAt: null,
    });
    await this.refreshTokenRepository.save(refreshTokenEntity);

    return { accessToken, refreshToken: rawRefreshToken };
  }

  // SHA-256, not argon2 — see issueTokenPair()'s comment on why a fast hash
  // is the deliberate, correct choice for a high-entropy random secret.
  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
    );
  }
}
