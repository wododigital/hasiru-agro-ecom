import { z } from 'zod';

const flag = z.enum(['0', '1']).default('0');
const keySpec = z
  .string()
  .regex(/^(\d+:)?[A-Za-z0-9+/=]{43,44}$/, 'must be "<version>:<base64 32 bytes>" (version optional, defaults to 1)');

/** Server env. Required-in-production keys are optional in dev and test so a partial .env still boots. */
export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** App role (runtime, no DDL). */
    DATABASE_URL: z.url().optional(),
    /** Owner role (migrations and seed only). */
    DATABASE_OWNER_URL: z.url().optional(),
    /** Canonical origin, e.g. https://www.example.com. */
    SITE_URL: z.url().optional(),
    /** Where the worker reaches the web process for tag revalidation. */
    INTERNAL_BASE_URL: z.url().default('http://127.0.0.1:3000'),
    /** Signs internal calls (revalidate), form time-trap tokens and the IP hash salt. 32+ chars. */
    INTERNAL_SECRET: z.string().min(32).optional(),
    SETTINGS_MASTER_KEY: keySpec.optional(),
    SETTINGS_MASTER_KEY_PREVIOUS: keySpec.optional(),
    ENABLE_MOCKS: flag,
    GIT_SHA: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['DATABASE_URL', 'SITE_URL', 'INTERNAL_SECRET', 'SETTINGS_MASTER_KEY'] as const) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
    }
    if (env.ENABLE_MOCKS === '1') ctx.addIssue({ code: 'custom', path: ['ENABLE_MOCKS'], message: 'must be 0 in production' });
  });
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Browser-visible env. Only NEXT_PUBLIC_* keys; Next inlines them at build time. */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cached: ServerEnv | null = null;

/** Parses process.env once; throws one error listing every bad key. Call it at boot (instrumentation, worker). */
export function loadEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`invalid environment:\n- ${lines.join('\n- ')}`);
  }
  cached = parsed.data;
  return cached;
}

/** Validated server env, parsed on first access. */
export const env: Readonly<ServerEnv> = new Proxy({} as ServerEnv, {
  get: (_, key) => (cached ?? loadEnv())[key as keyof ServerEnv],
});

/** Test hook: forget the parsed env after changing process.env. */
export function resetEnv(): void {
  cached = null;
}

export const publicEnv: PublicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});
