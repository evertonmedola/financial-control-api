import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCategories1789400000000 implements MigrationInterface {
  name = 'CreateCategories1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."categories_type_enum" AS ENUM('receita', 'despesa')`,
    );
    await queryRunner.query(
      `CREATE TABLE "categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "type" "public"."categories_type_enum" NOT NULL,
        "deleted_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_categories_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_categories_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );
    // userId-leading index — PITFALLS.md Performance Traps: every
    // tenant-scoped table needs an index with userId as the leading column.
    await queryRunner.query(
      `CREATE INDEX "IDX_categories_user_id" ON "categories" ("user_id")`,
    );
    // D-03: composite partial unique index — a user cannot have two
    // non-soft-deleted categories with the same (name, type). The WHERE
    // clause excludes soft-deleted rows so a deleted category's name/type
    // can be reused by a newly-created category (03-CONTEXT.md discretion).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_categories_user_id_name_type" ON "categories" ("user_id", "name", "type") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_categories_user_id_name_type"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_categories_user_id"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP TYPE "public"."categories_type_enum"`);
  }
}
