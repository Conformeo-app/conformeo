import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/core/auth';
import { AppRoot } from './src/AppRoot';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <AppRoot />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
