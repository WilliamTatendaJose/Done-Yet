// Cloud AI assistance proxy (Deno / Supabase Edge Functions runtime — not covered by the app's
// TypeScript project or its test suite; keep this file self-contained and obviously correct).
//
// This function is the ONLY place the Muse provider key exists. It is read from the MUSE_API_KEY
// secret via Deno.env.get, is never logged, and is never accepted from — or echoed back to — the
// caller. See mobile/supabase/README.md for how to set the secret and deploy.
//
// The mobile app can only reach this function with a signed-in Supabase session: this project's
// deploy does not pass --no-verify-jwt, so Supabase's gateway checks the JWT before this handler
// ever runs. The explicit Authorization check below is a second, independent guard in case that
// deploy flag is ever changed, and a reminder that a user id must always come from the verified
// token — never from the request body.
//
// The client (mobile/src/cloud/aiAssist.ts) is expected to send exactly an AiPayload —
// `{ task, fields }` — as produced by the data-minimisation boundary in
// mobile/../src/domain/aiPayload.ts. This function does not import that module (it runs on a
// different runtime, Deno rather than the app's bundler) but re-implements the same allow-list
// below and does not trust the client's own minimisation: a modified or compromised client must
// not be able to widen what actually reaches the provider. The prompt sent to the provider is
// built entirely from the validated fields below — the client never supplies, and this function
// never accepts, a ready-made prompt.

const MUSE_URL = 'https://api.meta.ai/v1/chat/completions';
const MODEL = 'muse-spark-1.3-contributor';

// The provider is a reasoning model: even "Reply with exactly: OK" consumed 121 reasoning tokens
// before any visible output. max_tokens: 300 came back HTTP 200 with content: null and
// finish_reason: "length" — a silent empty success. 2000 was enough to leave room for both the
// reasoning budget and a real answer in testing; do not lower this without re-verifying live.
const MAX_TOKENS = 2000;

// Mirrors the caps in mobile/../src/domain/aiPayload.ts. Enforced again here because the client's
// caps are a courtesy, not a security boundary — this function must not trust them.
const LIMITS = { title: 200, description: 1000, sentence: 500, maxTitles: 50 } as const;

type Json = Record<string, unknown>;

