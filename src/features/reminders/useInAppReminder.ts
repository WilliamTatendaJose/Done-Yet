import { useEffect, useState } from 'react';
import { getDueReminders } from '../../../../src/domain/engine';
import type { AppState } from '../../../../src/domain/types';
import type { Action } from '../../../../src/state/model';

interface Options {
  state: AppState | null;
  now: number;
  editorOpen: boolean;
  backgroundDeliveryAvailable: boolean;
  dispatch: (action: Action) => Promise<boolean>;
}

export function useInAppReminder({ state, now, editorOpen, backgroundDeliveryAvailable, dispatch }: Options) {
  const [reminderId, setReminderId] = useState<string | null>(null);

  useEffect(() => {
    if (!state) {
      setReminderId(null);
      return;
    }
    const hour = new Date(now).getHours();
    const { quietStart, quietEnd } = state.settings;
    const quiet = state.settings.quietHoursEnabled && (
      quietStart === quietEnd
      || (quietStart < quietEnd ? hour >= quietStart && hour < quietEnd : hour >= quietStart || hour < quietEnd)
    );
    if (backgroundDeliveryAvailable || state.focus || editorOpen || quiet || state.settings.remindersPaused) {
      setReminderId(null);
      return;
    }
    if (state.tasks.some(task => task.id === reminderId && task.status === 'todo')) return;
    const candidate = getDueReminders(state.tasks, state.settings, new Date(now))[0];
    if (!candidate) {
      setReminderId(null);
      return;
    }
    setReminderId(candidate.id);
    void dispatch({ type: 'markReminded', id: candidate.id }).then(saved => {
      if (!saved) setReminderId(current => current === candidate.id ? null : current);
    });
  }, [backgroundDeliveryAvailable, dispatch, editorOpen, now, reminderId, state]);

  return {
    reminder: state?.tasks.find(task => task.id === reminderId && task.status === 'todo'),
    dismiss: () => setReminderId(null),
  };
}
