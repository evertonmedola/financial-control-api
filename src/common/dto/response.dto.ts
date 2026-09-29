import { ApiProperty } from '@nestjs/swagger';

/**
 * Consistent API response envelope (nestjs-conventions skill: "toda resposta
 * de API segue um formato consistente"). Applied globally by
 * ResponseInterceptor — every successful controller response is wrapped in
 * this shape before it reaches the client.
 */
export class ResponseDto<T> {
  @ApiProperty({
    type: Object,
    description:
      'Endpoint-specific payload. Its exact schema is declared per route by ApiEnvelopedResponse.',
    example: {},
  })
  data: T;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Server time at which the response was produced (ISO 8601).',
    example: '2026-09-28T12:00:00.000Z',
  })
  timestamp: string;

  constructor(data: T) {
    this.data = data;
    this.timestamp = new Date().toISOString();
  }
}
