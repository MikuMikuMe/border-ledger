import React, {useEffect, useRef, useState} from 'react';
import {BackHandler, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import type {ShellDestination} from '@/features/auth/authModel';

export type Page = ShellDestination | 'more' | 'devices' | 'files' | 'budget';
const titles: Record<Page, string> = {
  budget: 'Budget', overview: 'Overview', activity: 'Activity', review: 'Review', more: 'More',
  accounts: 'Accounts', recurring: 'Recurring', settings: 'Settings',
  capture: 'Notification capture', devices: 'Connected devices', files: 'Import and export',
};
const primary: Page[] = ['overview', 'activity', 'review', 'more'];
const ledgerLinks: Page[] = ['budget', 'accounts', 'recurring', 'files'];
const settingsLinks: Page[] = ['capture', 'devices'];
const descriptions: Partial<Record<Page, string>> = {
  budget: 'Plan and fund your categories', accounts: 'Balances and bank connections', recurring: 'Upcoming bills and subscriptions',
  files: 'Import statements or save your ledger', settings: 'Appearance, reporting and devices',
  capture: 'Set up automatic notification capture', devices: 'Manage access to your ledger',
};
export function initialPath(destination: Page): Page[] {
  return primary.includes(destination) ? [destination] : ['more', destination];
}
export function backPath(path: Page[]): Page[] {
  return path.length > 1 ? path.slice(0, -1) : ['overview'];
}
function NavigationRow({page, dark, onOpen}: {page: Page; dark: boolean; onOpen(page: Page): void}) {
  return <Pressable accessibilityRole="button" onPress={() => onOpen(page)} style={({pressed}) => [styles.row, themeStyles[Number(dark)].rule, pressed && styles.pressed]}>
    <Text style={[styles.rowTitle, themeStyles[Number(dark)].text]}>{titles[page]}</Text>
    <Text style={[styles.description, themeStyles[Number(dark)].muted]}>{descriptions[page]}</Text>
  </Pressable>;
}
function BottomItem({page, active, dark, onSelect}: {page: Page; active: boolean; dark: boolean; onSelect(page: Page): void}) {
  const selectedStyle = dark ? styles.darkActive : styles.activeTab;
  const textStyle = dark ? styles.darkText : styles.activeText;
  return <Pressable accessibilityRole="tab" accessibilityState={{selected: active}} onPress={() => onSelect(page)} style={({pressed}) => [styles.tab, active && selectedStyle, pressed && styles.pressed]}>
    <Text style={[styles.tabText, themeStyles[Number(dark)].muted, active && textStyle]}>{titles[page]}</Text>
  </Pressable>;
}
function BottomBar({selected, dark, onSelect}: {selected: Page; dark: boolean; onSelect(page: Page): void}) {
  const active = primary.includes(selected) ? selected : 'more';
  return <View accessibilityRole="tablist" style={[styles.bar, themeStyles[Number(dark)].rule]}>
    {primary.map(page => <BottomItem key={page} page={page} active={active === page} dark={dark} onSelect={onSelect}/>)}
  </View>;
}
type Props = {
  dark: boolean;
  initialDestination: ShellDestination;
  isFocused?: boolean;
  onAbout(): void;
  onSignOut(): Promise<void>;
  renderPage(page: Page, onOpen: (page: Page) => void): React.ReactNode;
};
function MorePage({dark, onOpen, onAbout, onSignOut, busy, status}: {dark: boolean; onOpen(page: Page): void; onAbout(): void; onSignOut(): void; busy: boolean; status: string}) {
  return <>
    <Text accessibilityRole="header" style={[styles.section, themeStyles[Number(dark)].muted]}>Your ledger</Text>
    {ledgerLinks.map(page => <NavigationRow key={page} page={page} dark={dark} onOpen={onOpen}/>)}
    <Text accessibilityRole="header" style={[styles.section, themeStyles[Number(dark)].muted]}>App and account</Text>
    <NavigationRow page="settings" dark={dark} onOpen={onOpen}/>
    <Pressable accessibilityRole="button" onPress={onAbout} style={styles.row}><Text style={[styles.rowTitle, themeStyles[Number(dark)].text]}>About Border Ledger</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityState={{disabled: busy}} disabled={busy} onPress={onSignOut} style={styles.row}><Text style={[styles.signOut, themeStyles[Number(dark)].error]}>{busy ? 'Signing out…' : 'Sign out'}</Text></Pressable>
    {status ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.signOut, themeStyles[Number(dark)].error]}>{status}</Text> : null}
  </>;
}
function useShellPath(initialDestination: ShellDestination, isFocused: boolean) {
  const [path, setPath] = useState<Page[]>(() => initialPath(initialDestination));
  const selected = path[path.length - 1];
  useEffect(() => setPath(initialPath(initialDestination)), [initialDestination]);
  useEffect(() => {
    if (!isFocused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (path.length === 1 && selected === 'overview') return false;
      setPath(backPath(path));
      return true;
    });
    return () => subscription.remove();
  }, [isFocused, path, selected]);
  return {path, setPath, selected};
}
function SettingsLinks({dark, onOpen}: {dark: boolean; onOpen(page: Page): void}) {
  return <><Text accessibilityRole="header" style={[styles.section, themeStyles[Number(dark)].muted]}>Capture and access</Text>{settingsLinks.map(page => <NavigationRow key={page} page={page} dark={dark} onOpen={onOpen}/>)}</>;
}
export function ShellNavigation({dark, initialDestination, isFocused = true, onAbout, onSignOut, renderPage}: Props) {
  const {path, setPath, selected} = useShellPath(initialDestination, isFocused);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const canGoBack = path.length > 1;
  useEffect(() => { scroll.current?.scrollTo({y: 0, animated: false}); }, [selected]);
  const open = (page: Page) => setPath(previous => [...previous, page]);
  const signOut = async () => {
    if (busy) return;
    setBusy(true); setStatus('');
    try { await onSignOut(); } catch { setStatus('Sign-out could not finish. Please try again.'); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={[styles.safe, themeStyles[Number(dark)].safe]} edges={['top', 'bottom', 'left', 'right']}>
    <View style={styles.header}>
      {canGoBack ? <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${titles[path[path.length - 2]]}`} onPress={() => setPath(backPath(path))} style={styles.back}><Text style={[styles.backText, themeStyles[Number(dark)].text]}>Back</Text></Pressable> : null}
      <Text accessibilityRole="header" style={[styles.title, themeStyles[Number(dark)].text]}>{titles[selected]}</Text>
    </View>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {selected === 'settings' ? <SettingsLinks dark={dark} onOpen={open}/> : null}
      {selected === 'more' ? <MorePage dark={dark} onOpen={open} onAbout={onAbout} onSignOut={() => {void signOut();}} busy={busy} status={status}/> : renderPage(selected, open)}

    </ScrollView>
    <BottomBar selected={selected} dark={dark} onSelect={page => setPath([page])}/>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#F3EFE6'}, darkSafe: {backgroundColor: '#101715'},
  header: {paddingHorizontal: 22, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 16},
  title: {flex: 1, fontFamily: 'Newsreader', fontSize: 30, lineHeight: 36, color: '#18201F'},
  back: {minWidth: 48, minHeight: 48, justifyContent: 'center'},
  backText: {fontFamily: 'DMSans', fontSize: 16, color: '#1B6B5B'},
  content: {width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 32},
  section: {fontFamily: 'DMSans', fontSize: 14, fontWeight: '600', color: '#68706D', marginTop: 28, marginBottom: 8},
  row: {minHeight: 56, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#D2CCC0'},
  rowTitle: {fontFamily: 'DMSans', fontSize: 18, color: '#18201F', fontWeight: '500'},
  description: {fontFamily: 'DMSans', fontSize: 14, lineHeight: 21, color: '#68706D', marginTop: 4},
  bar: {flexDirection: 'row', padding: 8, gap: 4, borderTopWidth: 1, borderColor: '#D2CCC0'},
  tab: {flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingVertical: 10},
  tabText: {fontFamily: 'DMSans', fontSize: 13, fontWeight: '500', color: '#4F5C56'},
  activeTab: {backgroundColor: '#DEE7DE'}, activeText: {color: '#174B37', fontWeight: '700'},
  signOut: {fontFamily: 'DMSans', fontSize: 16, color: '#A83F3F'}, pressed: {opacity: 0.65},
  darkText: {color: '#EEF1E8'}, darkMuted: {color: '#B1BDB5'}, darkRule: {borderColor: '#43534B'},
  darkActive: {backgroundColor: '#244C3D'}, darkError: {color: '#FFB4AB'},
});
const themeStyles = [
  {text: undefined, muted: undefined, rule: undefined, safe: undefined, error: undefined},
  {text: styles.darkText, muted: styles.darkMuted, rule: styles.darkRule, safe: styles.darkSafe, error: styles.darkError},
];
