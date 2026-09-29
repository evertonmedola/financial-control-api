import { ApiProperty } from '@nestjs/swagger';

/**
 * Documentation-only class: describes the `@nestjs/terminus` result already
 * returned by GET /health. Never instantiated.
 */
export class HealthCheckResponseDto {
  @ApiProperty({
    description: 'Overall health status.',
    enum: ['ok', 'error'],
    example: 'ok',
  })
  status!: string;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: 'Health indicators that are up.',
    example: { database: { status: 'up' } },
  })
  info!: Record<string, unknown> | null;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: 'Health indicators that are down (empty when healthy).',
    example: {},
  })
  error!: Record<string, unknown> | null;

  @ApiProperty({
    type: Object,
    description: 'Status of every health indicator.',
    example: { database: { status: 'up' } },
  })
  details!: Record<string, unknown>;
}
