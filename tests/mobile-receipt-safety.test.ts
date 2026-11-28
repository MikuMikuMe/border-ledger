import {describe,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';

const shared=vi.hoisted(()=>({
  alertButtons:[] as Array<{text:string;onPress?:()=>void}>,
  native:{scan:vi.fn<()=>Promise<string|null>>(),scanForCloud:vi.fn<()=>Promise<string|null>>(),execute:vi.fn<(command:string,payload:string)=>Promise<string>>()},
  settingsPayload:'{}',
  ocrSettingsPayload:'null',
}));
const require=createRequire(new URL('../mobile/package.json',import.meta.url));
const React=require('../mobile/node_modules/react');
const {act,create}=require('react-test-renderer');

vi.mock('../mobile/node_modules/react-native/index.js',()=>({
  Alert:{alert:(_:string,__ :string,buttons:Array<{text:string;onPress?:()=>void}>)=>{shared.alertButtons=buttons;}},
  NativeModules:{NativeReceiptScanner:{scan:()=>shared.native.scan(),scanForCloud:()=>shared.native.scanForCloud()}},
  Text:'Text',View:'View',Pressable:'Pressable',ActivityIndicator:'ActivityIndicator',TextInput:'TextInput',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',ScrollView:'ScrollView',
  AccessibilityInfo:{setAccessibilityFocus:()=>{}},findNodeHandle:()=>null,StyleSheet:{create:(value:unknown)=>value},
}));
vi.mock('../mobile/src/native/specs/NativeAnalysis',()=>({default:{execute:(command:string,payload:string)=>shared.native.execute(command,payload)}}));

const {ReceiptScan}=await import('../mobile/src/features/finance/ReceiptScan');
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);

function resetNative(settingsPayload='{}') {
  shared.alertButtons=[];
  shared.settingsPayload=settingsPayload;
  shared.ocrSettingsPayload='null';
  shared.native.scan.mockReset().mockResolvedValue('COFFEE SHOP\n2026-11-20\nTOTAL 12.50');
  shared.native.scanForCloud.mockReset().mockResolvedValue(null);
  shared.native.execute.mockReset().mockImplementation(async(command:string)=>command==='settings'?shared.settingsPayload:command==='ocr_settings'?shared.ocrSettingsPayload:JSON.stringify({suggestion:{merchant:'AI SHOP',date:'2026-11-20',amount:'13.50',currency:'CAD'},amountConflict:false}));
}

async function renderScan() {
  const onResult=vi.fn(),onBusy=vi.fn(),onBegin=vi.fn();
  let tree:any;
  await act(async()=>{tree=create(React.createElement(ReceiptScan,{dark:false,disabled:false,sessionKey:0,onResult,onBusy,onBegin}));});
  return {tree,onResult,onBusy,onBegin};
}

async function scan(tree:any) {
  await act(async()=>{tree.root.findByProps({accessibilityLabel:'Scan receipt'}).props.onPress();await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setTimeout(resolve,0));});
}
function openConsent(tree:any) {
  act(()=>tree.root.findByProps({accessibilityLabel:'Improve with AI'}).props.onPress());
  return shared.alertButtons.find(button=>button.text==='Send')?.onPress;
}
async function readyForConsent() {
  resetNative(JSON.stringify({configurations:[{provider:'openai',model:'gpt',revision:'r1'}]}));
  const rendered=await renderScan();
  await scan(rendered.tree);
  const send=openConsent(rendered.tree);
  if(!send)throw new Error('The receipt consent action was not rendered.');
  shared.native.execute.mockClear();
  return {...rendered,send};
}
async function scanRemoteReceipt(amountConflict:boolean) {
  resetNative();shared.ocrSettingsPayload=JSON.stringify({provider:'azure',endpoint:'https://receipt.cognitiveservices.azure.com',model:'',revision:'r1'});
  shared.native.scanForCloud.mockResolvedValue(JSON.stringify({text:'STORE\nTOTAL 12.50',image:'/9j/2Q==',contentType:'image/jpeg'}));
  shared.native.execute.mockImplementation(async(command:string)=>command==='ocr_settings'?shared.ocrSettingsPayload:command==='ocr_scan'?JSON.stringify({suggestion:{merchant:'Store',date:null,amount:amountConflict?null:'12.50',currency:null},deletionRequested:true,amountConflict}):'{}');
  const rendered=await renderScan();act(()=>rendered.tree.root.findByProps({accessibilityLabel:'Scan with OCR provider'}).props.onPress());
  await act(async()=>{shared.alertButtons.find(button=>button.text==='Continue')?.onPress?.();await new Promise(resolve=>setTimeout(resolve,0));});
  return rendered;
}

