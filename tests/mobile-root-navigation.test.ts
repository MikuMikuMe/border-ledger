import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const React = require('react');
const { act, create } = require('react-test-renderer');
const native = vi.hoisted(() => ({
  session: {
    state: 'signed_out', expiresAt: null, pendingDestination: null, reason: null,
    pendingRevocations: 0, environment: 'synthetic',
  },
  listener: undefined as undefined | ((value: unknown) => void),
}));

vi.mock('../mobile/node_modules/react-native/index.js', () => ({
  StatusBar: 'StatusBar',
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  AccessibilityInfo: {
    isReduceMotionEnabled: async () => true,
    addEventListener: () => ({ remove() {} }),
  },
  useColorScheme: () => 'light',
}));
vi.mock('../mobile/node_modules/react-native-safe-area-context/lib/commonjs/index.js', () => ({
  SafeAreaProvider: ({ children }: any) => children,
}));
vi.mock('../mobile/node_modules/uniwind/dist/module/index.js', () => ({ Uniwind: { setTheme() {} } }));
vi.mock('../mobile/src/native/specs/NativeSession', () => ({ default: {
  getSnapshot: async () => native.session,
  onStateChanged: (listener: (value: unknown) => void) => {
    native.listener = listener;
    return { remove() { native.listener = undefined; } };
  },
  consumePendingDestination: async () => null,
} }));
vi.mock('../mobile/src/native/specs/NativePreferences', () => ({ default: {
  getSnapshot: async () => ({ appearanceMode: 'System', filter: 'All', reducedMotion: true }),
  onChanged: () => ({ remove() {} }),
} }));

// Use React Navigation's real container, router, descriptors and child validation;
// the device's stack view is replaced with rendering the focused descriptor.
vi.mock('../mobile/node_modules/@react-navigation/native/lib/module/index.js', () => {
  const core = require('@react-navigation/core');
  return { ...core, NavigationContainer: core.BaseNavigationContainer,
    DarkTheme: { dark: true, colors: {} }, DefaultTheme: { dark: false, colors: {} } };
});
vi.mock('../mobile/node_modules/@react-navigation/native-stack/lib/module/index.js', () => {
  const { createNavigatorFactory, useNavigationBuilder, StackRouter } = require('@react-navigation/core');
  function DeviceFreeStack(props: any) {
    const { state, descriptors, render } = useNavigationBuilder(StackRouter, props);
    return render(descriptors[state.routes[state.index].key].render());
  }
  return { createNativeStackNavigator: createNavigatorFactory(DeviceFreeStack) };
});
vi.mock('../mobile/src/screens/LoginScreen', () => ({
  LoginScreen: (props: any) => React.createElement('Login', props),
}));
vi.mock('../mobile/src/screens/AppShellScreen', () => ({
  AppShellScreen: (props: any) => React.createElement('Shell', props),
}));
vi.mock('../mobile/src/screens/AboutScreen', () => ({
  AboutScreen: (props: any) => {
    const navigation = require('@react-navigation/core').useNavigation();
    return React.createElement('About', { ...props, onBack: navigation.goBack });
  },
}));

vi.stubGlobal('__DEV__', false);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('cancelAnimationFrame', () => {});
const { default: App } = await vi.importActual<any>('../mobile/src/App');
let tree: any;

afterEach(() => {
  if (tree) act(() => tree.unmount());
  tree = undefined;
});

describe('native app root navigation', () => {
  it('mounts login, navigates to About, and replaces it with the shell after sign-in', async () => {
    await act(async () => { tree = create(React.createElement(App)); });
    expect(tree.root.findByType('Login').props.session.state).toBe('signed_out');

    act(() => tree.root.findByType('Login').props.onAbout());
    expect(tree.root.findByType('About').props.dark).toBe(false);
    act(() => tree.root.findByType('About').props.onBack());
    expect(tree.root.findByType('Login').props.session.state).toBe('signed_out');

    await act(async () => native.listener?.({ ...native.session, state: 'signed_in' }));
    expect(tree.root.findByType('Shell').props.initialDestination).toBe('overview');
    expect(tree.root.findAllByType('Login')).toHaveLength(0);
    expect(tree.root.findAllByType('About')).toHaveLength(0);
  });
});
