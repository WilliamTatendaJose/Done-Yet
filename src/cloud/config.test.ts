import { describe, expect, it } from 'vitest';
import { getSupabaseConfig } from './config';

describe('Supabase build configuration', () => {
  it('accepts the modern publishable key alias', () => {
    expect(getSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co/', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '  public-key  ' })).toEqual({ url: 'https://project.supabase.co', anonKey: 'public-key' });
  });

  it('prefers the legacy anon key when both aliases exist', () => {
    expect(getSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key' })?.anonKey).toBe('anon-key');
  });

  it('rejects missing keys and non-HTTPS endpoints', () => {
    expect(getSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: 'http://project.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-key' })).toBeNull();
    expect(getSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' })).toBeNull();
  });
});
