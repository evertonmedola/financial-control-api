import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const GENERIC_SERVER_ERROR_MESSAGE = 'Internal server error';

/**
 * Global exception filter (security-review checklist: "mensagens de erro não
 * vazam stack trace, nome de tabela ou versão de dependência").
 *
 * - Known `HttpException`s (already thrown with a sanitized message by the
 *   throwing code, e.g. `UnauthorizedException('credenciais inválidas')`) are
 *   forwarded as-is — their status + body are already safe to return.
 * - Anything else (a raw `Error`, a driver-level exception, etc.) is an
 *   UNEXPECTED failure: the real error is logged server-side via `Logger`
 *   and the client only ever receives a generic 500 body. The stack trace,
 *   error message, file path, and exception class name never cross the
 *   HTTP boundary, regardless of `NODE_ENV`.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      response
        .status(status)
        .json(
          typeof exceptionResponse === 'string'
            ? { statusCode: status, message: exceptionResponse }
            : exceptionResponse,
        );
      return;
    }

    // Unexpected/unhandled error: log the real details server-side only.
    this.logger.error(
      `Unhandled exception on ${request.method} ${request.originalUrl}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: GENERIC_SERVER_ERROR_MESSAGE,
    });
  }
}
