import {
  ClassSerializerInterceptor,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { validate } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    // Sane global default (100 req/60s) — every current and future endpoint
    // in every later phase is covered by this unless it declares its own
    // tighter @Throttle() override (see AuthController's login/register).
    // Uses the package's seconds() helper, NOT a raw millisecond number —
    // @nestjs/throttler v6's `ttl` is milliseconds, and a bare `60` would
    // silently configure a 60ms window (01-RESEARCH.md Pitfall 2).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: seconds(60), limit: 100 }],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.getOrThrow<string>('DB_HOST'),
        port: configService.getOrThrow<number>('DB_PORT'),
        username: configService.getOrThrow<string>('DB_USER'),
        password: configService.getOrThrow<string>('DB_PASSWORD'),
        database: configService.getOrThrow<string>('DB_NAME'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        // Migrations only — never true, per project convention (never
        // synchronize schema on any environment touching shared data).
        synchronize: false,
      }),
    }),
    AuthModule,
  ],
  providers: [
    // Global guard — covers every endpoint in every module by default;
    // AuthController's login/register routes layer a tighter per-route
    // @Throttle() override on top of this same guard (D-06).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Registered as DI providers (not imperatively in main.ts) so these
    // global enhancers are active in EVERY INestApplication built from this
    // module — including e2e tests that construct their own application via
    // Test.createTestingModule(), which never runs main.ts's bootstrap().
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    // Order matters: providers earlier in this array run outermost (see
    // ResponseInterceptor's own comment). ClassSerializerInterceptor must
    // see the final {data, timestamp} envelope so it strips `@Exclude()`
    // fields nested inside `data`.
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
