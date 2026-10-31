import {createRequire} from 'node:module';
import {afterEach, expect, it, vi} from 'vitest';
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const React = require('react');
const {act, create} = require('react-test-renderer');
const core = require('@react-navigation/core');
const device = vi.hoisted(() => ({handlers: [] as Array<() => boolean>}));
vi.mock('../mobile/node_modules/react-native/index.js', () => ({
  Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: {create: (value: unknown) => value, hairlineWidth: 1},
  BackHandler: {addEventListener: (_: string, handler: () => boolean) => {
    device.handlers.push(handler);
    return {remove() {device.handlers = device.handlers.filter(value => value !== handler);}};
  }},
}));
vi.mock('../mobile/node_modules/react-native-safe-area-context/lib/commonjs/index.js', () => ({SafeAreaView: 'SafeAreaView'}));
vi.mock('../mobile/node_modules/@react-navigation/native/lib/module/index.js', () => require('@react-navigation/core'));
vi.mock('../mobile/src/screens/BudgetScreen', () => ({BudgetScreen: () => null}));
vi.mock('../mobile/src/screens/FinanceScreen', () => ({FinanceScreen: () => null}));
vi.mock('../mobile/src/screens/DetailsScreen', () => ({DetailsScreen: () => null}));
vi.mock('../mobile/src/screens/ToolsScreen', () => ({ToolsScreen: () => null}));
const screenModule = '../mobile/src/screens/AppShellScreen';
const {AppShellScreen} = await import(screenModule);
function RetainedStack(props: any) {
  const {state, descriptors, render} = core.useNavigationBuilder(core.StackRouter, props);
  return render(state.routes.map((route: any) => React.createElement(React.Fragment, {key: route.key}, descriptors[route.key].render())));
}
const Stack = core.createNavigatorFactory(RetainedStack)();
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let tree: any;
afterEach(() => {act(() => tree?.unmount()); device.handlers = [];});
const label = (node: any) => node.findAllByType('Text').map((text: any) => text.children.join('')).join(' ');
function press(name: string) {
  act(() => tree.root.findAllByType('Pressable').find((node: any) => label(node) === name).props.onPress());
}
function systemBack() {
  act(() => {device.handlers.slice().reverse().some(handler => handler());});
}
it('system Back dismisses About in one press and preserves the mounted More page', async () => {
  const navigation = core.createNavigationContainerRef();
  // Model NavigationContainer's fallback handler, registered before the shell.
  device.handlers.push(() => {
    if (!navigation.canGoBack()) return false;
    navigation.goBack(); return true;
  });
  await act(async () => {tree = create(React.createElement(core.BaseNavigationContainer, {ref: navigation},
    React.createElement(Stack.Navigator, null,
      React.createElement(Stack.Screen, {name: 'Shell'}, ({navigation}: any) => React.createElement(AppShellScreen, {
        dark: false, initialDestination: 'overview', onAbout: () => navigation.navigate('About'), onSignOut: async () => {},
      })),
      React.createElement(Stack.Screen, {name: 'About'}, () => React.createElement('About')),
    )));});
  press('More'); press('About Border Ledger');
  expect(navigation.getCurrentRoute().name).toBe('About');
  expect(tree.root.findAllByType(AppShellScreen)).toHaveLength(1);
  systemBack();
  expect(navigation.getCurrentRoute().name).toBe('Shell');
  expect(tree.root.findAllByType('About')).toHaveLength(0);
  const more = tree.root.findAllByType('Pressable').find((node: any) => label(node) === 'More');
  expect(more.props.accessibilityState.selected).toBe(true);
  // The shell must resume handling Back after regaining focus.
  systemBack();
  expect(tree.root.findAllByType('Pressable').find((node: any) => label(node) === 'Overview').props.accessibilityState.selected).toBe(true);
});
