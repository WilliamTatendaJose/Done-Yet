import { useEffect, useRef, useState } from 'react';
import { AppState as DeviceAppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { AppState } from '../../../src/domain/types';
import type { Action } from '../../../src/state/model';
import { reconcileNotifications, responseAction } from './native';

export type NotificationDeliveryStatus = 'disabled' | 'checking' | 'available' | 'unavailable';

export function useNotifications(state: AppState | null, dispatch: (a: Action) => Promise<boolean>, openProject: () => void, openCoach: (taskId?: string) => void = () => {}) {
  const [error, setError] = useState('');
  const [count, setCount] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState<NotificationDeliveryStatus>('disabled');
  const current = useRef({ state, dispatch, openProject, openCoach }); current.current = { state, dispatch, openProject, openCoach };
  const handling = useRef(new Set<string>());
  useEffect(() => {
    const listener = DeviceAppState.addEventListener('change', value => { if (value === 'active') setRefresh(v => v + 1); });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!state) return;
    setStatus(current => state.settings.nativeNotificationsEnabled
      ? current === 'disabled' ? 'checking' : current
      : 'disabled');
    let alive = true;
    reconcileNotifications(state).then(result => {
      if (alive) {
        setCount(result.count);
        setStatus(state.settings.nativeNotificationsEnabled && result.granted ? 'available' : state.settings.nativeNotificationsEnabled ? 'unavailable' : 'disabled');
        setError(state.settings.nativeNotificationsEnabled && !result.granted ? 'Notifications are disabled in device settings. In-app reminders will continue while Done Yet? is open.' : '');
      }
    }).catch(() => {
      if (alive) {
        setStatus(state.settings.nativeNotificationsEnabled ? 'unavailable' : 'disabled');
        setError('Could not update device reminders. In-app reminders will continue while Done Yet? is open.');
      }
    });
    return () => { alive = false; };
  }, [state, refresh]);
  const ready = Boolean(state);
  useEffect(() => {
    if (!ready) return;
    const handle = async (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier + response.actionIdentifier;
      if (handling.current.has(id) || !current.current.state) return;
      handling.current.add(id);
      const data = response.notification.request.content.data ?? {};
      const action = responseAction(current.current.state, data, response.actionIdentifier, response.userText);
      const saved = action ? await current.current.dispatch(action) : true;
      if (saved) {
        Notifications.clearLastNotificationResponse();
        if (data.owner === 'done-yet' && data.kind === 'project') current.current.openProject();
        if (data.owner === 'done-yet' && data.kind === 'task' && response.actionIdentifier === 'BLOCKED') current.current.openCoach(typeof data.entityId === 'string' ? data.entityId : undefined);
      } else handling.current.delete(id);
    };
    const listener = Notifications.addNotificationResponseReceivedListener(response => { void handle(response); });
    const last = Notifications.getLastNotificationResponse();
    if (last) void handle(last);
    return () => listener.remove();
  }, [ready]);
  return { error, count, status, refresh: () => setRefresh(v => v + 1) };
}

