import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransactions1789500000000 implements MigrationInterface {
  name = 'CreateTransactions1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_type_enum" AS ENUM('income', 'expense', 'transfer')`,
    );
    await queryRunner.query(
      `CREATE TABLE "transactions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "type" "public"."transactions_type_enum" NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "account_id" uuid,
        "from_account_id" uuid,
        "to_account_id" uuid,
        "category_id" uuid,
        "description" character varying NOT NULL,
        "date" date NOT NULL,
        "deleted_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transactions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_transactions_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_transactions_account_id" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transactions_from_account_id" FOREIGN KEY ("from_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transactions_to_account_id" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transactions_category_id" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_transactions_type_shape" CHECK (
          (type IN ('income', 'expense') AND account_id IS NOT NULL AND category_id IS NOT NULL AND from_account_id IS NULL AND to_account_id IS NULL)
          OR
          (type = 'transfer' AND account_id IS NULL AND category_id IS NULL AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL)
        )
      )`,
    );
    // userId-leading index — PITFALLS.md Performance Traps: every
    // tenant-scoped table needs an index with userId as the leading column.
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_user_id" ON "transactions" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_transactions_user_id"`);
    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(`DROP TYPE "public"."transactions_type_enum"`);
  }
}
