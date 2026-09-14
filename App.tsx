import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { MobileApp } from './src/application/MobileApp';

export default function App() {
  return <SafeAreaProvider><ErrorBoundary><MobileApp /></ErrorBoundary></SafeAreaProvider>;
}
