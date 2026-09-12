import { z } from 'zod';

/**
 * Full env contract for this project, declared up front (interface-first) so
 * later plans (02: CORS/rate limiting, 03: refresh tokens) never need to
 * re-declare or edit this schema — they only read via ConfigService.get().
 *
 * The application MUST refuse to boot if any variable is missing or malformed.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1),

  // No JWT_REFRESH_SECRET: refresh tokens are opaque crypto.randomBytes(64)
  // values (DB-backed, hashed with SHA-256 before persisting), not signed
  // JWTs — there is nothing to sign/verify, so no secret is needed (WR-05
  // fix; removed a dead required env var that forced every environment to
  // provision a secret that did nothing).
  JWT_REFRESH_EXPIRES_IN: z.string().min(1),

  ALLOWED_ORIGINS: z.string().min(1),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }

  return result.data;
}
