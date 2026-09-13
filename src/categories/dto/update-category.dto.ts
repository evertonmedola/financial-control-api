import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PATCH /categories/:id — name only. Deliberately omits `type` (D-02: type
 * is set only at category creation and is locked against direct edits after
 * creation — this is the mitigation for this plan's Prohibition P2, mirrors
 * UpdateAccountDto's doc-comment pattern). Global forbidNonWhitelisted:true
 * (APP_PIPE in AppModule) rejects any request body containing `type` with
 * 400 automatically — no manual guard code is needed here.
 */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}
