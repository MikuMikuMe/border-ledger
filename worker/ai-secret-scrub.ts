const encoder=new TextEncoder();
function decoded(value:string):string {
  let current=value;
  for(let i=0;i<8;i++) {
    let next:string;
    try {next=decodeURIComponent(current);} catch {throw new RangeError('Invalid provider endpoint encoding');}
    if(next===current) return current;
    current=next;
  }
  if(current.includes('%')) throw new RangeError('Invalid provider endpoint encoding');
  return current;
}
export function containsCredential(value:string,credential:string):boolean {
  return value.includes(credential) || decoded(value).includes(credential);
}
function encodedPattern(character:string):string {
  const literal=character.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const encoded=[...encoder.encode(character)].map(byte=>`%(?:25){0,8}${byte.toString(16).padStart(2,'0')}`).join('');
  return `(?:${literal}|${encoded})`;
}
export function redactCredential(value:string,credential:string):string {
  if(!credential) return value;
  const pattern=[...credential].map(encodedPattern).join('');
  return value.replace(new RegExp(pattern,'gi'),'[redacted]');
}
