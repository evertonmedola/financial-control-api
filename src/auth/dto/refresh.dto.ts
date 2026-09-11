import { IsString, MaxLength } from 'class-validator';

export class RefreshDto {
  // A raw refresh token is always exactly 128 hex chars
  // (crypto.randomBytes(64).toString('hex')). Bounding the accepted length
  // rejects malformed/oversized payloads before they reach hashing —
  // defense-in-depth, not a functional requirement of this plan.
  @IsString()
  @MaxLength(256)
  refreshToken!: string;
}
