/**
 * Consistent API response envelope (nestjs-conventions skill: "toda resposta
 * de API segue um formato consistente"). Applied globally by
 * ResponseInterceptor — every successful controller response is wrapped in
 * this shape before it reaches the client.
 */
export class ResponseDto<T> {
  data: T;
  timestamp: string;

  constructor(data: T) {
    this.data = data;
    this.timestamp = new Date().toISOString();
  }
}
