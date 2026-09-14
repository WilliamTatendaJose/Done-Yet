export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

const urlPattern = /^https:\/\/[^\s/]+(?:\/.*)?$/i;

/** Public Supabase settings are injected at build time; service-role keys never belong in the app. */
export function getSupabaseConfig(env: Record<string, string | undefined> = process.env): SupabaseConfig | null {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const anonKey = (env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)?.trim() ?? '';
  if (!url || !anonKey || !urlPattern.test(url)) return null;
  return { url: url.replace(/\/+$/, ''), anonKey };
}
