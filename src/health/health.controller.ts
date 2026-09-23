import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

// Deliberately no @UseGuards(JwtAuthGuard) here — /health must remain
// unauthenticated for Docker's HEALTHCHECK today and the future ALB target
// group in Phase 8 (D-01). Terminus's own HealthCheckResult shape only ever
// reports {status, database:{status}} — no connection string, host, or
// credential field exists to leak (T-07-03).
// @SkipThrottle: probes (Docker, ALB) must never receive 429 from the global
// ThrottlerGuard, or the target would be marked unhealthy under load.
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.db.pingCheck('database')]);
  }
}
