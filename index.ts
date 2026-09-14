import { registerRootComponent } from 'expo';

import App from './App';
import { registerNextTaskWidgetHandler } from './src/features/widget/widgetTaskHandler';

// Registers the home-screen widget's headless task handler. Must happen at module load, unconditionally,
// so Android can invoke it even when the app's own UI never mounts (a background widget refresh).
registerNextTaskWidgetHandler();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
