import { registerRootComponent } from 'expo';

import App from './App';
import { registerNextTaskWidgetHandler } from './src/features/widget/widgetTaskHandler';
import { registerWidgetConfigurationScreen } from 'react-native-android-widget';
import { WidgetConfigurationScreen } from './src/features/widget/WidgetConfigurationScreen';

// Registers the home-screen widget's headless task handler, and the screen Android opens to
// configure one. Both must happen at module load, unconditionally, so Android can invoke them even
// when the app's own UI never mounts (a background widget refresh, or a configure from the launcher).
registerNextTaskWidgetHandler();
registerWidgetConfigurationScreen(WidgetConfigurationScreen);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
