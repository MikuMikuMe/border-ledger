import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { ShellDestination } from '@/features/auth/authModel';
import { DARK_TEXT_COLORS } from '@/features/auth/presentationPolicy';
import { FinanceScreen } from './FinanceScreen';
import { DetailsScreen } from './DetailsScreen';
import { ToolsScreen } from './ToolsScreen';

const destinations: { id: ShellDestination; label: string; note: string }[] = [
  { id: 'overview', label: 'Overview', note: 'Your cross-border picture, in original currencies or a locked reporting lens.' },
  { id: 'activity', label: 'Activity', note: 'Search your owner ledger and inspect source records.' },
  { id: 'recurring', label: 'Recurring', note: 'Expected commitments and actual posted cost.' },
  { id: 'review', label: 'Review', note: 'Inspect source evidence and resolve uncertain records.' },
  { id: 'accounts', label: 'Accounts', note: 'Account details and secure bank connections.' },
  { id: 'capture', label: 'Capture', note: 'Notification capture continues in the background.' },
  { id: 'settings', label: 'Settings', note: 'Reporting preferences, device choices, and ledger documents.' },
];

type Props = {
  dark: boolean;
  initialDestination: ShellDestination;
  onAbout(): void;
  onSignOut(): Promise<void>;
};

export function AppShellScreen({ dark, initialDestination, onAbout, onSignOut }: Props) {
  const [selected, setSelected] = useState(initialDestination);
  const [status, setStatus] = useState('');
  const [recurringId, setRecurringId] = useState<string|null>(null);
  useEffect(() => setRecurringId(null), [selected]);
  useEffect(() => setSelected(initialDestination), [initialDestination]);
  const current = destinations.find((item) => item.id === selected) ?? destinations[0];

  const signOut = async () => {
    setStatus('');
    try { await onSignOut(); } catch { setStatus('Sign-out could not finish. Your financial data remains locked.'); }
  };

  return (
    <SafeAreaView style={[styles.safe, dark && styles.safeDark]} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.brand, dark && styles.textDark]}>Border Ledger</Text>
            <Text style={[styles.kicker, dark && styles.mutedDark]}>NATIVE PREVIEW</Text>
          </View>
          <Pressable onPress={onAbout} accessibilityRole="button" style={({ pressed }) => [styles.about, pressed && styles.pressed]}>
            <Text style={[styles.aboutText, dark && styles.accentDark]}>About</Text>
          </Pressable>
        </View>

        <Text style={[styles.title, dark && styles.textDark]}>{current.label}</Text>
        <Text style={[styles.subtitle, dark && styles.mutedDark]}>{current.note}</Text>

        <View style={styles.nav} accessibilityRole="tablist">
          {destinations.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setSelected(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: selected === item.id }}
              style={({ pressed }) => [styles.navItem, dark && styles.surfaceDark, selected === item.id && styles.navItemSelected, pressed && styles.pressed]}
            >
              <Text style={[styles.navText, dark && styles.mutedDark, selected === item.id && styles.navTextSelected]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        {selected==='overview'||selected==='activity'||selected==='recurring'?<FinanceScreen dark={dark} destination={selected} onOpenRecurring={setRecurringId}/>:null}
        {selected==='review'||selected==='accounts'||selected==='recurring'?<DetailsScreen dark={dark} destination={selected} recurringId={recurringId} onCloseRecurring={()=>setRecurringId(null)}/>:null}
        {selected==='capture'||selected==='settings'?<ToolsScreen dark={dark} destination={selected}/>:null}

        {status ? <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.error, dark && styles.errorDark]}>{status}</Text> : null}
        <Button variant="outline" onPress={signOut} className="mt-6 h-12 rounded-xl"><Text>Sign out</Text></Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3EFE6' },
  safeDark: { backgroundColor: '#101715' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: '#18201F', fontFamily: 'DMSans', fontWeight: '600', fontSize: 18, lineHeight: 22 },
  kicker: { marginTop: 2, color: '#68706D', fontFamily: 'DMSans', fontWeight: '500', fontSize: 9, lineHeight: 12, letterSpacing: 1.4 },
  about: { minWidth: 54, minHeight: 48, alignItems: 'flex-end', justifyContent: 'center' },
  aboutText: { color: '#1B6B5B', fontFamily: 'DMSans', fontWeight: '500', fontSize: 14 },
  title: { marginTop: 54, color: '#18201F', fontFamily: 'Newsreader', fontWeight: '500', fontSize: 43, lineHeight: 47, letterSpacing: -0.9 },
  subtitle: { marginTop: 8, color: '#68706D', fontFamily: 'DMSans', fontSize: 15, lineHeight: 22 },
  nav: { marginTop: 28, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  navItem: { minHeight: 42, justifyContent: 'center', borderRadius: 21, borderWidth: 1, borderColor: '#D2CCC0', paddingHorizontal: 14, backgroundColor: '#FBF9F4' },
  navItemSelected: { backgroundColor: '#174B37', borderColor: '#174B37' },
  navText: { color: '#4F5C56', fontFamily: 'DMSans', fontWeight: '500', fontSize: 13 },
  navTextSelected: { color: '#F4F0E6' },
  placeholder: { marginTop: 26, borderRadius: 24, borderWidth: 1, borderColor: '#D2CCC0', backgroundColor: '#FBF9F4', padding: 22 },
  placeholderEyebrow: { color: '#996B1F', fontFamily: 'DMSans', fontWeight: '600', fontSize: 10, letterSpacing: 1.5 },
  placeholderTitle: { marginTop: 12, color: '#18201F', fontFamily: 'Newsreader', fontWeight: '600', fontSize: 27, lineHeight: 31 },
  placeholderBody: { marginTop: 9, color: '#4F5C56', fontFamily: 'DMSans', fontSize: 14, lineHeight: 21 },
  error: { marginTop: 16, color: '#A83F3F', fontFamily: 'DMSans', fontWeight: '500', fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.62 },
  textDark: { color: '#EEF1E8' },
  mutedDark: { color: DARK_TEXT_COLORS.muted },
  accentDark: { color: DARK_TEXT_COLORS.accent },
  warningDark: { color: DARK_TEXT_COLORS.warning },
  errorDark: { color: DARK_TEXT_COLORS.error },
  surfaceDark: { backgroundColor: '#1D2925', borderColor: '#43534B' },
});
