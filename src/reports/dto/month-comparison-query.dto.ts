import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

// `@IsDateString()` would accept a full date (YYYY-MM-DD), not the YYYY-MM
// shape CONTEXT.md's "Month-over-Month Comparison Scope" decision specifies
// — a structural `@Matches()` regex rejects anything else at the DTO layer,
// before it ever reaches month-bounds computation (T-06-07).
export class MonthComparisonQueryDto {
  @ApiProperty({
    description: 'Month to compare with the previous one, in YYYY-MM format.',
    pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
    example: '2026-09',
  })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month deve estar no formato YYYY-MM',
  })
  month!: string;
}
