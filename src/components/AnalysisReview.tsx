export type AnalysisPreview={provider:'openai'|'anthropic';endpoint:string;model:string;configurationRevision:string;from:string;to:string;detail:boolean;mode:'budget'|'ledger';summary:unknown};
export function AnalysisReview({preview,busy,onSend}:{preview:AnalysisPreview|null;busy:boolean;onSend():void}) {
  if(!preview) return null;
  return <div className="budget-form"><h3>Review before sending</h3><p>{preview.provider} · {preview.model}</p><p>{preview.endpoint}</p><p>{preview.from} to {preview.to} · {preview.detail?'Transaction details':'Aggregated summaries'}</p><p>Your selected provider will receive this financial information.{preview.detail?' Transaction details include dates, merchants, amounts, categories, accounts, notes, and sources.':''}</p><button type="button" disabled={busy} onClick={onSend}>Send for analysis</button></div>;
}
export function AnalysisError({message}:{message:string}) {
  return message?<p role="alert" className="budget-error">{message}</p>:null;
}
export function AnalysisResult({answer}:{answer:string}) {
  return answer?<div aria-live="polite"><h3>Analysis</h3><p style={{whiteSpace:'pre-wrap'}}>{answer}</p><p>These observations are advisory.</p></div>:null;
}
