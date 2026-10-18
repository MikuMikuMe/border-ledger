import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const mainActivity = read('android/app/src/main/java/com/lofuyu/borderledger/MainActivity.kt');
const reactActivity = read('android/app/src/main/java/com/lofuyu/borderledger/react/BorderLedgerReactActivity.kt');
const application = read('android/app/src/main/java/com/lofuyu/borderledger/BorderLedgerApplication.kt');
const androidTheme = read('android/app/src/main/res/values/themes.xml');
const app = read('mobile/src/App.tsx');
const login = read('mobile/src/screens/LoginScreen.tsx');
const threadField = read('mobile/src/components/threads/ThreadField.tsx');
const geometry = read('shared/threads/ThreadGeometry.ts');
const about = read('mobile/src/screens/AboutScreen.tsx');

describe('Android React Native production surface', () => {
  it('applies keyboard resize mode to the actual production launcher activity', () => {
    const launcherTag = manifest.match(/<activity\b(?=[^>]*android:name="\.MainActivity")[^>]*>/s)?.[0] ?? '';
    expect(launcherTag).toContain('android:windowSoftInputMode="adjustResize"');
  });

  it('accepts the React Native Threads login in the Android production static gate', () => {
    const output = execFileSync('pwsh', [
      '-NoProfile',
      '-File',
      resolve(root, 'android/task5-static-check.ps1'),
    ], { encoding: 'utf8' });

    expect(output).toContain('TASK5_STATIC_OK');
  });

  it('keeps the installed launcher name while opening the shared React host', () => {
    expect(manifest).toContain('android:name=".MainActivity"');
    expect(manifest).toContain('android:icon="@drawable/border_ledger_logo"');
    expect(mainActivity).toContain('class MainActivity : BorderLedgerReactActivity()');
    expect(reactActivity).toContain('abstract class BorderLedgerReactActivity : ReactActivity(), NativeServiceHost');
    expect(androidTheme).toContain('Theme.AppCompat.DayNight.NoActionBar');
    expect(existsSync(resolve(root, 'android/app/src/main/res/drawable-nodpi/border_ledger_logo.png'))).toBe(true);
  });

  it('registers native modules in release without starting React Native in headless workers', () => {
    expect(application).toContain('add(com.lofuyu.borderledger.react.NativeServicePackage(nativeServices))');
    const onCreate = application.match(/override fun onCreate\(\)\s*\{([\s\S]*?)\n    \}/)?.[1];
    expect(onCreate).toBeTruthy();
    expect(onCreate).not.toContain('loadReactNative(');
    expect(reactActivity).toContain('initializeReactNative()');
  });

  it('renders the original 88-strand Threads field through Skia and Reanimated', () => {
    expect(geometry).toContain('export const THREAD_COUNT = 88;');
    expect(geometry).toContain('export const THREAD_SPEED = 0.58;');
    expect(geometry).toContain('export const REDUCED_MOTION_PHASE = 1.8;');
    expect(geometry).toContain('export const CANONICAL_THREAD_TARGET_FPS = 30;');
    expect(threadField).toContain('advanceCanonicalThreadPhase');
    expect(threadField).toContain('consumeCanonicalThreadFrameBudget');
    expect(threadField).toContain('canonicalThreadPaint');
    expect(threadField).toContain('useFrameCallback');
    expect(threadField).toContain('FractalNoise');
    expect(login).toContain('<ThreadField active={active} reducedMotion={display.reducedMotion} />');
  });

  it('uses the original stagger, offsets, scale, and reduced-motion behavior', () => {
    expect(login).toContain('Easing.bezier(0.16, 1, 0.3, 1)');
    expect(login).toContain('duration: 450');
    expect(login).toContain('duration: 600');
    expect(login).toContain('duration: 580');
    expect(login).toContain('withDelay(80');
    expect(login).toContain('withDelay(140');
    expect(login).toContain('brandOffset.value = -8');
    expect(login).toContain('heroOffset.value = 16');
    expect(login).toContain('cardOffset.value = 24');
    expect(login).toContain('cardScale.value = 0.985');
    expect(login).toContain('if (display.reducedMotion)');
  });

  it('uses Android safe areas, real system bars, and the existing appearance modes', () => {
    expect(app).toContain('<SafeAreaProvider>');
    expect(app).toContain('<StatusBar');
    expect(app).toContain("useColorScheme()");
    expect(app).toContain('Uniwind.setTheme(theme)');
    expect(login).toContain('<SafeAreaView');
    expect(login).toContain('useSafeAreaInsets()');
    expect(about).toContain('<SafeAreaView');
    expect(about).not.toContain('Current migration preview');
  });
});
