import {randomInt} from 'node:crypto';
import {createServer} from 'node:net';
const MIN_PORT=20000,MAX_PORT=40000,MAX_ATTEMPTS=20;
const HOST='127.0.0.1';
export function isRetryableBindError(error:unknown):boolean {
 if(!error||typeof error!=='object')return false;
 if(!('code' in error))return false;
 return ['EADDRINUSE','EACCES','ERR_ADDRESS_IN_USE'].includes(String(error.code));
}
async function probePort(port:number):Promise<void> {
 await new Promise<void>((resolve,reject)=>{
  const server=createServer();
  server.once('error',reject);
  server.listen({host:HOST,port,exclusive:true},()=>server.close(error=>error?reject(error):resolve()));
 });
}
function checkedPort(port:number):number {
 if(!Number.isInteger(port))throw new RangeError('Test transport port is outside the safe range');
 if(port<MIN_PORT)throw new RangeError('Test transport port is outside the safe range');
 if(port>MAX_PORT)throw new RangeError('Test transport port is outside the safe range');
 return port;
}
export async function findSafeLoopbackPort(options:{candidate?:()=>number;probe?:(port:number)=>Promise<void>}={}):Promise<number> {
 const candidate=options.candidate??(()=>randomInt(MIN_PORT,MAX_PORT+1));
 const probe=options.probe??probePort;
 let lastError:unknown;
 for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
  const port=checkedPort(candidate());
  try {await probe(port);return port;}
  catch(error){if(!isRetryableBindError(error))throw error;lastError=error;}
 }
 throw lastError;
}
