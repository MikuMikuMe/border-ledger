/** Debug-only Wealth scenes. Release builds never import this host. */
import React, { useEffect, useState } from 'react';
import { ScrollView, StatusBar, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, Copy } from '../features/finance/FinanceViews';
import { WealthScreen } from '../screens/WealthScreen';
import { ShellNavigation } from '../screens/ShellNavigation';
import { localWealthService } from './LocalWealthService';
import { nativeWealthFixture } from './NativeWealthFixture';

type Scene = { dark: boolean; screen?: 'wealth' | 'wealth-shell-api' };
declare global { var __borderLedgerWealthFixture: { show(value: Scene): void; hide(): void } | undefined; }

function LocalWealthPreview({ scene }: { scene: Scene }) {
  const backgroundColor = scene.dark ? '#101715' : '#F3EFE6';
  if (scene.screen === 'wealth-shell-api') return <View style={{ flex: 1, backgroundColor }}><StatusBar barStyle={scene.dark ? 'light-content' : 'dark-content'}/><ShellNavigation dark={scene.dark} initialDestination="overview" onAbout={() => {}} onSignOut={async () => globalThis.__borderLedgerWealthFixture?.hide()} renderPage={page => page === 'wealth' ? <WealthScreen dark={scene.dark} service={localWealthService}/> : <Copy dark={scene.dark}>Synthetic local Wealth API. Open More, then Wealth.</Copy>}/></View>;
  return <SafeAreaView style={{ flex: 1, backgroundColor }}><StatusBar barStyle={scene.dark ? 'light-content' : 'dark-content'}/><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, paddingBottom: 40 }}><View style={{ gap: 12 }}><Copy dark={scene.dark} heading>Synthetic local Wealth API</Copy><WealthScreen dark={scene.dark} service={localWealthService}/></View></ScrollView></SafeAreaView>;
}

function shouldRenderLaunchError(launchError: boolean, scene: Scene | null): boolean {
  if (!__DEV__) return false;
  if (!launchError) return false;
  return scene === null;
}

export function WealthFixtureHost({ children }: { children: React.ReactNode }) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [launchError, setLaunchError] = useState(false);
  const launchFixture = () => {
    setLaunchError(false);
    void nativeWealthFixture.getLaunchScene().then(value => {
      if (value) setScene({ screen: 'wealth-shell-api', dark: value.dark });
    }).catch(() => setLaunchError(true));
  };
  useEffect(() => {
    globalThis.__borderLedgerWealthFixture = { show: value => setScene({ screen: 'wealth-shell-api', ...value }), hide: () => { setScene(null); setLaunchError(false); } };
    launchFixture();
    return () => { delete globalThis.__borderLedgerWealthFixture; };
  }, []);
  if (shouldRenderLaunchError(launchError, scene)) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: '#F3EFE6' }}><View style={{ flex: 1, gap: 12, padding: 22, justifyContent: 'center' }}><Copy dark={false} heading>Wealth fixture unavailable</Copy><Text style={{ color: '#68706D', fontSize: 16, lineHeight: 24 }}>The debug Wealth service could not start. Retry to reload the fixture.</Text><Action dark={false} label="Retry Wealth fixture" onPress={launchFixture}/></View></SafeAreaView>;
  }
  if (!scene || !__DEV__) return children;
  return <LocalWealthPreview scene={scene}/>;
}
