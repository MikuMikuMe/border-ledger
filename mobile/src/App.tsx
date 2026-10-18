import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, StatusBar, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Uniwind } from 'uniwind';
import NativeSession, { type SessionSnapshot } from './native/specs/NativeSession';
import NativePreferences, { type Display } from './native/specs/NativePreferences';
import { SessionCoordinator, type DisplaySnapshot, type MobileAppSnapshot, type PreferencesPort, type SessionPort } from './features/auth/SessionCoordinator';
import type { SafeSessionSnapshot } from './features/auth/authModel';
import { statusBarStyle, watchSystemReducedMotion } from './features/auth/presentationPolicy';
import { LoginScreen } from './screens/LoginScreen';
import { AboutScreen } from './screens/AboutScreen';
import { AppShellScreen } from './screens/AppShellScreen';

type RootStackParamList = { Login: undefined; Shell: undefined; About: undefined };
const Stack = createNativeStackNavigator<RootStackParamList>();

const SESSION_STATES = new Set<SafeSessionSnapshot['state']>([
  'restoring', 'signing_in', 'awaiting_browser', 'exchanging', 'refreshing', 'signing_out',
  'signed_in', 'signed_out', 'expired', 'callback_rejected', 'storage_failure',
]);

function safeSession(value: SessionSnapshot): SafeSessionSnapshot {
  return {
    state: SESSION_STATES.has(value.state as SafeSessionSnapshot['state'])
      ? value.state as SafeSessionSnapshot['state']
      : 'storage_failure',
    expiresAt: value.expiresAt,
    pendingDestination: value.pendingDestination,
    reason: value.reason,
    pendingRevocations: value.pendingRevocations,
    environment: value.environment,
  };
}

function safeDisplay(value: Display): DisplaySnapshot {
  const appearanceMode = value.appearanceMode === 'Light' || value.appearanceMode === 'Dark'
    ? value.appearanceMode
    : 'System';
  return { appearanceMode, filter: value.filter, reducedMotion: value.reducedMotion };
}

const sessionPort: SessionPort = {
  getSnapshot: async () => safeSession(await NativeSession.getSnapshot()),
  refreshOnResume: async () => safeSession(await NativeSession.refreshOnResume()),
  beginLogin: async (staySignedIn, destination) => safeSession(await NativeSession.beginLogin(staySignedIn, destination)),
  signOut: async () => safeSession(await NativeSession.signOut()),
  consumePendingDestination: () => NativeSession.consumePendingDestination(),
  onStateChanged: (listener) => NativeSession.onStateChanged((value) => listener(safeSession(value))),
};

const preferencesPort: PreferencesPort = {
  getSnapshot: async () => safeDisplay(await NativePreferences.getSnapshot()),
  updateDisplay: async (value) => safeDisplay(await NativePreferences.updateDisplay(value)),
  onChanged: (listener) => NativePreferences.onChanged((value) => listener(safeDisplay(value))),
};

function themedNavigation(dark: boolean): Theme {
  const base = dark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: dark ? '#83C9B1' : '#1B6B5B',
      background: dark ? '#101715' : '#F3EFE6',
      card: dark ? '#101715' : '#F3EFE6',
      text: dark ? '#EEF1E8' : '#18201F',
      border: dark ? '#43534B' : '#D2CCC0',
    },
  };
}

function MobileRoot() {
  const coordinator = useMemo(() => new SessionCoordinator(sessionPort, preferencesPort), []);
  const [snapshot, setSnapshot] = useState<MobileAppSnapshot>(coordinator.current());
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [systemReducedMotion, setSystemReducedMotion] = useState(true);
  const previousState = useRef(AppState.currentState);
  const systemScheme = useColorScheme();

  useEffect(() => {
    const motion = watchSystemReducedMotion(AccessibilityInfo, setSystemReducedMotion);
    return () => motion.remove();
  }, []);

  useEffect(() => {
    const subscription = coordinator.listen(setSnapshot);
    void coordinator.start();
    const appState = AppState.addEventListener('change', (next) => {
      const wasActive = previousState.current === 'active';
      previousState.current = next;
      setActive(next === 'active');
      if (!wasActive && next === 'active') void coordinator.resume();
    });
    return () => { appState.remove(); subscription.remove(); coordinator.dispose(); };
  }, [coordinator]);

  useEffect(() => {
    const theme: 'system' | 'light' | 'dark' = snapshot.display.appearanceMode === 'System'
      ? 'system'
      : snapshot.display.appearanceMode === 'Dark' ? 'dark' : 'light';
    Uniwind.setTheme(theme);
  }, [snapshot.display.appearanceMode]);

  const route = snapshot.route;
  const dark = snapshot.display.appearanceMode === 'Dark' ||
    (snapshot.display.appearanceMode === 'System' && systemScheme === 'dark');
  const navTheme = themedNavigation(dark);

  return (
    <>
      <StatusBar barStyle={statusBarStyle(route === 'login' ? 'login' : 'shell', dark)} />
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          key={route}
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: navTheme.colors.background },
            headerTintColor: navTheme.colors.text,
            headerTitleStyle: { fontFamily: 'DMSans', fontWeight: '600' },
          }}
        >
          {route === 'login' ? (
            <>
              <Stack.Screen name="Login" options={{ headerShown: false }}>
                {({ navigation }) => (
                  <LoginScreen
                    session={snapshot.session}
                    display={{ ...snapshot.display, reducedMotion: snapshot.display.reducedMotion || systemReducedMotion }}
                    active={active}
                    onSignIn={(staySignedIn) => coordinator.beginLogin(staySignedIn)}
                    onAppearance={(mode) => coordinator.setAppearance(mode)}
                    onAbout={() => navigation.navigate('About')}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="About" options={{ title: 'About' }}>{() => <AboutScreen dark={dark} />}</Stack.Screen>
            </>
          ) : (
            <>
              <Stack.Screen name="Shell" options={{ headerShown: false }}>
                {({ navigation }) => (
                  <AppShellScreen
                    dark={dark}
                    initialDestination={snapshot.destination}
                    onAbout={() => navigation.navigate('About')}
                    onSignOut={() => coordinator.signOut()}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="About" options={{ title: 'About' }}>{() => <AboutScreen dark={dark} />}</Stack.Screen>
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}

export default function App() {
  if(__DEV__){
    const {LoginFixtureHost}=require('./dev/LoginFixtureHost') as typeof import('./dev/LoginFixtureHost');
    const {FinanceFixtureHost}=require('./dev/FinanceFixtureHost') as typeof import('./dev/FinanceFixtureHost');
    const {DetailsFixtureHost}=require('./dev/DetailsFixtureHost') as typeof import('./dev/DetailsFixtureHost');
    const {ToolsFixtureHost}=require('./dev/ToolsFixtureHost') as typeof import('./dev/ToolsFixtureHost');
    return <SafeAreaProvider><LoginFixtureHost><ToolsFixtureHost><DetailsFixtureHost><FinanceFixtureHost><MobileRoot /></FinanceFixtureHost></DetailsFixtureHost></ToolsFixtureHost></LoginFixtureHost></SafeAreaProvider>;
  }
  return <SafeAreaProvider><MobileRoot /></SafeAreaProvider>;
}
