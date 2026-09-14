export type ParsedRevenueCatEvent =
  | { kind: 'ignored'; reason: 'test' | 'transfer' | 'non-pro' | 'unknown-type' }
  | { kind: 'apply'; ownerId: string; eventId: string; eventAt: string; active: boolean; expiresAt: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIFECYCLE_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_PAUSED',
  'EXPIRATION',
  'BILLING_ISSUE',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'REFUND_REVERSED',
]);

function isoFromMilliseconds(value: unknown, field: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${field}.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${field}.`);
  return date.toISOString();
}

export function parseRevenueCatEvent(body: unknown, nowMs = Date.now()): ParsedRevenueCatEvent {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Malformed event.');
  const root = body as Record<string, unknown>;
  if (root.api_version !== '1.0' || !root.event || typeof root.event !== 'object' || Array.isArray(root.event)) {
    throw new Error('Unsupported or malformed event.');
  }
  const event = root.event as Record<string, unknown>;
  if (typeof event.id !== 'string' || !event.id.trim() || typeof event.type !== 'string') throw new Error('Malformed event.');
  const eventAt = isoFromMilliseconds(event.event_timestamp_ms, 'event timestamp');

  if (event.type === 'TEST') return { kind: 'ignored', reason: 'test' };
  if (event.type === 'TRANSFER') return { kind: 'ignored', reason: 'transfer' };
  if (!LIFECYCLE_TYPES.has(event.type)) return { kind: 'ignored', reason: 'unknown-type' };
  if (!Array.isArray(event.entitlement_ids) || !event.entitlement_ids.includes('pro')) {
    return { kind: 'ignored', reason: 'non-pro' };
  }

  const candidates = [
    event.app_user_id,
    event.original_app_user_id,
    ...(Array.isArray(event.aliases) ? event.aliases : []),
  ].filter((value): value is string => typeof value === 'string' && UUID.test(value));
  const uniqueIds = [...new Set(candidates.map(value => value.toLowerCase()))];
  if (uniqueIds.length !== 1) throw new Error('Ambiguous or missing user id.');

  const expiresAt = event.expiration_at_ms == null
    ? null
    : isoFromMilliseconds(event.expiration_at_ms, 'expiration timestamp');
  const active = event.type !== 'EXPIRATION'
    && (expiresAt === null || Date.parse(expiresAt) > nowMs);

  return {
    kind: 'apply',
    ownerId: uniqueIds[0],
    eventId: event.id,
    eventAt,
    active,
    expiresAt,
  };
}
