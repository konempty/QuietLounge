import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import 'react-native-reanimated';

import { BlockListContext } from '@/hooks/useBlockList';
import { useBlockListProvider } from '@/hooks/useBlockList';
import { KeywordAlertsContext, useKeywordAlertsProvider } from '@/hooks/useKeywordAlerts';
import '@/utils/background-task'; // setNotificationHandler 등록
import { setupNotificationChannel } from '@/utils/background-task';
import Colors from '@/constants/Colors';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

const QLDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.primary,
    background: Colors.dark.background,
    card: Colors.dark.background,
  },
};

const QLLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.primary,
    background: Colors.light.background,
    card: Colors.light.card,
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  useEffect(() => {
    setupNotificationChannel();
  }, []);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const blockListValue = useBlockListProvider();
  const keywordAlertsValue = useKeywordAlertsProvider();

  return (
    <BlockListContext.Provider value={blockListValue}>
      <KeywordAlertsContext.Provider value={keywordAlertsValue}>
        <ThemeProvider value={colorScheme === 'dark' ? QLDarkTheme : QLLightTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </ThemeProvider>
      </KeywordAlertsContext.Provider>
    </BlockListContext.Provider>
  );
}
