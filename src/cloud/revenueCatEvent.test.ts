import { describe, expect, it } from 'vitest';
import { parseRevenueCatEvent } from '../../supabase/functions/_shared/revenuecatEvent';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-09-14T12:00:00.000Z');

function event(type: string, overrides: Record<string, unknown> = {}) {
  return {
    api_version: '1.0',
    event: {
      id: `event-${type}`,
      type,
      event_timestamp_ms: NOW,
      expiration_at_ms: NOW + 86_400_000,
      entitlement_ids: ['pro'],
      app_user_id: USER_ID,
      original_app_user_id: '$RCAnonymousID:test',
      aliases: [USER_ID],
      ...overrides,
    },
  };
}

describe('RevenueCat webhook policy', () => {
  it('ignores dashboard tests, transfers, unknown types, and non-Pro products', () => {
    expect(parseRevenueCatEvent(event('TEST'), NOW)).toMatchObject({ kind: 'ignored', reason: 'test' });
    expect(parseRevenueCatEvent(event('TRANSFER'), NOW)).toMatchObject({ kind: 'ignored', reason: 'transfer' });
    expect(parseRevenueCatEvent(event('FUTURE_EVENT'), NOW)).toMatchObject({ kind: 'ignored', reason: 'unknown-type' });
    expect(parseRevenueCatEvent(event('RENEWAL', { entitlement_ids: ['other'] }), NOW)).toMatchObject({ kind: 'ignored', reason: 'non-pro' });
  });

  it('grants purchases and retains cancellation, billing issue, and pause access until expiry', () => {
    for (const type of ['INITIAL_PURCHASE', 'CANCELLATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED']) {
      expect(parseRevenueCatEvent(event(type), NOW)).toMatchObject({ kind: 'apply', active: true, ownerId: USER_ID });
    }
  });

  it('revokes expiration and naturally closes past-due lifecycle events', () => {
    expect(parseRevenueCatEvent(event('EXPIRATION'), NOW)).toMatchObject({ kind: 'apply', active: false });
    expect(parseRevenueCatEvent(event('CANCELLATION', { expiration_at_ms: NOW - 1 }), NOW)).toMatchObject({ kind: 'apply', active: false });
  });

  it('supports lifetime access and rejects malformed or ambiguous identities', () => {
    expect(parseRevenueCatEvent(event('NON_RENEWING_PURCHASE', { expiration_at_ms: null }), NOW)).toMatchObject({ kind: 'apply', active: true, expiresAt: null });
    expect(() => parseRevenueCatEvent(event('RENEWAL', { aliases: [USER_ID, '22222222-2222-4222-8222-222222222222'] }), NOW)).toThrow(/Ambiguous/);
    expect(() => parseRevenueCatEvent({ api_version: '2.0', event: {} }, NOW)).toThrow(/malformed/i);
  });
});
