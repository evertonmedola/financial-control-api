import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccounts1789300000000 implements MigrationInterface {
  name = 'CreateAccounts1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."accounts_type_enum" AS ENUM('corrente', 'poupanca', 'carteira', 'cartao_credito')`,
    );
    await queryRunner.query(
      `CREATE TABLE "accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "type" "public"."accounts_type_enum" NOT NULL,
        "balance" numeric(12,2) NOT NULL,
        "deleted_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_accounts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_accounts_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );
    // userId-leading index — PITFALLS.md Performance Traps: every
    // tenant-scoped table needs an index with userId as the leading column.
    await queryRunner.query(
      `CREATE INDEX "IDX_accounts_user_id" ON "accounts" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_accounts_user_id"`);
    await queryRunner.query(`DROP TABLE "accounts"`);
    await queryRunner.query(`DROP TYPE "public"."accounts_type_enum"`);
  }
}
