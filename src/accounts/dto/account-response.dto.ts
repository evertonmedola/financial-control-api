import { Account, AccountType } from '../entities/account.entity';

/**
 * The only shape of an Account ever returned to a client. Constructed
 * explicitly from an Account entity, field by field — never spreads the
 * entity — so internal columns (e.g. deletedAt) can never leak into a
 * response by accident, mirroring UserResponseDto's pattern.
 */
export class AccountResponseDto {
  id!: string;
  name!: string;
  type!: AccountType;
  balance!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static fromEntity(account: Account): AccountResponseDto {
    const dto = new AccountResponseDto();
    dto.id = account.id;
    dto.name = account.name;
    dto.type = account.type;
    dto.balance = account.balance;
    dto.createdAt = account.createdAt;
    dto.updatedAt = account.updatedAt;
    return dto;
  }
}
