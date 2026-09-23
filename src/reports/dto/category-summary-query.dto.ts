import { IsDateString } from 'class-validator';

// The codebase's first `@Query()`-bound DTO (06-PATTERNS.md's "No Analog
// Found" note). Mirrors `CreateTransactionDto.date`'s exact `@IsDateString()`
// validator — no stricter regex. The global `ValidationPipe({whitelist:true,
// forbidNonWhitelisted:true, transform:true})` already covers `@Query()`
// binding the same way it covers `@Body()`, so a malformed value 400s
// automatically and an unexpected extra query param 400s too
// (CONTEXT.md's "Date Range Input" decision: both params required, no hard
// cap on range size).
export class CategorySummaryQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
