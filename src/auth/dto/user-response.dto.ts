import { User } from '../entities/user.entity';

/**
 * The only shape of a User ever returned to a client. Constructed explicitly
 * from a User entity — never spreads the entity directly — so `passwordHash`
 * can never leak into a response even before the global ClassSerializerInterceptor
 * (Task 2) is wired up.
 */
export class UserResponseDto {
  id!: string;
  email!: string;
  createdAt!: Date;

  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.createdAt = user.createdAt;
    return dto;
  }
}
