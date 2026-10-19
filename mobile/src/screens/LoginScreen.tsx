import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThreadField } from '../components/threads/ThreadField';
import { LoginIcon } from '../components/threads/LoginIcon';
import { initialAuthControls, presentationForSession, type SafeSessionSnapshot } from '../features/auth/authModel';
import type { DisplaySnapshot } from '../features/auth/SessionCoordinator';

const APPEARANCES: DisplaySnapshot['appearanceMode'][] = ['System', 'Light', 'Dark'];
const ORIGINAL_ENTRANCE_EASING = Easing.bezier(0.16, 1, 0.3, 1);
type Props = {
  session: SafeSessionSnapshot; display: DisplaySnapshot; active: boolean;
  onSignIn(staySignedIn: boolean): Promise<void>;
  onAppearance(mode: DisplaySnapshot['appearanceMode']): Promise<void>; onAbout(): void;
};

function useLoginEntrance(reducedMotion: boolean) {
  const brandOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const brandOffset = useSharedValue(reducedMotion ? 0 : -8);
  const heroOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const heroOffset = useSharedValue(reducedMotion ? 0 : 16);
  const cardOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const cardOffset = useSharedValue(reducedMotion ? 0 : 24);
  const cardScale = useSharedValue(reducedMotion ? 1 : 0.985);

  useEffect(() => {
    const values = [brandOpacity, brandOffset, heroOpacity, heroOffset, cardOpacity, cardOffset, cardScale];
    if (reducedMotion) {
      brandOpacity.value = heroOpacity.value = cardOpacity.value = 1;
      brandOffset.value = heroOffset.value = cardOffset.value = 0;
      cardScale.value = 1;
    } else {
      brandOpacity.value = heroOpacity.value = cardOpacity.value = 0;
      brandOffset.value = -8;
      heroOffset.value = 16;
      cardOffset.value = 24;
      cardScale.value = 0.985;
      brandOpacity.value = withTiming(1, { duration: 450, easing: ORIGINAL_ENTRANCE_EASING });
      brandOffset.value = withTiming(0, { duration: 450, easing: ORIGINAL_ENTRANCE_EASING });
      heroOpacity.value = withDelay(80, withTiming(1, { duration: 600, easing: ORIGINAL_ENTRANCE_EASING }));
      heroOffset.value = withDelay(80, withTiming(0, { duration: 600, easing: ORIGINAL_ENTRANCE_EASING }));
      cardOpacity.value = withDelay(140, withTiming(1, { duration: 580, easing: ORIGINAL_ENTRANCE_EASING }));
      cardOffset.value = withDelay(140, withTiming(0, { duration: 580, easing: ORIGINAL_ENTRANCE_EASING }));
      cardScale.value = withDelay(140, withTiming(1, { duration: 580, easing: ORIGINAL_ENTRANCE_EASING }));
    }
    return () => values.forEach((value) => cancelAnimation(value));
  }, [reducedMotion, brandOpacity, brandOffset, heroOpacity, heroOffset, cardOpacity, cardOffset, cardScale]);

  return {
    brand: useAnimatedStyle(() => ({ opacity: brandOpacity.value, transform: [{ translateY: brandOffset.value }] })),
    hero: useAnimatedStyle(() => ({ opacity: heroOpacity.value, transform: [{ translateY: heroOffset.value }] })),
    card: useAnimatedStyle(() => ({ opacity: cardOpacity.value, transform: [{ translateY: cardOffset.value }, { scale: cardScale.value }] })),
  };
}

function loginHeroGap(fontScale: number, height: number, insetTop: number): number {
  if (fontScale > 1.3 || height < 600) return 24;
  return Math.max(24, height * 0.43 + Math.max(0, insetTop - 34) - insetTop - 48);
}

function SignInButton({ busy, onPress }: { busy: boolean; onPress(): void }) {
  return <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel="Sign in securely" accessibilityHint="Opens approval in your verified browser" accessibilityState={{ disabled: busy, busy }} style={({ pressed }) => [styles.signInButton, (pressed || busy) && styles.pressed]}>
    <LoginIcon name="fingerprint" size={24} color="#fff9ea" />
    <Text style={styles.signInText}>{busy ? 'Preparing secure sign-in…' : 'Sign in securely'}</Text>
    <View style={styles.arrow}><LoginIcon name="arrow" size={24} color="#fff9ea" /></View>
  </Pressable>;
}

function StaySignedIn({ checked, onToggle }: { checked: boolean; onToggle(): void }) {
  return <Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel="Stay signed in for up to 30 days" style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}>
    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked ? <Text style={styles.checkmark}>✓</Text> : null}</View>
    <View style={styles.checkCopy}><Text style={styles.checkTitle}>Stay signed in</Text><Text style={styles.checkBody}>Only on this device.</Text></View>
  </Pressable>;
}

