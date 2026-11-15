import {createRequire} from 'node:module';import {describe,it,expect,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));const React=require('react');const {create,act}=require('react-test-renderer');
vi.mock('../mobile/node_modules/react-native/index.js',()=>({NativeModules:{},Text:'Text',View:'View',Pressable:'Pressable',TextInput:'TextInput',ScrollView:'ScrollView',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(v:unknown)=>v}}));
const native=vi.hoisted(()=>({readCategories:vi.fn(async()=>JSON.stringify({categories:[{name:'Food',archived:false}]})),readReport:vi.fn(async()=>({currencyTotals:[{currency:'CAD',confirmedMinorUnits:'1200',provisionalMinorUnits:'0'}],reportingCurrency:null,convertedTotals:null,fx:{complete:true},dailyTotals:[]})),readTransactions:vi.fn(async()=>({items:[{id:'tx',occurredAt:'2026-10-10',merchant:'Coffee',signedMinorUnits:'-1200',currency:'CAD',kind:'expense',status:'confirmed'}],nextCursor:null,limit:50}))}));
vi.mock('../mobile/src/native/specs/NativeLedger',()=>({default:native}));
const {CategorySpending}=await import('../mobile/src/features/finance/CategorySpending');const {CategoryServicesContext}=await import('../mobile/src/features/finance/categoryServices');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
describe('mobile category spending',()=>{it('uses the selected report period and opens matching activity',async()=>{
 const onOpen=vi.fn();let tree:any;await act(async()=>{tree=create(React.createElement(CategoryServicesContext.Provider,{value:native},React.createElement(CategorySpending,{dark:false,from:'2026-10-01',to:'2026-10-31',timeZone:'America/Toronto',includeProvisional:false,currency:null,reportingCurrency:null,onOpen})));});
 act(()=>tree.root.findByProps({accessibilityLabel:'Choose spending category'}).props.onPress());
 expect(tree.root.findByProps({accessibilityLabel:'Search spending categories'})).toBeTruthy();
 await act(async()=>tree.root.findByProps({accessibilityLabel:'Food'}).props.onPress());
 expect(native.readReport).toHaveBeenCalledWith(expect.objectContaining({category:'Food',startDate:'2026-10-01',endDate:'2026-10-31'}));
 await act(async()=>tree.root.findByProps({accessibilityLabel:'View category activity'}).props.onPress());
 expect(native.readTransactions).toHaveBeenCalledWith(expect.objectContaining({category:'Food',from:'2026-10-01',to:'2026-10-31'}));expect(JSON.stringify(tree.toJSON())).toContain('Coffee');act(()=>tree.root.findByProps({accessibilityLabel:'Open activity: Coffee'}).props.onPress());expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({id:'tx'}));act(()=>tree.unmount());
});
it('refreshes categories after an activity edit',async()=>{
 native.readCategories.mockResolvedValueOnce(JSON.stringify({categories:[{name:'Food',archived:false}]})).mockResolvedValueOnce(JSON.stringify({categories:[{name:'Travel',archived:false}]}));
 const props={dark:false,from:'2026-10-01',to:'2026-10-31',timeZone:'America/Toronto',includeProvisional:false,currency:null,reportingCurrency:null,refreshVersion:0};let tree:any;
 await act(async()=>{tree=create(React.createElement(CategoryServicesContext.Provider,{value:native},React.createElement(CategorySpending,props)));});
 await act(async()=>{tree.update(React.createElement(CategoryServicesContext.Provider,{value:native},React.createElement(CategorySpending,{...props,refreshVersion:1})));});
 act(()=>tree.root.findByProps({accessibilityLabel:'Choose spending category'}).props.onPress());
 expect(tree.root.findByProps({accessibilityLabel:'Travel'})).toBeTruthy();act(()=>tree.unmount());
});});
