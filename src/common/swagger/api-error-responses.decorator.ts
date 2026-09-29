import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

export type DocumentedErrorStatus = 400 | 401 | 404 | 409 | 429;

const ERROR_DESCRIPTIONS: Record<DocumentedErrorStatus, string> = {
  400: 'Validation failed or a business rule was violated.',
  401: 'Missing, invalid or expired credentials or token.',
  404: 'Resource not found (also returned when it belongs to another user).',
  409: 'Conflict: the resource already exists.',
  429: 'Too many requests: rate limit exceeded.',
};

/**
 * Documents error responses with the body HttpExceptionFilter produces.
 * One explicit ApiResponse per status so the per-route intent stays visible.
 */
export const ApiErrorResponses = (...statuses: DocumentedErrorStatus[]) =>
  applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: ERROR_DESCRIPTIONS[status],
        type: ErrorResponseDto,
      }),
    ),
  );
