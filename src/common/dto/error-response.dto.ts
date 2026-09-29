import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Documentation-only class: mirrors the body HttpExceptionFilter emits for
 * errors. It is never instantiated and, unlike successful responses, error
 * bodies are NOT wrapped in the { data, timestamp } envelope.
 */
export class ErrorResponseDto {
  @ApiProperty({
    type: Number,
    description: 'HTTP status code of the error.',
    example: 400,
  })
  statusCode!: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description:
      'Human-readable error message. An array of messages when request validation fails.',
    example: ['email must be an email'],
  })
  message!: string | string[];

  @ApiPropertyOptional({
    type: String,
    description: 'Short HTTP error name (absent on unexpected 500 errors).',
    example: 'Bad Request',
  })
  error?: string;
}
