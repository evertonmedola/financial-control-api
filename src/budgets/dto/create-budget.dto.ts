import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import {
  IsMoneyString,
  POSITIVE_MONEY_REGEX,
} from '../../common/validators/is-money-string.decorator';

export class CreateBudgetDto {
  @ApiProperty({
    description: 'Id of the expense (despesa) category the budget applies to.',
    format: 'uuid',
    example: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  })
  @IsUUID()
  categoryId!: string;

  // Same shared IsMoneyString('positive') as CreateTransactionDto.amount —
  // no sign, no all-zero value, max 2 decimals, integer part capped at 10
  // digits (matches numeric(12,2)'s maximum representable value).
  @ApiProperty({
    type: String,
    description:
      'Monthly spending limit as a positive decimal string (no sign, not zero, max 2 decimals, max 10 integer digits), never a JSON number.',
    pattern: POSITIVE_MONEY_REGEX.source,
    example: '800.00',
  })
  @IsMoneyString(
    'positive',
    'limit deve ser uma string decimal positiva, sem sinal, com até 2 casas decimais, e não pode ser zero',
  )
  limit!: string;
}
