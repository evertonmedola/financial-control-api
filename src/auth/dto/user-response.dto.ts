import { ApiProperty } from '@nestjs/swagger';
import { User } from '../entities/user.entity';

/**
 * The only shape of a User ever returned to a client. Constructed explicitly
 * from a User entity — never spreads the entity directly — so `passwordHash`
 * can never leak into a response even before the global ClassSerializerInterceptor
 * (Task 2) is wired up.
 */
export class UserResponseDto {
  @ApiProperty({
    description: 'Unique user identifier.',
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id!: string;

  @ApiProperty({
    description: 'E-mail address of the user.',
    format: 'email',
    example: 'user@example.com',
  })
  email!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Registration timestamp (ISO 8601).',
    example: '2026-09-13T14:30:00.000Z',
  })
  createdAt!: Date;

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.createdAt = user.createdAt;
    return dto;
  }
}
