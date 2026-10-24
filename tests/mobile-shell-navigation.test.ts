import {createRequire} from 'node:module';
import {afterEach, describe, expect, it, vi} from 'vitest';
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const React = require('react');
const {act, create} = require('react-test-renderer');
const device = vi.hoisted(() => ({back: undefined as undefined | (() => boolean)}));
vi.mock('../mobile/node_modules/react-native/index.js', () => ({
  Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: {create: (value: unknown) => value, hairlineWidth: 1},
  BackHandler: {addEventListener: (_: string, handler: () => boolean) => {device.back = handler; return {remove() {device.back = undefined;}};}},
}));
vi.mock('../mobile/node_modules/react-native-safe-area-context/lib/commonjs/index.js', () => ({SafeAreaView: 'SafeAreaView'}));
const {ShellNavigation} = await import('../mobile/src/screens/ShellNavigation');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let tree: any;
afterEach(() => {if (tree) act(() => tree.unmount());});
const label = (node: any): string => node.findAllByType('Text').map((text: any) => text.children.join('')).join(' ');
const press = (name: string) => act(() => tree.root.findAllByType('Pressable').find((node: any) => label(node).startsWith(name)).props.onPress());
function mount(initialDestination = 'overview', onSignOut = async () => {}) {
  act(() => {tree = create(React.createElement(ShellNavigation, {dark: false, initialDestination, onAbout() {}, onSignOut, renderPage: (page: string) => React.createElement('Page', {page})}));});
}
const current = () => tree.root.findByType('Page').props.page;
describe('Android shell navigation', () => {
  it('keeps four primary destinations outside the scrolling content and exposes every secondary page', () => {
    mount();
    const tabs = tree.root.findAllByType('Pressable').filter((node: any) => node.props.accessibilityRole === 'tab');
    expect(tabs.map(label)).toEqual(['Overview', 'Activity', 'Review', 'More']);
    expect(tree.root.findByType('ScrollView').findAll((node: any) => node.props.accessibilityRole === 'tab')).toHaveLength(0);
    for (const [name, page] of [['Accounts', 'accounts'], ['Recurring', 'recurring'], ['Import and export', 'files']]) {
      press('More'); press(name); expect(current()).toBe(page);
      expect(tree.root.findAllByType('Pressable').find((node: any) => label(node) === 'More').props.accessibilityState.selected).toBe(true);
    }
    press('More'); press('Settings'); expect(current()).toBe('settings');
    press('Connected devices'); expect(current()).toBe('devices');
    act(() => {device.back?.();}); expect(current()).toBe('settings');
    press('Notification capture'); expect(current()).toBe('capture');
    press('Back'); expect(current()).toBe('settings');
    press('Activity'); expect(current()).toBe('activity');
    act(() => {device.back?.();}); expect(current()).toBe('overview');
    expect(device.back?.()).toBe(false);
  });
  it('retains notification deep links and supplies a return path', () => {
    mount('capture'); expect(current()).toBe('capture');
    press('Back'); expect(tree.root.findAllByType('Page')).toHaveLength(0);
    press('Overview'); expect(current()).toBe('overview');
  });
  it('keeps sign out in More and shows a retryable failure', async () => {
    mount('overview', async () => {throw new Error('offline');});
    expect(tree.root.findAllByType('Pressable').some((node: any) => label(node) === 'Sign out')).toBe(false);
    press('More');
    await act(async () => {press('Sign out');});
    expect(tree.root.findAllByType('Text').some((node: any) => node.children.join('').includes('Please try again'))).toBe(true);
  });
});