function jsonResponse(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function badRequest(message: string): Response {
  return jsonResponse({ error: message }, 400);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const sameKeys = (keys: string[], allowed: string[]) => keys.length === allowed.length && allowed.every(k => keys.includes(k));

interface ValidBreakdown { task: 'breakdown'; title: string; description: string; daysRemaining: number }
interface ValidProgressParse { task: 'progress-parse'; sentence: string }
interface ValidDailyPlan { task: 'daily-plan'; titles: string[]; times: string[] }
type Valid = ValidBreakdown | ValidProgressParse | ValidDailyPlan;

/**
 * Strict allow-list validation per task type. Any extra key, missing key, wrong type, or
 * over-limit value is rejected outright with a specific 400 — this function never silently drops
 * or truncates an unexpected field the way the client's own `buildPayload` clips over-long text;
 * defence in depth means treating anything unexpected as a hard error, not a best effort.
 */
function validate(body: unknown): Valid | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request body must be a JSON object.';
  const { task, fields } = body as Json;
  if (task !== 'breakdown' && task !== 'progress-parse' && task !== 'daily-plan') return 'Unknown or missing task.';
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return 'Missing fields object.';
  const f = fields as Json;
  const keys = Object.keys(f);

  if (task === 'breakdown') {
    if (!sameKeys(keys, ['title', 'description', 'daysRemaining'])) return 'breakdown requires exactly title, description, daysRemaining.';
    if (!isString(f.title) || !f.title.trim() || f.title.length > LIMITS.title) return 'Invalid title.';
    if (!isString(f.description) || f.description.length > LIMITS.description) return 'Invalid description.';
    if (typeof f.daysRemaining !== 'number' || !Number.isFinite(f.daysRemaining) || f.daysRemaining < 0) return 'Invalid daysRemaining.';
    return { task, title: f.title, description: f.description, daysRemaining: f.daysRemaining };
  }

  if (task === 'progress-parse') {
    if (!sameKeys(keys, ['sentence'])) return 'progress-parse requires exactly sentence.';
    if (!isString(f.sentence) || !f.sentence.trim() || f.sentence.length > LIMITS.sentence) return 'Invalid sentence.';
    return { task, sentence: f.sentence };
  }

  // daily-plan
  if (!sameKeys(keys, ['titles', 'times'])) return 'daily-plan requires exactly titles, times.';
  if (!isStringArray(f.titles) || f.titles.length === 0 || f.titles.length > LIMITS.maxTitles) return 'Invalid titles.';
  if (f.titles.some(t => !t.trim() || t.length > LIMITS.title)) return 'Invalid titles.';
  if (!isStringArray(f.times) || f.times.length !== f.titles.length) return 'Invalid times.';
  return { task, titles: f.titles, times: f.times };
}

/** Builds the actual provider prompt server-side, from validated fields only. */
function promptFor(v: Valid): string {
  if (v.task === 'breakdown') {
    return `You are helping someone break a project into small, concrete next steps.\n`
      + `Project title: ${v.title}\n`
      + `Description: ${v.description || '(none given)'}\n`
      + `Days remaining until it is due: ${v.daysRemaining}\n\n`
      + `Reply with only the steps, one short step per line, no numbering, no bullets, no headings, `
      + `no extra commentary. Aim for 3 to 6 steps.`;
  }
  if (v.task === 'progress-parse') {
    return `Someone wrote this status update about a project: "${v.sentence}"\n\n`
      + `Estimate how complete the project sounds as a single whole percent from 0 to 100. `
      + `Reply with only the number, no percent sign, no words.`;
  }
  const lines = v.titles.map((title, i) => `- ${title}${v.times[i] ? ` (due ${v.times[i]})` : ''}`).join('\n');
  return `Here are today's tasks:\n${lines}\n\n`
    + `Suggest a short, realistic order to tackle them today, as 3 to 6 sentences of plain prose. `
    + `No headings, no numbered list, no markdown.`;
}

type MuseOutcome = { text: string; usage?: { completionTokens?: number; reasoningTokens?: number } } | { error: string; status: number };

/** Calls the provider and turns its response into either the generated text or a specific, actionable error. Never returns an empty success. */
async function callMuse(prompt: string, apiKey: string): Promise<MuseOutcome> {
  let response: Response;
  try {
    response = await fetch(MUSE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }),
    });
  } catch {
    return { error: 'The AI provider could not be reached. Try again shortly.', status: 502 };
  }

  if (!response.ok) {
    // Never surface or log the provider's raw error body — it could echo request internals back.
    return { error: `The AI provider returned an error (${response.status}).`, status: 502 };
  }

  let body: unknown;
  try { body = await response.json(); }
  catch { return { error: 'The AI provider returned an invalid response.', status: 502 }; }

  const choices = (body as Json)?.choices;
  const first = Array.isArray(choices) ? (choices[0] as Json | undefined) : undefined;
  const message = first?.message as Json | undefined;
  const finishReason = first?.finish_reason;
  const content = message?.content;

  // Verified live: a reasoning model can return HTTP 200 with content: null and
  // finish_reason: "length" once its whole token budget was spent on hidden reasoning before any
  // visible output. That must never look like a successful empty answer.
  if (typeof content !== 'string' || !content.trim() || finishReason === 'length') {
    return {
      error: finishReason === 'length'
        ? 'The AI ran out of space to finish answering. Try a shorter project description or update.'
        : 'The AI did not return an answer. Try again.',
      status: 502,
    };
  }

  const usage = (body as Json)?.usage as Json | undefined;
  const details = usage?.completion_tokens_details as Json | undefined;
  const completionTokens = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : undefined;
  const reasoningTokens = typeof details?.reasoning_tokens === 'number' ? details.reasoning_tokens : undefined;

  return { text: content.trim(), usage: { completionTokens, reasoningTokens } };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST is supported.' }, 405);

  // Second, explicit guard alongside Supabase's own JWT verification (see the file header). Never
  // read a user id out of the request body — the only identity this function ever trusts is the
  // one implied by a bearer token actually being present, verified upstream by the gateway.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+/i.test(authHeader)) return jsonResponse({ error: 'Authentication is required.' }, 401);

  const apiKey = Deno.env.get('MUSE_API_KEY');
  if (!apiKey) return jsonResponse({ error: 'AI assistance is not configured on the server.' }, 500);

  let body: unknown;
  try { body = await req.json(); }
  catch { return badRequest('Request body must be valid JSON.'); }

  const validated = validate(body);
  if (typeof validated === 'string') return badRequest(validated);

  // Never log the request body, the built prompt, or the key.
  const prompt = promptFor(validated);
  const result = await callMuse(prompt, apiKey);
  if ('error' in result) return jsonResponse({ error: result.error }, result.status);

  return jsonResponse({ text: result.text, usage: result.usage });
});
