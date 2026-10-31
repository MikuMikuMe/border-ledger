function validHostLabel(label:string):boolean { return Boolean(label) && /^[a-z0-9-]+$/.test(label); }
function isWildcardDns(host:string):boolean {
  return ['nip.io','sslip.io','localtest.me','lvh.me','localhost.direct'].some(domain=>host===domain || host.endsWith('.'+domain));
}
function validateHostLabels(host:string):void {
  const labels=host.split('.');
  if(labels.length<2) throw new RangeError('Invalid provider endpoint');
  if(!labels.every(validHostLabel)) throw new RangeError('Invalid provider endpoint');
  if(['localhost','local','internal','invalid','test','example'].includes(labels.at(-1)!)) throw new RangeError('Invalid provider endpoint');
}
export function validateHost(host:string):void {
  validateHostLabels(host);
  if(isWildcardDns(host)) throw new RangeError('Invalid provider endpoint');
  if(host.includes(':')) throw new RangeError('Invalid provider endpoint');
  if(/^\d+(?:\.\d+){3}$/.test(host)) throw new RangeError('Invalid provider endpoint');
}
