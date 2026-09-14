import { useEffect, useRef } from 'react';
import { suggestEscalation } from '../../../../src/domain/escalation';
import type { AppState, ReminderLevel } from '../../../../src/domain/types';
import type { Action } from '../../../../src/state/model';

export interface EscalationCandidate { taskId: string; title: string; level: ReminderLevel; reason: string }

/**
 * Behaviour-based escalation is suggestion-only at its core (`suggestEscalation` in the shared
 * domain layer never touches state). This hook is the one place a suggestion can turn into a real
 * `applyEscalation` dispatch, and it only does so when the user has explicitly turned on
 * `settings.autoEscalate` in Settings — off by default, per the reminder contract's ban on silently
 * raising intensity. With the setting off, suggestions are still returned so the caller can show them
 * and let the user apply one with an explicit tap.
 */
export function useEscalationSuggestions(state: AppState | null, now: number, dispatch: (action: Action) => Promise<boolean>): EscalationCandidate[] {
  const applied = useRef(new Set<string>());
  const suggestions: EscalationCandidate[] = [];
  if (state) {
    for (const task of state.tasks) {
      if (task.status !== 'todo') continue;
      const suggestion = suggestEscalation(task, new Date(now));
      if (suggestion) suggestions.push({ taskId: task.id, title: task.title, level: suggestion.level, reason: suggestion.reason });
    }
  }
  useEffect(() => {
    if (!state?.settings.autoEscalate) return;
    for (const s of suggestions) {
      const key = `${s.taskId}:${s.level}`;
      if (applied.current.has(key)) continue;
      applied.current.add(key);
      void dispatch({ type: 'applyEscalation', id: s.taskId, level: s.level });
    }
  });
  return suggestions;
}
