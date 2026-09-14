export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

const urlPattern = /^https:\/\/[^\s/]+(?:\/.*)?$/i;

/** Public Supabase settings are injected at build time; service-role keys never belong in the app. */
/**
 * Read statically, one property at a time. Expo inlines `process.env.EXPO_PUBLIC_*` at build
 * time only for literal member expressions; a dynamic read like `env[name]` leaves the name in
 * the bundle and the value undefined, which silently disables cloud sync in a release build
 * while still working in development, where the values are injected at runtime.
 */
const buildEnv: Record<string, string | undefined> = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};

export function getSupabaseConfig(env: Record<string, string | undefined> = buildEnv): SupabaseConfig | null {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const anonKey = (env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim() ?? '';
  if (!url || !anonKey || !urlPattern.test(url)) return null;
  return { url: url.replace(/\/+$/, ''), anonKey };
}
