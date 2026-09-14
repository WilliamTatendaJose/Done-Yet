import type { IconName } from './components/ui';

export type TabName = 'Today' | 'Tasks' | 'Projects' | 'Coach' | 'Settings';

export const tabs: ReadonlyArray<{ name: TabName; icon: IconName }> = [
  { name: 'Today', icon: 'sunny-outline' },
  { name: 'Tasks', icon: 'list-outline' },
  { name: 'Projects', icon: 'layers-outline' },
  { name: 'Coach', icon: 'sparkles-outline' },
  { name: 'Settings', icon: 'options-outline' },
];
