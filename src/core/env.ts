import { z } from 'zod';

const envSchema = z.object({
  EXPO_PUBLIC_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  EXPO_PUBLIC_SUPABASE_URL: z.url().optional(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional()
});

function normalize(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseEnv() {
  const parsed = envSchema.safeParse({
    EXPO_PUBLIC_ENV: normalize(process.env.EXPO_PUBLIC_ENV),
    EXPO_PUBLIC_SUPABASE_URL: normalize(process.env.EXPO_PUBLIC_SUPABASE_URL),
    EXPO_PUBLIC_SUPABASE_ANON_KEY: normalize(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)
  });

  if (parsed.success) {
    return parsed.data;
  }

  if (__DEV__) {
    console.warn('Invalid EXPO_PUBLIC_* environment variables:', parsed.error.flatten().fieldErrors);
  }

  return {
    EXPO_PUBLIC_ENV: 'development' as const,
    EXPO_PUBLIC_SUPABASE_URL: undefined,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined
  };
}

const env = parseEnv();

export const appEnv = {
  environment: env.EXPO_PUBLIC_ENV,
  supabaseUrl: env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  isSupabaseConfigured: Boolean(env.EXPO_PUBLIC_SUPABASE_URL && env.EXPO_PUBLIC_SUPABASE_ANON_KEY)
};
