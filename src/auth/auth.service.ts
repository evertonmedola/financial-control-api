import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
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
    private readonly jwtService: JwtService,
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

  async login(user: User): Promise<{ accessToken: string }> {
    // Payload carries ONLY `sub` — no email/PII (prohibition, AUTH-02).
    // expiresIn comes from the JwtModule's default sign options
    // (JWT_ACCESS_EXPIRES_IN, 15 minutes per D-03) — single source of truth.
    const accessToken = await this.jwtService.signAsync({ sub: user.id });

    return { accessToken };
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
