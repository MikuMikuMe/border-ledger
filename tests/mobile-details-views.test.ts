import {createRequire} from 'node:module';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');const {create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const modulePath='../mobile/src/features/details/DetailsViews';
const {RecurringDetailView,ReviewView,AccountsView}=await import(modulePath);
import {account,connection,detail,alert,link} from './fixtures/mobile-details';
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
const ready=<T,>(data:T)=>({phase:'ready',data,message:null});const mutation={blocked:false,status:'ready'};
const actions={onRetry:()=>{},onLoadMore:()=>{},onOpen:()=>{},onClose:()=>{},onSave:()=>{},onDraft:()=>{},onResolve:()=>{},onClassify:()=>{},onConnect:()=>{},onSelect:()=>{},onCancel:()=>{},onSync:()=>{},onDisconnect:()=>{}};
const render=(component:unknown,props:unknown)=>{let tree:any;act(()=>{tree=create(React.createElement(component,props));});return tree;};
const json=(tree:any)=>tree.root.findAll((n:any)=>n.type==='Text').map((n:any)=>n.children.join('')).join('\n');
const button=(tree:any,label:string)=>tree.root.findAll((n:any)=>n.type==='Pressable'&&n.props.accessibilityLabel===label)[0];
describe('detail view fixtures and accessibility',()=>{
  it('hides selected evidence immediately when authorization locks the queue',()=>{
    const tree=render(ReviewView,{...actions,dark:false,state:{phase:'locked',data:null,message:'Renew your owner session'},selected:alert,mutation});
    expect(json(tree)).not.toContain('REF1');expect(tree.root.findAll((n:any)=>n.type==='TextInput')).toHaveLength(0);
  });
  it('renders source history, revision-safe classification and native modal focus/back',()=>{
    let classification='';const tree=render(RecurringDetailView,{...actions,dark:true,state:ready(detail),mutation,onClassify:(v:string)=>{classification=v;}});
    expect(json(tree)).toContain('2026-10-16');expect(json(tree)).toContain('posted');expect(json(tree)).toContain('CAD');expect(json(tree)).toContain('Revision 4');
    act(()=>button(tree,'Classify as excluded').props.onPress());expect(classification).toBe('excluded');
    expect(button(tree,'Classify as excluded').props.style.minHeight).toBeGreaterThanOrEqual(48);
    expect(tree.root.findAll((n:any)=>n.type==='Modal')[0].props.onRequestClose).toBeTypeOf('function');
    expect(tree.root.findAll((n:any)=>n.type==='Modal')[0].props.onShow).toBeTypeOf('function');
    expect(tree.root.findAll((n:any)=>n.type==='Text'&&n.props.numberOfLines)).toHaveLength(0);
  });
  it('keeps an explicit recurring detail refresh available while conflict classification is disabled',()=>{
    let refreshed=false;const tree=render(RecurringDetailView,{...actions,dark:false,state:ready(detail),mutation:{blocked:false,status:'revision_conflict'},onRetry:()=>{refreshed=true;}});
    expect(button(tree,'Classify as excluded').props.disabled).toBe(true);expect(button(tree,'Refresh recurring detail').props.disabled).toBe(false);
    act(()=>button(tree,'Refresh recurring detail').props.onPress());expect(refreshed).toBe(true);
  });
  it('shows bounded review evidence and preserves the annotation draft during revision conflict',()=>{
    const tree=render(ReviewView,{...actions,dark:false,state:ready({items:[alert],nextCursor:'next',limit:50}),selected:alert,draft:{category:'Travel',note:'Preserve me'},mutation:{blocked:false,status:'revision_conflict'}});
    expect(json(tree)).toContain('Bank reference: REF1');expect(json(tree)).toContain('Candidate transaction comparison');expect(json(tree).replaceAll(',','')).toContain('90071992547409.93');expect(json(tree)).toContain('r7');
    expect(tree.root.findAll((n:any)=>n.type==='TextInput'&&n.props.accessibilityLabel==='Review note')[0].props.value).toBe('Preserve me');
    expect(button(tree,'Keep separate').props.disabled).toBe(true);expect(button(tree,'Save category and note').props.disabled).toBe(true);
  });
  it.each(['loading','offline','error','locked'])('renders recoverable %s without enabling Review actions',phase=>{
    const tree=render(ReviewView,{...actions,dark:false,state:{phase,data:null,message:phase==='loading'?null:'Recoverable fixture status'},selected:null,mutation});
    expect(json(tree)).toContain(phase==='loading'?'Loading Review':'Recoverable fixture status');expect(button(tree,'Refresh Review')).toBeTruthy();
    expect(tree.root.findAll((n:any)=>n.props.accessibilityLiveRegion==='polite').length).toBeGreaterThan(0);
  });
  it('requires an explicit provider account choice and exposes checkboxes; resets choices for a new pending flow',()=>{
    let ids:unknown;const props={...actions,dark:false,state:ready({page:{accounts:[account],nextCursor:null,limit:50},connections:[connection],link:{...link,state:'pending',pendingConnectionId:'pending_1',accounts:[account]}}),mutation,onSelect:(value:unknown)=>{ids=value;}};
    const tree=render(AccountsView,props);expect(button(tree,'Confirm selected accounts').props.disabled).toBe(true);
    const choice=button(tree,'Select account Everyday CAD, CAD, ending 1234');expect(choice.props.accessibilityRole).toBe('checkbox');expect(choice.props.accessibilityState.checked).toBe(false);
    act(()=>choice.props.onPress());expect(button(tree,'Confirm selected accounts').props.disabled).toBe(false);act(()=>button(tree,'Confirm selected accounts').props.onPress());expect(ids).toEqual(['account_1']);
    act(()=>tree.update(React.createElement(AccountsView,{...props,state:ready({...props.state.data,link:{...props.state.data.link,pendingConnectionId:'pending_2'}})})));expect(button(tree,'Confirm selected accounts').props.disabled).toBe(true);
  });
  it('displays account metadata, connection errors and confirms disconnect before emitting an action',()=>{
    let disconnected='';const tree=render(AccountsView,{...actions,dark:true,state:ready({page:{accounts:[account],nextCursor:null,limit:50},connections:[{...connection,lastError:'ITEM_LOGIN_REQUIRED',cleanupState:'pending'}],link}),mutation,onDisconnect:(id:string)=>{disconnected=id;}});
    expect(json(tree)).toContain('ITEM_LOGIN_REQUIRED');expect(json(tree)).toContain('Cleanup: pending');
    act(()=>button(tree,'Open account Everyday CAD').props.onPress());expect(json(tree)).toContain('Subtype: checking');expect(json(tree)).toContain('account_1');act(()=>button(tree,'Close account detail').props.onPress());
    act(()=>button(tree,'Disconnect Fixture Bank').props.onPress());expect(disconnected).toBe('');expect(json(tree)).toContain('Confirm disconnect');
    act(()=>button(tree,'Confirm disconnect').props.onPress());expect(disconnected).toBe('connection_1');
  });
  it.each([['canceled','Connection canceled'],['failed','Bank authorization failed'],['unsupported','Bank authorization is unavailable']])('explains native %s outcomes without exposing provider secrets', (state,message)=>{
    const tree=render(AccountsView,{...actions,dark:false,state:ready({page:{accounts:[],nextCursor:null,limit:50},connections:[],link:{...link,state,outcomeCode:state}}),mutation});expect(json(tree)).toContain(message);expect(button(tree,'Start bank connection').props.disabled).toBe(false);
  });
  it('explains an unresolved bank exchange and blocks another connection attempt',()=>{
    const tree=render(AccountsView,{...actions,dark:false,state:ready({page:{accounts:[],nextCursor:null,limit:50},connections:[],link:{...link,state:'reconciliation_required',outcomeCode:'reconciliation_required'}}),mutation});
    expect(json(tree)).toContain('being reconciled');expect(button(tree,'Start bank connection').props.disabled).toBe(true);
  });
});
