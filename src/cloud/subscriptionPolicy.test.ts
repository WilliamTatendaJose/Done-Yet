import { describe, expect, it } from 'vitest';
import { developerProOverride, hasProEntitlement, proAccessReason, selectPackage } from './subscriptionPolicy';

describe('subscription policy', () => {
  it('recognizes only an active pro entitlement', () => {
    expect(hasProEntitlement({ entitlements: { active: { pro: {} } } })).toBe(true);
    expect(hasProEntitlement({ entitlements: { active: {} } })).toBe(false);
  });

  it('selects an exact package and otherwise prefers annual then monthly', () => {
    const monthly = { identifier: '$rc_monthly' };
    const annual = { identifier: '$rc_annual' };
    expect(selectPackage([monthly, annual], monthly.identifier)).toBe(monthly);
    expect(selectPackage([monthly, annual])).toBe(annual);
    expect(selectPackage([{ identifier: 'custom' }])?.identifier).toBe('custom');
    expect(selectPackage([], 'missing')).toBeUndefined();
  });

  it('keeps unresolved, free, and Pro access distinct', () => {
    expect(proAccessReason({ resolving: true, isPro: false }, 'cloud sync')).toContain('Checking');
    expect(proAccessReason({ resolving: false, isPro: false }, 'AI assistance')).toContain('Pro');
    expect(proAccessReason({ resolving: false, isPro: true }, 'cloud attachments')).toBe('');
  });

  it('allows the override only in a development runtime', () => {
    expect(developerProOverride(true)).toBe(true);
    expect(developerProOverride(true, 'true')).toBe(true);
    expect(developerProOverride(true, 'false')).toBe(false);
    expect(developerProOverride(false, 'true')).toBe(false);
    expect(developerProOverride(false)).toBe(false);
  });
});
