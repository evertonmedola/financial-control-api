import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Global ValidationPipe, ClassSerializerInterceptor, and ResponseInterceptor
// are registered as DI providers in AppModule (APP_PIPE / APP_INTERCEPTOR),
// not imperatively here — that way they're active in every INestApplication
// built from AppModule, including e2e tests that never call this bootstrap().
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);
}
void bootstrap();
