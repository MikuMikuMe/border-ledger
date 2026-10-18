/* Debug-only synthetic view switch through Hermes CDP. Never calls a native service. */
const assert=require('node:assert/strict');
const WebSocket=require('ws');
async function main(){
  const [screen='overview',state='ready',theme='light']=process.argv.slice(2);
  assert(['overview','activity','recurring','recurring-detail','review','accounts','capture','devices','settings','files','hide'].includes(screen));
  const pages=await(await fetch('http://127.0.0.1:8081/json/list')).json();
  const page=pages.find(p=>(p.appId||p.app)==='com.lofuyu.borderledger.probe');assert(page,'Debug host must be connected');
  const socket=new WebSocket(page.webSocketDebuggerUrl,{origin:'http://127.0.0.1:8081'});
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map();
  socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
  const call=(method,params)=>new Promise(resolve=>{pending.set(++id,resolve);socket.send(JSON.stringify({id,method,params}));});
  try{
    await call('Runtime.enable');
    const value=JSON.stringify({screen,state,dark:theme==='dark'});
    const host=['capture','devices','settings','files'].includes(screen)?'__borderLedgerToolsFixture':['recurring-detail','review','accounts'].includes(screen)?'__borderLedgerDetailsFixture':'__borderLedgerFinanceFixture';
    const expression=screen==='hide'
      ? "if(!globalThis.__borderLedgerFinanceFixture&&!globalThis.__borderLedgerDetailsFixture&&!globalThis.__borderLedgerToolsFixture)throw new Error('Debug fixture host unavailable');globalThis.__borderLedgerFinanceFixture?.hide();globalThis.__borderLedgerDetailsFixture?.hide();globalThis.__borderLedgerToolsFixture?.hide();'synthetic fixture only'"
      : `if(!globalThis.${host})throw new Error('Debug fixture host unavailable');globalThis.${host}.show(${value});'synthetic fixture only'`;
    const result=await call('Runtime.evaluate',{expression,returnByValue:true});assert(!result.result?.exceptionDetails,JSON.stringify(result.result?.exceptionDetails));
    console.log(JSON.stringify({screen,state,theme,result:result.result?.result?.value}));
  }finally{socket.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
