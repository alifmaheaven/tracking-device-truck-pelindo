import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import notifee from '@notifee/react-native';

// MOB-#2: return a resolved promise with the notification to prevent unsettled
//   promise accumulation. The foreground service lifecycle is managed by notifee
//   internally — our promise just expresses that we acknowledge the service start.
notifee.registerForegroundService((notification) => {
  return Promise.resolve();  // MOB-#2: return void to match ForegroundServiceTask signature
});

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
