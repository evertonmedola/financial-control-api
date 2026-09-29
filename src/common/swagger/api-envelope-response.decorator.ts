import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ResponseDto } from '../dto/response.dto';

interface ApiEnvelopedResponseOptions {
  status: number;
  description: string;
  /** Payload model placed under `data`. Omit for the empty `{}` payload. */
  model?: Type<unknown>;
  isArray?: boolean;
}

/**
 * Documents a successful response inside the real `{ data, timestamp }`
 * envelope that ResponseInterceptor produces. A plain `type: SomeDto` would
 * document a shape the API never returns.
 */
export const ApiEnvelopedResponse = ({
  status,
  description,
  model,
  isArray,
}: ApiEnvelopedResponseOptions) => {
  let data: Record<string, unknown>;
  if (model) {
    const ref = { $ref: getSchemaPath(model) };
    data = isArray ? { type: 'array', items: ref } : ref;
  } else {
    data = { type: 'object', example: {} };
  }

  return applyDecorators(
    ApiExtraModels(ResponseDto, ...(model ? [model] : [])),
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ResponseDto) },
          { type: 'object', properties: { data } },
        ],
      },
    }),
  );
};
