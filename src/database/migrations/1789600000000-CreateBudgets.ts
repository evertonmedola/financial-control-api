import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBudgets1789600000000 implements MigrationInterface {
  name = 'CreateBudgets1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "budgets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "category_id" uuid NOT NULL,
        "limit" numeric(12,2) NOT NULL,
        "deleted_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_budgets_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_budgets_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_budgets_category_id" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT
      )`,
    );
    // userId-leading index — PITFALLS.md Performance Traps: every
    // tenant-scoped table needs an index with userId as the leading column.
    await queryRunner.query(
      `CREATE INDEX "IDX_budgets_user_id" ON "budgets" ("user_id")`,
    );
    // D-07/discretion note: one active budget per category per user. The
    // WHERE clause excludes soft-deleted rows so a deleted budget's category
    // can be reused by a new budget — structurally identical to
    // UQ_categories_user_id_name_type.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_budgets_user_id_category_id" ON "budgets" ("user_id", "category_id") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_budgets_user_id_category_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_budgets_user_id"`);
    await queryRunner.query(`DROP TABLE "budgets"`);
  }
}
