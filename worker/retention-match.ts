export interface RetentionMatchInput {ledgerId:string;transactionId:string;accountId:string;date:string;amountMinor:number;currency:string;kind:string;bankReference:string}

export async function retentionMatchDigest(value:RetentionMatchInput) {
 const input=JSON.stringify([value.ledgerId,value.transactionId,value.accountId,value.date,value.amountMinor,value.currency,value.kind,value.bankReference.trim().toLowerCase()]);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
