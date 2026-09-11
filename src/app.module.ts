import {
  ClassSerializerInterceptor,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
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
