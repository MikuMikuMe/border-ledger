import {createRequire} from 'node:module';
import {describe,expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react');const {create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ActivityIndicator:'ActivityIndicator',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const modulePath='../mobile/src/features/finance/PlanView';
const {PlanView}=await import(modulePath);
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
describe('Android recurring plans',()=>{
  it('shows the source currency and uncertainty without calling it missed',()=>{
    let tree:any;act(()=>{tree=create(React.createElement(PlanView,{dark:false,plans:[{id:'p',accountId:'a',currency:'CAD',merchant:'Transit',direction:'expense',amountMinor:'1250',frequency:'monthly',startDate:'2026-01-10',endDate:null,enabled:true,revision:0}],occurrences:[{planId:'p',date:'2026-10-10',status:'not_assessable',candidateIds:[]}],onAdd:()=>{},onEdit:()=>{},onToggle:()=>{},onRefresh:()=>{},busy:false}));});
    const output=JSON.stringify(tree.toJSON());expect(output).toContain('Transit');expect(output).toContain('CAD');expect(output).toContain('Unable to assess');expect(output).not.toContain('Possibly missing');
  });
  it('exposes accessible edit and pause actions for a plan',()=>{
    const onEdit=vi.fn(),onToggle=vi.fn();let tree:any;
    const plan={id:'p',accountId:'a',currency:'CAD',merchant:'Transit',direction:'expense',amountMinor:'1250',frequency:'monthly',startDate:'2026-01-10',endDate:null,enabled:true,revision:0};
    act(()=>{tree=create(React.createElement(PlanView,{dark:false,plans:[plan],occurrences:[],onAdd:()=>{},onEdit,onToggle,onRefresh:()=>{},busy:false}));});
    act(()=>tree.root.findByProps({accessibilityLabel:'Edit Transit'}).props.onPress());
    act(()=>tree.root.findByProps({accessibilityLabel:'Pause Transit'}).props.onPress());
    expect(onEdit).toHaveBeenCalledWith(plan);expect(onToggle).toHaveBeenCalledWith(plan);
  });

});
