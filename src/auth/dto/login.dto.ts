import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'E-mail address the account was registered with.',
    format: 'email',
    example: 'user@example.com',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'Account password. Hashed with Argon2id, never returned.',
    format: 'password',
    minLength: 8,
    maxLength: 128,
    example: 'S3cur3-Passw0rd!',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
