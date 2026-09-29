import { ApiProperty } from '@nestjs/swagger';

/**
 * Documentation-only class: mirrors the inline `{ accessToken, refreshToken }`
 * shape that login and refresh already return. Never instantiated.
 */
export class TokenResponseDto {
  @ApiProperty({
    description:
      'Short-lived JWT access token; send it as `Authorization: Bearer <token>`.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example-payload.example-signature',
  })
  accessToken!: string;

  @ApiProperty({
    description:
      'Opaque, revocable refresh token used to obtain a new token pair.',
    example: 'ab12'.repeat(32),
  })
  refreshToken!: string;
}
