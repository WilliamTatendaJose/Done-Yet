import { useEffect, useState, useSyncExternalStore } from 'react';
import { createController } from './controller';
import { repository } from './database';
export function useMobileStore() {
  const [controller] = useState(() => createController(repository));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { void controller.load(); }, [controller]);
  return { ...snapshot, dispatch: controller.dispatch, retry: controller.load, importSnapshot: controller.replace, replaceRemote: controller.replaceRemote };
}
