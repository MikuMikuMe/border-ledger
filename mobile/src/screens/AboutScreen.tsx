import React from 'react';
import { ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { DARK_TEXT_COLORS, statusBarStyle } from '@/features/auth/presentationPolicy';

export function AboutScreen({ dark = false }: { dark?: boolean }) {
  return (
    <SafeAreaView style={[styles.safe, dark && styles.safeDark]} edges={['bottom', 'left', 'right']}>
      <StatusBar barStyle={statusBarStyle('about', dark)} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.eyebrow, dark && styles.accentDark]}>BORDER LEDGER</Text>
        <Text style={[styles.title, dark && styles.textDark]}>Personal finance,{`\n`}composed quietly.</Text>
        <Text style={[styles.lead, dark && styles.mutedDark]}>
          A private workspace for understanding cross-border spending without turning every decision into a dashboard.
        </Text>
        <View style={[styles.rule, dark && styles.ruleDark]} />
        <Text style={[styles.heading, dark && styles.textDark]}>Designed around consent</Text>
        <Text style={[styles.body, dark && styles.mutedDark]}>
          Browser sign-in, notification capture, bank connections, imports, and exports remain explicit actions. Financial data stays locked whenever the owner session is unavailable.
        </Text>
        <Text style={[styles.heading, dark && styles.textDark]}>Built for quiet confidence</Text>
        <Text style={[styles.body, dark && styles.mutedDark]}>
          Every screen is a React Native view. Secure sign-in, financial records, capture, bank connections, and files continue through the app’s Android-protected services.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3EFE6' },
  safeDark: { backgroundColor: '#101715' },
  content: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 34, paddingBottom: 48 },
  eyebrow: { color: '#1B6B5B', fontFamily: 'DMSans', fontWeight: '600', fontSize: 11, letterSpacing: 1.6 },
  title: { marginTop: 14, color: '#18201F', fontFamily: 'Newsreader', fontWeight: '500', fontSize: 40, lineHeight: 43, letterSpacing: -0.8 },
  lead: { marginTop: 20, color: '#4F5C56', fontFamily: 'DMSans', fontSize: 17, lineHeight: 25 },
  rule: { height: 1, backgroundColor: '#D2CCC0', marginVertical: 30 },
  heading: { color: '#18201F', fontFamily: 'Newsreader', fontWeight: '600', fontSize: 23, lineHeight: 28, marginTop: 18 },
  body: { color: '#4F5C56', fontFamily: 'DMSans', fontSize: 15, lineHeight: 23, marginTop: 9 },
  textDark: { color: '#EEF1E8' },
  mutedDark: { color: '#A5B2AA' },
  accentDark: { color: DARK_TEXT_COLORS.accent },
  ruleDark: { backgroundColor: '#43534B' },
});
