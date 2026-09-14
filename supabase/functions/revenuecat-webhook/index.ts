import { parseRevenueCatEvent } from '../_shared/revenuecatEvent.ts';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

Deno.serve(async (request: Request) => {
  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  if (request.method !== 'POST') return json({ error: 'Only POST is supported.' }, 405);
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Unauthorized.' }, 401);

  let body: unknown;
  try { body = await request.json(); }
  catch { return json({ error: 'Request body must be valid JSON.' }, 400); }

  let parsed;
  try { parsed = parseRevenueCatEvent(body); }
  catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Malformed event.' }, 400);
  }
  if (parsed.kind === 'ignored') return json({ ok: true, ignored: parsed.reason });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Webhook persistence is not configured.' }, 500);

  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/apply_revenuecat_event`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        p_owner: parsed.ownerId,
        p_event_id: parsed.eventId,
        p_event_at: parsed.eventAt,
        p_active: parsed.active,
        p_expires: parsed.expiresAt,
      }),
    });
  } catch {
    return json({ error: 'Entitlement persistence could not be reached.' }, 502);
  }
  return response.ok ? json({ ok: true, applied: await response.json() }) : json({ error: 'Entitlement persistence failed.' }, 502);
});
