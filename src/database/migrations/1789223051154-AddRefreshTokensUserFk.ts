import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WR-01 fix: `refresh_tokens.user_id` was created as a plain
 * `character varying` with no foreign key, while `users.id` is `uuid` — no
 * referential integrity, and a type mismatch between the two columns.
 * This migration aligns the column type with `users.id` and adds the
 * missing FK (`ON DELETE CASCADE` so deleting a user cleans up their
 * refresh tokens instead of leaving orphaned rows).
 */
export class AddRefreshTokensUserFk1789223051154
  implements MigrationInterface
{
  name = 'AddRefreshTokensUserFk1789223051154';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_refresh_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_refresh_tokens_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ALTER COLUMN "user_id" TYPE character varying USING "user_id"::text`,
    );
  }
}
