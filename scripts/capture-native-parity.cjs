/* Synthetic .probe captures only. Does not invoke auth or financial services. */
const {execFileSync}=require('node:child_process');
const {mkdirSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const WebSocket=require('ws');
const args=process.argv.slice(2);
const adb=args[0];
const output=path.resolve(args[1]||'.tmp/native-parity');
const serial=args[2]||'emulator-5554';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  if(!adb)throw Error('Usage: node scripts/capture-native-parity.cjs <adb> [output] [emulator serial]');
  if(!serial.startsWith('emulator-'))throw Error('Only an explicitly selected emulator is allowed.');
  mkdirSync(output,{recursive:true});
  const pages=await(await fetch('http://127.0.0.1:8081/json/list')).json();
  const page=pages.find(p=>p.appId==='com.lofuyu.borderledger.probe');
  if(!page)throw Error('Signed-out .probe debug host must be connected to Metro.');
  const socket=new WebSocket(page.webSocketDebuggerUrl,{origin:'http://127.0.0.1:8081'});
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map();
  socket.onmessage=({data})=>{const value=JSON.parse(data);const request=pending.get(value.id);if(request){pending.delete(value.id);value.error?request.reject(Error('CDP failed')):request.resolve(value.result);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}));});
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,returnByValue:true});
    if(result.exceptionDetails)throw Error('Fixture expression failed');
    return result.result.value;
  };
  const device=(...argv)=>execFileSync(adb,['-s',serial,...argv],{encoding:'utf8'}).trim();
  const capture=name=>{
    device('shell','screencap','-p',`/sdcard/${name}.png`);
    device('pull',`/sdcard/${name}.png`,path.join(output,`${name}.png`));
    device('shell','uiautomator','dump',`/sdcard/${name}.xml`);
    device('pull',`/sdcard/${name}.xml`,path.join(output,`${name}.xml`));
  };
  try{
    await call('Runtime.enable');
    await evaluate(`globalThis.__paritySession=null;(typeof globalThis.__turboModuleProxy==='function'?globalThis.__turboModuleProxy('NativeSession'):globalThis.nativeModuleProxy?.NativeSession).getSnapshot().then(v=>globalThis.__paritySession=v.state)`);
    await pause(500);
    if(await evaluate('globalThis.__paritySession')!=='signed_out')throw Error('Refusing capture outside signed-out mode');
    await evaluate('globalThis.__borderLedgerLoginFixture?.hide()');
    await pause(500);
    const groups={Finance:['overview','activity','recurring'],Details:['recurring-detail','review','accounts'],Tools:['capture','devices','settings','files']};
    const manifest={serial,size:device('shell','wm','size'),density:device('shell','wm','density'),capturedAt:new Date().toISOString(),scenes:[]};
    for(const [group,screens]of Object.entries(groups))for(const screen of screens)for(const dark of [false,true]){
      const name=`${screen}-${dark?'dark':'light'}`;
      await evaluate(`globalThis.__borderLedgerFinanceFixture?.hide();globalThis.__borderLedgerDetailsFixture?.hide();globalThis.__borderLedgerToolsFixture?.hide()`);
      await pause(250);
      await evaluate(`globalThis.__borderLedger${group}Fixture.show(${JSON.stringify({screen,state:'ready',dark})})`);
      await pause(500);capture(name);manifest.scenes.push(name);console.log(name);
    }
    writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
  }finally{
    await evaluate(`globalThis.__borderLedgerFinanceFixture?.hide();globalThis.__borderLedgerDetailsFixture?.hide();globalThis.__borderLedgerToolsFixture?.hide();delete globalThis.__paritySession`);
    socket.close();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
