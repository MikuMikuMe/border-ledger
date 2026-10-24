/** Debug-only navigation preview: synthetic data, no native services or authentication. */
import React, {useEffect, useMemo, useState} from 'react';
import {StatusBar, Text, View} from 'react-native';
import {ShellNavigation, type Page} from '../screens/ShellNavigation';
import {ToolsFixtureScene} from './ToolsFixtureHost';
import {OverviewView} from '../features/finance/FinanceViews';
import {report} from './financeFixtures';
import type {Lens} from '../features/finance/contracts';
import type {ShellDestination} from '../features/auth/authModel';
type Fixture = {dark: boolean; destination?: ShellDestination};
declare global {var __borderLedgerShellFixture: {show(value: Fixture): void; hide(): void} | undefined;}
function PreviewPage({page, dark, onOpen}: {page: Page; dark: boolean; onOpen(page: Page): void}) {
  const fixture = useMemo(() => ({screen: page as 'settings' | 'capture' | 'devices' | 'files', state: 'ready', dark}), [page, dark]);
  const [lens, setLens] = useState<Lens>({window: 'Month', source: null, target: null, include: false});
  if (['settings', 'capture', 'devices', 'files'].includes(page)) return <ToolsFixtureScene fixture={fixture} onClose={() => onOpen('capture')}/>;
  if (page === 'overview') return <OverviewView dark={dark} state={{phase: 'ready', data: report, message: null}} snapshot={null} lens={lens} onLens={setLens} currencies={['CAD', 'CNY']} onRetry={() => {}}/>;
  return <Text style={{color: dark ? '#EEF1E8' : '#18201F', paddingVertical: 24}}>Synthetic {page} destination. Service content is tested separately.</Text>;
}
export function ShellFixtureHost({children}: {children: React.ReactNode}) {
  const [fixture, setFixture] = useState<Fixture | null>(null);
  useEffect(() => {
    globalThis.__borderLedgerShellFixture = {show: setFixture, hide: () => setFixture(null)};
    return () => {delete globalThis.__borderLedgerShellFixture;};
  }, []);
  if (!fixture) return children;
  return <View style={{flex: 1, backgroundColor: fixture.dark ? '#101715' : '#F3EFE6'}}>
    <StatusBar barStyle={fixture.dark ? 'light-content' : 'dark-content'}/>
    <ShellNavigation dark={fixture.dark} initialDestination={fixture.destination ?? 'overview'} onAbout={() => setFixture(null)} onSignOut={async () => setFixture(null)} renderPage={(page, onOpen) => <><Text style={{color: fixture.dark ? '#B1BDB5' : '#68706D'}}>Synthetic navigation preview</Text><PreviewPage page={page} dark={fixture.dark} onOpen={onOpen}/></>}/>
  </View>;
}
