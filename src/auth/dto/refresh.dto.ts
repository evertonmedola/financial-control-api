import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class RefreshDto {
  // A raw refresh token is always exactly 128 hex chars
  // (crypto.randomBytes(64).toString('hex')). Bounding the accepted length
  // rejects malformed/oversized payloads before they reach hashing —
  // defense-in-depth, not a functional requirement of this plan.
  @ApiProperty({
    description:
      'Opaque refresh token from POST /auth/login or POST /auth/refresh.',
    maxLength: 256,
    example: 'ab12'.repeat(32),
  })
  @IsString()
  @MaxLength(256)
  refreshToken!: string;
}