describe('mobile receipt scanner safety',()=>{
  it('warns and requires manual amount entry when text AI disagrees',async()=>{
    const {tree,onResult,send}=await readyForConsent();
    shared.native.execute.mockResolvedValue(JSON.stringify({suggestion:{merchant:'Shop',date:null,amount:null,currency:null},amountConflict:true}));
    await act(async()=>{send?.();await new Promise(resolve=>setTimeout(resolve,0));});
    expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({amount:null}),false,true);
    expect(JSON.stringify(tree.toJSON())).toContain('totals disagree');act(()=>tree.unmount());
  });
  it('asks before scanning an image for a remote OCR provider',async()=>{
    resetNative();shared.ocrSettingsPayload=JSON.stringify({provider:'azure',endpoint:'https://receipt.cognitiveservices.azure.com',model:'',revision:'r1'});
    const {tree}=await renderScan();
    act(()=>tree.root.findByProps({accessibilityLabel:'Scan with OCR provider'}).props.onPress());
    expect(shared.native.scanForCloud).not.toHaveBeenCalled();
    const send=shared.alertButtons.find(button=>button.text==='Continue')?.onPress;expect(send).toBeDefined();
    await act(async()=>{send?.();await Promise.resolve();});
    expect(shared.native.scanForCloud).toHaveBeenCalledOnce();
    expect(shared.native.execute).not.toHaveBeenCalledWith('ocr_scan',expect.any(String));
    act(()=>tree.unmount());
  });
  it('sends the captured image only after confirmation and applies the returned suggestion',async()=>{
    const {tree,onResult}=await scanRemoteReceipt(false);
    expect(shared.native.execute).toHaveBeenCalledWith('ocr_scan',expect.stringContaining('"confirmed":true'));
    expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({amount:'12.50'}),false,false);
    act(()=>tree.unmount());
  });
  it('marks a conflicting total for manual entry',async()=>{
    const {tree,onResult}=await scanRemoteReceipt(true);
    expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({amount:null}),false,true);
    expect(JSON.stringify(tree.toJSON())).toContain('totals disagree');act(()=>tree.unmount());
  });
  it('applies an empty local suggestion when a provider capture has no local text',async()=>{
    resetNative();shared.ocrSettingsPayload=JSON.stringify({provider:'azure',endpoint:'https://receipt.cognitiveservices.azure.com',model:'',revision:'r1'});
    shared.native.scanForCloud.mockResolvedValue(JSON.stringify({text:'',image:'/9j/2Q==',contentType:'image/jpeg'}));
    shared.native.execute.mockImplementation(async(command:string)=>command==='ocr_settings'?shared.ocrSettingsPayload:command==='ocr_scan'?JSON.stringify({suggestion:{merchant:'Second',date:null,amount:null,currency:null},deletionRequested:true,amountConflict:false}):'{}');
    const {tree,onResult}=await renderScan();act(()=>tree.root.findByProps({accessibilityLabel:'Scan with OCR provider'}).props.onPress());
    await act(async()=>{shared.alertButtons.find(button=>button.text==='Continue')?.onPress?.();await new Promise(resolve=>setTimeout(resolve,0));});
    expect(onResult).toHaveBeenNthCalledWith(1,expect.objectContaining({amount:null}));
    act(()=>tree.unmount());
  });
  it('offers retake guidance if the recognized receipt is missing key details',async()=>{
    resetNative();
    shared.native.scan.mockResolvedValue('STORE\nSUBTOTAL 12.00');
    const {tree,onResult}=await renderScan();
    await scan(tree);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({amount:null}));
    expect(JSON.stringify(tree.toJSON())).toContain('try another photo');
    act(()=>tree.unmount());
  });
  it('keeps malformed provider settings on the local fallback without crashing',async()=>{
    resetNative(JSON.stringify({configurations:'not-an-array'}));
    const {tree}=await renderScan();
    await scan(tree);

    expect(tree.root.findAllByProps({accessibilityLabel:'Improve with AI'})).toHaveLength(0);
    expect(shared.native.execute).toHaveBeenCalledWith('settings','{}');
    act(()=>tree.unmount());
  });

  it('does not send a delayed consent decision after the scanner unmounts',async()=>{
    const {tree,onResult,send}=await readyForConsent();

    act(()=>tree.unmount());
    await act(async()=>{send?.();await Promise.resolve();});

    expect(shared.native.execute).not.toHaveBeenCalledWith('receipt',expect.any(String));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('does not send consent for an older scan after a newer scan starts',async()=>{
    const {tree,send}=await readyForConsent();

    await scan(tree);
    await act(async()=>{send?.();await Promise.resolve();});

    expect(shared.native.execute).not.toHaveBeenCalledWith('receipt',expect.any(String));
    act(()=>tree.unmount());
  });

  it('remains usable after StrictMode replays its effects',async()=>{
    resetNative();
    const onResult=vi.fn(),onBusy=vi.fn(),onBegin=vi.fn();
    let tree:any;
    await act(async()=>{tree=create(React.createElement(React.StrictMode,null,React.createElement(ReceiptScan,{dark:false,disabled:false,sessionKey:0,onResult,onBusy,onBegin})));});
    await scan(tree);

    expect(onResult).toHaveBeenCalledTimes(1);
    act(()=>tree.unmount());
  });
});
