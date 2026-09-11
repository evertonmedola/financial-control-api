import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';

describe('AuthService', () => {
  let service: AuthService;
  let usersRepository: jest.Mocked<Repository<User>>;
  let refreshTokenRepository: jest.Mocked<Repository<RefreshToken>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret-at-least-32-characters-long',
          signOptions: { expiresIn: '15m' },
        }),
      ],
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
              throw new Error(`Unexpected config key requested: ${key}`);
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersRepository = module.get(getRepositoryToken(User));
    refreshTokenRepository = module.get(getRepositoryToken(RefreshToken));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('hashes the password with argon2 and persists the user (happy path)', async () => {
      const email = 'user@example.com';
      const password = 'super-secret-password';

      usersRepository.create.mockImplementation(
        (entityLike) => entityLike as User,
      );
      usersRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as User),
      );

      const result = await service.register(email, password);

      expect(result.email).toBe(email);
      expect(result.passwordHash).not.toBe(password);
      await expect(argon2.verify(result.passwordHash, password)).resolves.toBe(
        true,
      );
    });

    it('throws ConflictException when the repository reports a unique violation (error case)', async () => {
      usersRepository.create.mockImplementation(
        (entityLike) => entityLike as User,
      );
      usersRepository.save.mockRejectedValue({ code: '23505' });

      await expect(
        service.register('duplicate@example.com', 'super-secret-password'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('validateUser', () => {
    it('returns the user when the password matches (happy path)', async () => {
      const password = 'super-secret-password';
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const storedUser: Partial<User> = {
        id: 'user-id',
        email: 'user@example.com',
        passwordHash,
      };
      usersRepository.findOne.mockResolvedValue(storedUser as User);

      const result = await service.validateUser('user@example.com', password);

      expect(result).toBe(storedUser);
    });

    it('throws the generic UnauthorizedException when the email does not exist (error case)', async () => {
      usersRepository.findOne.mockResolvedValue(null);

      await expect(
        service.validateUser('missing@example.com', 'whatever-password'),
      ).rejects.toThrow(new UnauthorizedException('credenciais inválidas'));
    });
  });

  describe('login', () => {
    beforeEach(() => {
      refreshTokenRepository.create.mockImplementation(
        (entityLike) => entityLike as RefreshToken,
      );
      refreshTokenRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as RefreshToken),
      );
    });

    it('signs a JWT whose payload contains only sub (plus standard claims), never email', async () => {
      const user: Partial<User> = {
        id: 'user-id',
        email: 'user@example.com',
      };

      const { accessToken } = await service.login(user as User);

      const jwtService = new JwtService();
      const decoded = jwtService.decode<Record<string, unknown>>(accessToken);

      expect(decoded.sub).toBe(user.id);
      expect(decoded).not.toHaveProperty('email');
      expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'sub'].sort());
    });

    it('issues a refresh token and persists only its SHA-256 hash, never the raw value', async () => {
      const user: Partial<User> = {
        id: 'user-id',
        email: 'user@example.com',
      };

      const { refreshToken } = await service.login(user as User);

      expect(typeof refreshToken).toBe('string');
      expect(refreshToken.length).toBeGreaterThanOrEqual(64);
      expect(refreshTokenRepository.create.mock.calls.length).toBe(1);
      expect(refreshTokenRepository.save.mock.calls.length).toBe(1);

      const createArg = refreshTokenRepository.create.mock
        .calls[0][0] as Partial<RefreshToken>;
      expect(createArg.userId).toBe(user.id);
      expect(createArg.tokenHash).not.toBe(refreshToken);
      expect(createArg.revokedAt).toBeNull();
      expect(createArg.expiresAt).toBeInstanceOf(Date);
      expect((createArg.expiresAt as Date).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });
  });
});
