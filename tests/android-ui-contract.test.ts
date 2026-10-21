import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n?/g, '\n');
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
const externalServices = read('android/app/src/main/java/com/lofuyu/borderledger/react/NativeExternalServices.kt');
const plaidResultStore = read('android/app/src/main/java/com/lofuyu/borderledger/react/PendingPlaidResultStore.kt');
const bridgeOperationJournal = read('android/app/src/main/java/com/lofuyu/borderledger/react/BridgeOperationJournal.kt');
const detailsViews = read('mobile/src/features/details/DetailsViews.tsx');

const kotlinFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = resolve(directory, entry.name);
  if (entry.isDirectory()) return kotlinFiles(path);
  return entry.isFile() && entry.name.endsWith('.kt') ? [path] : [];
});

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
  }, 15_000);

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

  it('declares leaf worklet assertions before callers for Hermes closure capture', () => {
    expect(geometry.indexOf('function assertThreadDimension(value')).toBeLessThan(
      geometry.indexOf('function assertThreadDimensions('),
    );
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
    expect(login).toContain('useLoginEntrance(display.reducedMotion)');
    expect(login).toContain('if (reducedMotion)');
    expect(login).toContain('brandOpacity.value = heroOpacity.value = cardOpacity.value = 1;');
    expect(login).toContain('brandOffset.value = heroOffset.value = cardOffset.value = 0;');
    expect(login).toContain('cardScale.value = 1;');
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

  it('ships no Compose source or runtime dependency in any Android variant', () => {
    const composeSources = kotlinFiles(resolve(root, 'android/app/src'))
      .filter((path) => /androidx\.compose|@Composable|setContent\s*\{/.test(readFileSync(path, 'utf8')));
    const gradle = [
      read('android/app/build.gradle.kts'),
      read('android/build.gradle.kts'),
      read('android/gradle/libs.versions.toml'),
    ].join('\n');

    expect(composeSources).toEqual([]);
    expect(gradle).not.toMatch(/androidx\.compose|activity-compose|kotlin\.plugin\.compose|libs\.plugins\.kotlin\.compose|compose\s*=\s*true/);
  });

  it('supplies a short native staging root for Windows CMake builds', () => {
    const androidGradle = read('android/app/build.gradle.kts');
    const sharedCoreGradle = read('shared/core/build.gradle.kts');
    const gradleProperties = read('android/gradle.properties');
    const appBuild = read('.github/workflows/app-build.yml');
    const androidCi = read('.github/workflows/android-ci.yml');
    const androidRelease = read('.github/workflows/android-release.yml');
    const iosCore = androidCi.split('  ios-core:')[1]?.split('  android-instrumentation:')[0] ?? '';
    expect(gradleProperties).not.toContain('android.enableJetifier=true');
    expect(androidGradle).toContain('compileSdkMinor = 0');
    expect(sharedCoreGradle).toContain('compileSdk = 36');
    expect(sharedCoreGradle).not.toContain('compileSdkMinor');
    expect(androidGradle).toContain('arguments += "-DCMAKE_OBJECT_PATH_MAX=250"');
    expect(androidGradle).toContain('buildStagingDirectory = file(providers.gradleProperty("borderLedgerCxxRoot")');
    for (const workflow of [appBuild, androidCi, androidRelease]) {
      expect(workflow).toContain('        env:\n          ORG_GRADLE_PROJECT_borderLedgerCxxRoot: ${{ runner.temp }}/bl-cxx');
      expect(workflow).not.toContain('    env:\n      ORG_GRADLE_PROJECT_borderLedgerCxxRoot: ${{ runner.temp }}/bl-cxx');
      expect(workflow).toContain("platforms;android-37.0' --channel=3");
      expect(workflow).not.toContain("platforms;android-37' --channel=3");
    }
    expect(iosCore).not.toContain('platforms;android-37');
  });

  it('recovers a Plaid callback from encrypted native state with its original idempotency key', () => {
    expect(plaidResultStore).toContain('SecureRecordPort');
    expect(externalServices).toContain('plaidResultStore.save(handoff.owner, handoff.id, publicToken.value)');
    expect(externalServices).toContain('recoverPendingPlaidResult()');
    expect(externalServices).toContain('retryExternalWithSameIdempotency(handoff.key)');
    expect(externalServices).not.toContain('if(records.read(marker)!=null) return@withOwner');
    expect(bridgeOperationJournal).toContain('Only an unresolved external operation can be reconciled.');
    expect(detailsViews).toContain("reconciliation_required:'The bank connection is being reconciled.");
    expect(detailsViews).toContain("link?.state==='reconciliation_required'");
  });
});
