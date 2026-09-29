import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiEnvelopedResponse } from '../common/swagger/api-envelope-response.decorator';
import { HealthCheckResponseDto } from './dto/health-check-response.dto';

// Deliberately no @UseGuards(JwtAuthGuard) here — /health must remain
// unauthenticated for Docker's HEALTHCHECK today and the future ALB target
// group in Phase 8 (D-01). Terminus's own HealthCheckResult shape only ever
// reports {status, database:{status}} — no connection string, host, or
// credential field exists to leak (T-07-03).
// @SkipThrottle: probes (Docker, ALB) must never receive 429 from the global
// ThrottlerGuard, or the target would be marked unhealthy under load.
@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @ApiOperation({
    summary: 'Health check (verifies database connectivity)',
    description: 'Public probe used by Docker and the load balancer.',
  })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'The application and its database are healthy.',
    model: HealthCheckResponseDto,
  })
  @ApiResponse({
    status: 503,
    description:
      'A health indicator is down. Terminus returns its own failure body, not the standard error body.',
    type: HealthCheckResponseDto,
  })
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.db.pingCheck('database')]);
  }
}
