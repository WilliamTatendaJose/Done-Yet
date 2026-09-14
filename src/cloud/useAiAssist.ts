import { useMemo } from 'react';
import type { AiPayload, AiTask } from '../../../src/domain/aiPayload';
import { buildPayload, describePayload } from '../../../src/domain/aiPayload';
import type { AppState } from '../../../src/domain/types';
import { createAiClient } from './aiAssist';
import { getSupabaseConfig } from './config';
import type { CloudResult, CloudTokenProvider } from './runtime';
import { proAccessReason, type ProAccess } from './subscriptionPolicy';

export interface AiAssistState {
  /** True only when all three preconditions hold: the user turned the setting on, this build is
   * configured for cloud sync, and the user is signed in (the ai-assist function requires a caller
   * Supabase can authenticate). A feature must check this before ever offering an AI action. */
  available: boolean;
  /** Calm, user-facing reason AI assistance can't be used right now; '' when `available` is true. */
  unavailableReason: string;
  /** Builds the minimised request for `task`, or null when `input` can't be minimised (see
   * domain/aiPayload.ts). Pure — makes no request. Callers must show `describe(payload)` and get
   * an explicit tap before ever calling `send`. */
  prepare(task: AiTask, input: unknown, now?: Date): AiPayload | null;
  /** Exactly what `send(payload)` would transmit, in plain language, for a confirmation prompt. */
  describe(payload: AiPayload): string;
  /** Sends `payload` — and only `payload` — to the ai-assist Edge Function. */
  send(payload: AiPayload): Promise<CloudResult<{ text: string }>>;
}

/**
 * Wires the ai-assist Edge Function client to `settings.aiAssistEnabled` and the existing cloud
 * sync session, without ever making a request the setting doesn't allow. `signedIn`/`token` come
 * from useCloudSync's session rather than opening a second one — the ai-assist function requires
 * the same authenticated caller as the rest of cloud sync.
 */
export function useAiAssist(state: AppState | null, signedIn: boolean, access: ProAccess, token: CloudTokenProvider): AiAssistState {
  const config = useMemo(() => getSupabaseConfig(), []);
  const enabled = !!state?.settings.aiAssistEnabled;
  const available = enabled && !!config && signedIn && !access.resolving && access.isPro;
  const unavailableReason = !enabled
    ? 'Turn on AI assistance in Settings to use this.'
    : !config
      ? 'Cloud is not configured for this build.'
      : !signedIn
        ? 'Sign in to cloud sync in Settings to use AI assistance.'
        : proAccessReason(access, 'AI assistance');
  const client = useMemo(() => config ? createAiClient({ url: config.url, apiKey: config.anonKey, token }) : null, [config, token]);

  return {
    available,
    unavailableReason,
    prepare: (task, input, now = new Date()) => buildPayload(task, input, now),
    describe: describePayload,
    async send(payload) {
      if (!available || !client) return { status: 'request-error', message: unavailableReason || 'AI assistance is not available.' };
      return client.request(payload);
    },
  };
}
