import {createRequire} from 'node:module';
import {afterEach, describe, expect, it, vi} from 'vitest';
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const React = require('react');
const {act, create} = require('react-test-renderer');
const device = vi.hoisted(() => ({back: undefined as undefined | (() => boolean), focus:vi.fn()}));
vi.mock('../mobile/node_modules/react-native/index.js', () => ({
  Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', Platform:{OS:'android'},NativeModules:{NativeAccessibilityFocus:{focus:device.focus}},AccessibilityInfo:{setAccessibilityFocus:vi.fn()},findNodeHandle:(node:any)=>node?.tag??null,
  StyleSheet: {create: (value: unknown) => value, hairlineWidth: 1},
  BackHandler: {addEventListener: (_: string, handler: () => boolean) => {device.back = handler; return {remove() {device.back = undefined;}};}},
}));
vi.mock('../mobile/node_modules/react-native-safe-area-context/lib/commonjs/index.js', () => ({SafeAreaView: 'SafeAreaView'}));
const {ShellNavigation} = await import('../mobile/src/screens/ShellNavigation');
const {ManualEntryFocusContext} = await import('../mobile/src/features/finance/accessibilityFocus');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let tree: any;
afterEach(() => {if (tree) act(() => tree.unmount());vi.useRealTimers();device.focus.mockClear();});
const label = (node: any): string => node.findAllByType('Text').map((text: any) => text.children.join('')).join(' ');
const press = (name: string) => act(() => tree.root.findAllByType('Pressable').find((node: any) => label(node).startsWith(name)).props.onPress());
function mount(initialDestination = 'overview', onSignOut = async () => {}) {
  act(() => {tree = create(React.createElement(ShellNavigation, {dark: false, initialDestination, onAbout() {}, onSignOut, renderPage: (page: string, _open: unknown, manualRequest: number) => React.createElement('Page', {page, manualRequest})}),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel==='Add transaction options'?88:1,scrollTo:()=>{}})});});
}
const current = () => tree.root.findByType('Page').props.page;
describe('Android shell navigation', () => {
  it('opens the Activity add menu and dismisses it with Back', () => {
    mount('activity');
    press('+ Add');
    expect(tree.root.findAllByType('Pressable').some((node: any) => label(node) === 'Manual transaction')).toBe(true);
    act(() => {device.back?.();});
    expect(current()).toBe('activity');
    expect(tree.root.findAllByType('Pressable').some((node: any) => label(node) === 'Manual transaction')).toBe(false);
  });
  it('returns screen-reader focus to Add after dismissing the menu', () => {
    vi.useFakeTimers();mount('activity');press('+ Add');act(()=>{device.back?.();});
    act(()=>vi.runAllTimers());expect(device.focus).toHaveBeenCalledWith(88);
  });
  it('does not return focus to Add while opening manual entry', () => {
    vi.useFakeTimers();mount('activity');press('+ Add');press('Manual transaction');
    act(()=>vi.runAllTimers());expect(device.focus).not.toHaveBeenCalled();
  });
  it('returns focus to Add when the manual transaction dialog closes', () => {
    vi.useFakeTimers();
    function Page({manualRequest}: {manualRequest:number}) {const notify=React.useContext(ManualEntryFocusContext);React.useEffect(()=>{if(manualRequest)notify(true);},[manualRequest,notify]);return React.createElement('Pressable',{accessibilityLabel:'Close synthetic form',onPress:()=>notify(false)});}
    act(()=>{tree=create(React.createElement(ShellNavigation,{dark:false,initialDestination:'activity',onAbout(){},onSignOut:async()=>{},renderPage:(_page:string,_open:unknown,manualRequest:number)=>React.createElement(Page,{manualRequest})}),{createNodeMock:(element:any)=>({tag:element.props.accessibilityLabel==='Add transaction options'?88:1,scrollTo:()=>{}})});});
    press('+ Add');press('Manual transaction');act(()=>tree.root.findByProps({accessibilityLabel:'Close synthetic form'}).props.onPress());
    act(()=>vi.runAllTimers());expect(device.focus).toHaveBeenCalledWith(88);
  });
  it('dismisses outside the add menu and sends a manual request when selected', () => {
    mount('activity'); press('+ Add');
    act(()=>tree.root.findByProps({accessibilityLabel:'Dismiss add menu'}).props.onPress());
    expect(tree.root.findAllByType('Pressable').some((node: any) => label(node) === 'Manual transaction')).toBe(false);
    press('+ Add'); press('Manual transaction');
    expect(tree.root.findByType('Page').props.manualRequest).toBe(1);
  });
  it('keeps four primary destinations outside the scrolling content and exposes every secondary page', () => {
    mount();
    const tabs = tree.root.findAllByType('Pressable').filter((node: any) => node.props.accessibilityRole === 'tab');
    expect(tabs.map(label)).toEqual(['Overview', 'Activity', 'Review', 'More']);
    expect(tree.root.findByType('ScrollView').findAll((node: any) => node.props.accessibilityRole === 'tab')).toHaveLength(0);
    for (const [name, page] of [['Accounts', 'accounts'], ['Recurring', 'recurring'], ['Wealth', 'wealth'], ['Import and export', 'files']]) {
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
