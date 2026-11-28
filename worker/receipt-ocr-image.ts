type ImageInput={image:string;contentType:string};
function decodeBase64(value:string) {
  if(typeof value!=='string' || value.length>5*1024*1024)throw new RangeError('Invalid receipt image');
  if(value.length%4!==0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new RangeError('Invalid receipt image');
  try {const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
  catch {throw new RangeError('Invalid receipt image');}
}
export function decodeReceiptImage(input:ImageInput) {
  if(!['image/jpeg','image/png'].includes(input.contentType))throw new RangeError('Invalid receipt image');
  const bytes=decodeBase64(input.image);
  const signature=input.contentType==='image/jpeg'?[255,216,255]:[137,80,78,71,13,10,26,10];
  if(!signature.every((value,index)=>bytes[index]===value))throw new RangeError('Invalid receipt image');
  return bytes;
}
