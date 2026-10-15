import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync(
  resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml'),
  'utf8',
);

const androidTheme = readFileSync(
  resolve(process.cwd(), 'android/app/src/main/res/values/themes.xml'),
  'utf8',
);

const captureScreen = readFileSync(
  resolve(process.cwd(), 'android/app/src/main/java/com/lofuyu/borderledger/ui/onboarding/CaptureOnboardingScreen.kt'),
  'utf8',
);

const loginBackdrop = readFileSync(
  resolve(process.cwd(), 'android/app/src/main/java/com/lofuyu/borderledger/ui/login/LoginFlowBackdrop.kt'),
  'utf8',
);

const aboutScreen = readFileSync(
  resolve(process.cwd(), 'android/app/src/main/java/com/lofuyu/borderledger/ui/about/AboutScreen.kt'),
  'utf8',
);

const theme = readFileSync(
  resolve(process.cwd(), 'android/app/src/main/java/com/lofuyu/borderledger/ui/theme/BorderLedgerTheme.kt'),
  'utf8',
);

describe('Android interaction contract', () => {
  it('uses an edge-to-edge no-action-bar theme for the app shell', () => {
    expect(manifest).toContain('android:theme="@style/Theme.BorderLedger"');
    expect(androidTheme).toContain('parent="android:style/Theme.Material.Light.NoActionBar"');
    expect(androidTheme).toContain('android:windowNoTitle">true</item>');
  });

  it('keeps the login motion layer visibly authored and low-noise', () => {
    expect(loginBackdrop).toContain('drawCircle(');
    expect(loginBackdrop).toContain('drawRoundRect(');
    expect(loginBackdrop).toContain('FLOW_CYCLE_MILLIS');
  });

  it('keeps secondary entry screens on the same edge-to-edge surface', () => {
    expect(aboutScreen).toContain('safeDrawingPadding()');
    expect(aboutScreen).toContain('color = MaterialTheme.colorScheme.background');
    expect(aboutScreen).toContain('contentColor = MaterialTheme.colorScheme.onBackground');
  });

  it('defines the Material 3 surface containers for the paper palette', () => {
    expect(theme).toContain('surfaceContainer = Color(0xFFEFE9DE)');
    expect(theme).toContain('surfaceContainer = DarkSurface');
    expect(theme).toContain('outlineVariant = Color(0xFFBEB7AB)');
  });

  it('makes the complete capture-source row selectable and exposes its radio state', () => {
    expect(captureScreen).toContain('import androidx.compose.foundation.clickable');
    expect(captureScreen).toContain('import androidx.compose.ui.semantics.Role');
    expect(captureScreen).toContain('role = Role.RadioButton');
    expect(captureScreen).toContain('onClick = null');
    expect(captureScreen).toContain('selected = isSelected');
  });
});