function AuthCard({ presentation, status, staySignedIn, onToggle, onSignIn }: { presentation: ReturnType<typeof presentationForSession>; status: string; staySignedIn: boolean; onToggle(): void; onSignIn(): void }) {
  return <View style={styles.card}>
    <View style={styles.cardHeader}><View style={styles.cardHeading}><Text style={styles.cardTitle}>Welcome back</Text><Text style={styles.browserNote}>Continue in your verified browser.</Text></View><View style={styles.badge}><Text style={styles.badgeText}>Passkey ready</Text></View></View>
    <View style={styles.cardContent}>
      <SignInButton busy={presentation.busy} onPress={onSignIn} />
      {status ? <View style={styles.status} accessibilityLiveRegion="polite" accessibilityRole="alert"><Text style={styles.statusText}>{status}</Text></View> : null}
      <StaySignedIn checked={staySignedIn} onToggle={onToggle} />
    </View>
    <View style={styles.separator} />
    <View style={styles.boundary}><LoginIcon name="shield" size={14} color="#317057" /><Text style={styles.boundaryText}>Bank passwords never enter Border Ledger.</Text></View>
  </View>;
}

function LoginOptions({ open, display, onClose, onAppearance, onAbout }: { open: boolean; display: DisplaySnapshot; onClose(): void; onAppearance(mode: DisplaySnapshot['appearanceMode']): Promise<void>; onAbout(): void }) {
  return <Modal visible={open} transparent animationType={display.reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
    <View style={styles.modalBackdrop}><View style={styles.menu} accessibilityViewIsModal><ScrollView>
      <Text style={styles.menuTitle}>Appearance</Text>
      {APPEARANCES.map(mode => <Pressable key={mode} accessibilityRole="radio" accessibilityLabel={`Appearance: ${mode}`} accessibilityState={{ selected: display.appearanceMode === mode }} style={[styles.menuItem, display.appearanceMode === mode && styles.menuItemSelected]} onPress={async () => { onClose(); await onAppearance(mode); }}><Text style={styles.menuItemText}>{mode}</Text></Pressable>)}
      <Pressable accessibilityRole="button" accessibilityLabel="About" style={styles.menuItem} onPress={() => { onClose(); onAbout(); }}><Text style={styles.menuItemText}>About</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Close login options" style={styles.menuItem} onPress={onClose}><Text style={styles.menuItemText}>Close</Text></Pressable>
    </ScrollView></View></View>
  </Modal>;
}

export function LoginScreen({ session, display, active, onSignIn, onAppearance, onAbout }: Props) {
  const [staySignedIn, setStaySignedIn] = useState<boolean>(initialAuthControls().staySignedIn);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState('');
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const presentation = presentationForSession(session);
  const status = localStatus || presentation.status;
  const entrance = useLoginEntrance(display.reducedMotion);
  // Original frame has a 34px simulated status area. Real cutout space replaces
  // that area, rather than adding a second status bar. Compact/large text flows.
  const heroGap = loginHeroGap(fontScale, height, insets.top);
  const signIn = async () => {
    setLocalStatus('');
    try { await onSignIn(staySignedIn); }
    catch { setLocalStatus('Secure sign-in could not start. Check your connection and try again.'); }
  };
  return <View style={styles.screen}>
    <ThreadField active={active} reducedMotion={display.reducedMotion} />
    <SafeAreaView style={styles.safe} edges={['top','bottom','left','right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
        <Animated.View style={[styles.brandRow, entrance.brand]}>
          <Text style={styles.brand}>Border Ledger</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Login options" accessibilityHint="Appearance and About" onPress={()=>setOptionsOpen(true)} style={({pressed})=>[styles.options,pressed&&styles.pressed]}><Text style={styles.optionsText}>•••</Text></Pressable>
        </Animated.View>
        <Animated.View style={[styles.hero,{marginTop:heroGap},entrance.hero]}>
          <Text style={styles.kicker}>Personal finance, composed.</Text>
          <Text accessibilityRole="header" style={styles.heroTitle}>See the flow.{`\n`}Keep the perspective.</Text>
        </Animated.View>
        <View style={styles.cardSpacer}/>
        <Animated.View style={[styles.card,entrance.card]}>
          <AuthCard presentation={presentation} status={status} staySignedIn={staySignedIn} onToggle={()=>setStaySignedIn(value=>!value)} onSignIn={signIn}/>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
    <LoginOptions open={optionsOpen} display={display} onClose={()=>setOptionsOpen(false)} onAppearance={onAppearance} onAbout={onAbout}/>
  </View>;
}

const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:'#06130f'},safe:{flex:1},
  content:{flexGrow:1,width:'100%',maxWidth:480,alignSelf:'center',paddingHorizontal:15,paddingTop:5,paddingBottom:5},
  brandRow:{height:48,marginTop:-5,marginHorizontal:7,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  brand:{color:'#f4efe0',fontFamily:'DMSans',fontWeight:'600',fontSize:12,lineHeight:18,includeFontPadding:false},
  options:{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},optionsText:{color:'#b3c9bb',fontSize:14,letterSpacing:2},
  hero:{marginHorizontal:8},kicker:{fontFamily:'IBMPlexMono',fontSize:9,lineHeight:11,letterSpacing:.72,textTransform:'uppercase',color:'#b3c9bb',marginBottom:8,includeFontPadding:false},
  heroTitle:{fontFamily:'NewsreaderDisplay',fontWeight:'500',fontSize:38,lineHeight:37.24,letterSpacing:-.95,color:'#f4efe0',includeFontPadding:false,textShadowColor:'rgba(0,0,0,.4)',textShadowOffset:{width:0,height:2},textShadowRadius:18},
  cardSpacer:{flexGrow:1,minHeight:24},card:{borderWidth:1,borderColor:'rgba(255,255,255,.52)',borderRadius:19,paddingTop:15,gap:10,backgroundColor:'rgba(245,241,226,.94)',shadowColor:'#000805',shadowOffset:{width:0,height:24},shadowOpacity:.32,shadowRadius:25,elevation:12},
  cardHeader:{paddingHorizontal:16,flexDirection:'row',justifyContent:'space-between',gap:10,alignItems:'flex-start'},cardHeading:{flex:1},
  cardTitle:{fontFamily:'Newsreader',fontWeight:'600',fontSize:17,lineHeight:20.4,letterSpacing:-.255,color:'#122c23',includeFontPadding:false},browserNote:{fontFamily:'DMSans',fontSize:9,lineHeight:13.5,marginTop:2,color:'#5f7069',includeFontPadding:false},
  badge:{borderRadius:999,paddingHorizontal:7,paddingVertical:2,minHeight:20,backgroundColor:'#dfeadf',justifyContent:'center'},badgeText:{fontFamily:'DMSans',fontSize:8,lineHeight:12,color:'#275744',includeFontPadding:false},
  cardContent:{paddingHorizontal:16},signInButton:{minHeight:48,paddingHorizontal:14,paddingVertical:8,borderRadius:12,backgroundColor:'#123f31',flexDirection:'row',alignItems:'center',gap:9,shadowColor:'#123f31',shadowOffset:{width:0,height:7},shadowOpacity:.2,shadowRadius:9,elevation:3},signInText:{flexShrink:1,color:'#fff9ea',fontFamily:'DMSans',fontWeight:'600',fontSize:12,lineHeight:18,includeFontPadding:false},arrow:{marginLeft:'auto'},
  checkRow:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10,paddingVertical:5},checkbox:{width:18,height:18,borderRadius:3,borderWidth:1,borderColor:'#8c9b94',backgroundColor:'#fff',alignItems:'center',justifyContent:'center'},checkboxChecked:{backgroundColor:'#27664f',borderColor:'#27664f'},checkmark:{color:'#fff',fontSize:12,lineHeight:15,includeFontPadding:false},checkCopy:{flex:1,flexDirection:'row',flexWrap:'wrap',alignItems:'baseline',gap:5},checkTitle:{fontFamily:'DMSans',fontWeight:'600',fontSize:10,lineHeight:15,color:'#24443a',includeFontPadding:false},checkBody:{fontFamily:'DMSans',fontSize:8,lineHeight:12,color:'#6b7c74',includeFontPadding:false},
  separator:{height:1,backgroundColor:'rgba(18,44,35,.12)'},boundary:{minHeight:34,flexDirection:'row',alignItems:'center',gap:7,paddingHorizontal:16,paddingTop:8,paddingBottom:9,backgroundColor:'rgba(218,227,215,.62)',borderBottomLeftRadius:18,borderBottomRightRadius:18},boundaryText:{flex:1,color:'#5e6e67',fontFamily:'IBMPlexMono',fontSize:8,lineHeight:12,includeFontPadding:false},
  status:{marginTop:10,borderRadius:10,backgroundColor:'#e9e2d3',padding:10},statusText:{color:'#203a30',fontFamily:'DMSans',fontSize:12,lineHeight:18},pressed:{opacity:.62},
  modalBackdrop:{flex:1,backgroundColor:'rgba(3,15,10,.58)',alignItems:'center',justifyContent:'center',padding:28},menu:{width:'100%',maxWidth:340,maxHeight:'90%',borderRadius:24,backgroundColor:'#f4f0e6',padding:16},menuTitle:{color:'#203a30',fontFamily:'Newsreader',fontWeight:'600',fontSize:25,lineHeight:30,marginBottom:8},menuItem:{minHeight:50,borderRadius:14,justifyContent:'center',paddingHorizontal:14,paddingVertical:10},menuItemSelected:{backgroundColor:'#dcebe3'},menuItemText:{color:'#203a30',fontFamily:'DMSans',fontWeight:'500',fontSize:15},
});
