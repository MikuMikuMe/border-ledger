import {createRequire} from 'node:module';
import {beforeEach,expect,it,vi} from 'vitest';
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer');
const bridge=vi.hoisted(()=>({readSettings:vi.fn(),readView:vi.fn(),readModeView:vi.fn(),startWrite:vi.fn(),readCopyPreview:vi.fn(),readRolloverPreview:vi.fn()}));
vi.mock('../mobile/node_modules/react-native/index.js',()=>({AppState:{addEventListener:()=>({remove(){}})}}));
vi.mock('../mobile/src/native/specs/NativeBudget',()=>({default:bridge}));
vi.mock('../mobile/src/native/specs/NativeSession',()=>({default:{readOperations:async()=>[],queryOperation:async()=>null}}));
vi.mock('../mobile/src/native/specs/NativePreferences',()=>({default:{readReporting:async()=>({reportingTimezone:'America/Toronto'})}}));
const {useMobileBudget}=await import('../mobile/src/features/budget/useMobileBudget');
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
const tracking={mode:'tracking',settings:{currency:'CAD',preferredMode:'tracking',revision:4,startMonth:'2026-10'},summary:{month:'2026-10',plannedIncomeMinor:0,plannedExpenseMinor:0,plannedSavingsMinor:0,actualIncomeMinor:0,actualExpenseMinor:0,actualSavingsMinor:0,categories:[]},plans:[],activity:[],currentMonth:'2026-10',asOf:'now'};
beforeEach(()=>vi.resetAllMocks());
it('opens saved tracking mode with an explicit mode read',async()=>{
 bridge.readSettings.mockResolvedValue(JSON.stringify({settings:tracking.settings}));bridge.readModeView.mockResolvedValue(JSON.stringify(tracking));
 let state:any,tree:any;function Host(){state=useMobileBudget();return null;}
 await act(async()=>{tree=create(React.createElement(Host));});
 expect(state.mode).toBe('tracking');expect(state.view?.mode).toBe('tracking');expect(bridge.readView).not.toHaveBeenCalled();
 expect(bridge.readModeView.mock.calls[0][0]).toEqual({month:state.month,mode:'tracking'});
 act(()=>tree.unmount());
});
it('keeps a pending same-month load recoverable when Show month is pressed',async()=>{
 let finish!:(value:string)=>void;const pending=new Promise<string>(resolve=>{finish=resolve;});
 bridge.readSettings.mockResolvedValue(JSON.stringify({settings:tracking.settings}));bridge.readModeView.mockReturnValue(pending);
 let state:any,tree:any;function Host(){state=useMobileBudget();return null;}
 await act(async()=>{tree=create(React.createElement(Host));});
 act(()=>state.selectMonth());await act(async()=>finish(JSON.stringify(tracking)));
 expect(state.loading).toBe(false);expect(state.view?.mode).toBe('tracking');act(()=>tree.unmount());
});
it.each([{unavailable:false,expected:null},{unavailable:true,expected:'Could not load your budget. Refresh and try again.'}])('recovers a corrected current-month validation error while retaining network state: $unavailable',async({unavailable,expected})=>{
 if(unavailable)bridge.readSettings.mockRejectedValue(new Error('offline'));
 else bridge.readSettings.mockResolvedValue(JSON.stringify({settings:tracking.settings}));
 bridge.readModeView.mockResolvedValue(JSON.stringify(tracking));
 let state:any,tree:any;function Host(){state=useMobileBudget();return null;}
 await act(async()=>{tree=create(React.createElement(Host));});
 act(()=>state.setDraftMonth('2026-99'));act(()=>state.selectMonth());
 expect(state.error).toBe('Enter a valid month, for example 2026-10.');
 act(()=>state.setDraftMonth(state.month));act(()=>state.selectMonth());
 expect(state.error).toBe(expected);act(()=>tree.unmount());
});
it('ignores an older tracking response after the saved mode changes',async()=>{
 let finish!:(value:string)=>void;const stale=new Promise<string>(resolve=>{finish=resolve;});
 const envelope={mode:'envelope',settings:{...tracking.settings,preferredMode:'envelope',revision:5},summary:{month:'2026-10',cashMinor:0,unassignedMinor:0,categories:[]},balances:[],activity:[],startMonth:'2026-10',currentMonth:'2026-10',asOf:'now'};
 bridge.readSettings.mockResolvedValue(JSON.stringify({settings:tracking.settings}));bridge.readModeView.mockResolvedValueOnce(JSON.stringify(tracking)).mockReturnValueOnce(stale).mockResolvedValue(JSON.stringify(envelope));
 bridge.startWrite.mockImplementation(async()=>{bridge.readSettings.mockResolvedValue(JSON.stringify({settings:envelope.settings}));return {status:'completed'};});
 let state:any,tree:any;function Host(){state=useMobileBudget();return null;}
 await act(async()=>{tree=create(React.createElement(Host));});
 await act(async()=>{void state.load();});await act(async()=>state.selectMode('envelope'));
 expect(state.mode).toBe('envelope');await act(async()=>finish(JSON.stringify(tracking)));
 expect(state.mode).toBe('envelope');expect(state.view?.mode).toBe('envelope');act(()=>tree.unmount());
});
