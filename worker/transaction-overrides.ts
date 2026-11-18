import type {D1Database,D1Statement} from './db-types';
import {assertFinancialAuthority,immutableFinancialContext,type FinancialContext} from './financial-authority';
import {validateInput} from './manual-transaction-input';
import {isReviewStateConflict,publishReview,reviewStateGuard} from './review-publication';
import {ManualTransactionConflict} from './manual-transactions';
import {manualMatchPredicate} from './manual-match-predicate';
import {ledgerScopedIdentifier} from './ledger-identifiers';
import {retentionMatchDigest} from './retention-match';

type Mutation={id:string;revision:number;requestId:string;payload:string;statements:D1Statement[]};
function validId(id:string) { return Boolean(id) && id.length<=160; }
function validRevision(revision:number) { return Number.isSafeInteger(revision) && revision>=0; }
function validateMutation(id:string,revision:number,requestId:string) {
 if(!validId(id)) throw new RangeError('Invalid transaction ID.');
 if(!validRevision(revision)) throw new RangeError('Invalid transaction revision.');
 if(!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new RangeError('Invalid transaction operation.');
}
async function operationResult(db:D1Database,ledgerId:string,key:{requestId:string;id:string;payload:string}) {
 const {requestId,id,payload}=key;
 const prior=await db.prepare('SELECT transaction_id,payload,revision FROM transaction_override_operations WHERE ledger_id=? AND request_id=?').bind(ledgerId,requestId).first<{transaction_id:string;payload:string;revision:number}>();
 if(!prior)return null;
 if(prior.transaction_id!==id || prior.payload!==payload)throw new ManualTransactionConflict();
 return {revision:prior.revision};
}
async function payloadDigest(payload:string) {
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
 return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function mutate(db:D1Database,authority:FinancialContext,mutation:Mutation) {
 const context=immutableFinancialContext(authority),{id,revision,requestId,payload,statements}=mutation;
 validateMutation(id,revision,requestId);
 await assertFinancialAuthority(db,context,'ledger:review');
 const digest=await payloadDigest(payload);
 const prior=await operationResult(db,context.ledgerId,{requestId,id,payload:digest});
 if(prior)return prior;
 try {
  await publishReview(db,context,[
   reviewStateGuard(db,context,'EXISTS(SELECT 1 FROM transactions WHERE ledger_id=? AND id=?)',[context.ledgerId,id]),
   reviewStateGuard(db,context,'COALESCE((SELECT revision FROM transaction_overrides WHERE ledger_id=? AND transaction_id=?),0)=?',[context.ledgerId,id,revision]),
   ...statements,
   db.prepare(`UPDATE manual_transaction_matches SET decision='dismissed',revision=revision+1
    WHERE ledger_id=? AND (manual_id=? OR bank_id=?) AND decision='confirmed'
    AND EXISTS(SELECT 1 FROM effective_transactions changed WHERE changed.ledger_id=? AND changed.id=?) AND NOT EXISTS
    (SELECT 1 FROM effective_transactions m JOIN effective_transactions b ON b.ledger_id=m.ledger_id
     WHERE m.ledger_id=manual_transaction_matches.ledger_id AND m.id=manual_transaction_matches.manual_id
       AND b.id=manual_transaction_matches.bank_id AND ${manualMatchPredicate('m','b')})`).bind(context.ledgerId,id,id,context.ledgerId,id),
   reviewStateGuard(db,context,'EXISTS(SELECT 1 FROM transaction_overrides WHERE ledger_id=? AND transaction_id=? AND revision=?)',[context.ledgerId,id,revision+1]),
   db.prepare('INSERT INTO transaction_override_operations(ledger_id,request_id,transaction_id,payload,revision) VALUES(?,?,?,?,?)').bind(context.ledgerId,requestId,id,digest,revision+1),
  ]);
 } catch(error){
  const completed=await operationResult(db,context.ledgerId,{requestId,id,payload:digest});
  if(completed)return completed;
  if(isReviewStateConflict(error))throw new ManualTransactionConflict();
  throw error;
 }
 return {revision:revision+1};
}
export async function editTransaction(db:D1Database,context:FinancialContext,target:{id:string;revision:number},value:unknown) {
 const {id,revision}=target;
 const input=validateInput(value),{requestId,accountId,date,merchant,amountMinor,currency,kind,category,note}=input;
 const annotationRevision=(value as Record<string,unknown>).expectedAnnotationRevision;
 if(typeof annotationRevision!=='number' || !validRevision(annotationRevision))throw new RangeError('Invalid annotation revision.');
 const annotationId=await ledgerScopedIdentifier(context,'annotation',`full-edit:${await payloadDigest(requestId)}`);
 const author='subjectHash' in context?context.subjectHash:await payloadDigest(context.userId);
 const stmt=db.prepare(`INSERT INTO transaction_overrides(ledger_id,transaction_id,revision,account_id,date,merchant,amount_minor,currency,kind,category,note,has_edits,annotation_revision)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,1,COALESCE((SELECT MAX(revision) FROM annotation_revisions WHERE ledger_id=? AND transaction_id=?),0) WHERE EXISTS(SELECT 1 FROM accounts WHERE ledger_id=? AND id=?)
 ON CONFLICT(ledger_id,transaction_id) DO UPDATE SET revision=excluded.revision,account_id=excluded.account_id,date=excluded.date,merchant=excluded.merchant,amount_minor=excluded.amount_minor,currency=excluded.currency,kind=excluded.kind,category=excluded.category,note=excluded.note,has_edits=1,annotation_revision=excluded.annotation_revision WHERE deleted_at IS NULL`)
 .bind(context.ledgerId,id,revision+1,accountId,date,merchant,amountMinor,currency,kind,category,note,context.ledgerId,id,context.ledgerId,accountId);
 const annotation=db.prepare('INSERT INTO annotation_revisions(id,ledger_id,transaction_id,author_subject_hash,revision,category,note) VALUES(?,?,?,?,?,?,?)').bind(annotationId,context.ledgerId,id,author,annotationRevision+1,category,note);
 return mutate(db,context,{id,revision,requestId,payload:JSON.stringify(['edit',id,revision,annotationRevision,input]),statements:[reviewStateGuard(db,context,'NOT EXISTS(SELECT 1 FROM transaction_alert_links WHERE ledger_id=? AND alert_transaction_id=?)',[context.ledgerId,id]),reviewStateGuard(db,context,'COALESCE((SELECT MAX(revision) FROM annotation_revisions WHERE ledger_id=? AND transaction_id=?),0)=?',[context.ledgerId,id,annotationRevision]),reviewStateGuard(db,context,'NOT EXISTS(SELECT 1 FROM category_aliases WHERE ledger_id=? AND name=?)',[context.ledgerId,category]),stmt,annotation]});
}
export async function deleteTransaction(db:D1Database,context:FinancialContext,target:{id:string;revision:number;requestId:string}) {
 const {id,revision,requestId}=target;
 const stmt=db.prepare(`INSERT INTO transaction_overrides(ledger_id,transaction_id,revision,deleted_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
 ON CONFLICT(ledger_id,transaction_id) DO UPDATE SET revision=excluded.revision,deleted_at=CURRENT_TIMESTAMP WHERE deleted_at IS NULL`).bind(context.ledgerId,id,revision+1);
 return mutate(db,context,{id,revision,requestId,payload:JSON.stringify(['delete',id,revision]),statements:[stmt]});
}
export async function restoreTransaction(db:D1Database,context:FinancialContext,target:{id:string;revision:number;requestId:string}) {
 const {id,revision,requestId}=target;
 const stmt=db.prepare(`UPDATE transaction_overrides SET revision=?,deleted_at=NULL WHERE ledger_id=? AND transaction_id=? AND deleted_at IS NOT NULL AND julianday('now')-julianday(deleted_at)<365`).bind(revision+1,context.ledgerId,id);
 return mutate(db,context,{id,revision,requestId,payload:JSON.stringify(['restore',id,revision]),statements:[stmt]});
}
export async function listDeletedTransactions(db:D1Database,context:FinancialContext) {
 await assertFinancialAuthority(db,context,'ledger:read');
 const result=await db.prepare(`SELECT t.id,t.merchant,t.date,t.amount_minor AS amountMinor,t.currency,a.name AS accountName,o.deleted_at AS deletedAt,o.revision FROM transaction_overrides o JOIN transaction_projections t ON t.id=o.transaction_id AND t.ledger_id=o.ledger_id JOIN accounts a ON a.id=t.account_id AND a.ledger_id=t.ledger_id WHERE o.ledger_id=? AND o.deleted_at IS NOT NULL AND julianday('now')-julianday(o.deleted_at)<365 ORDER BY o.deleted_at DESC,t.id`).bind(context.ledgerId).all();
 await assertFinancialAuthority(db,context,'ledger:read');return result.results;
}

type ExpiredAlertEvidence={ledger_id:string;transaction_id:string;event_id:string;account_id:string;date:string;amount_minor:number;currency:string;kind:string;bank_reference:string;revision:number};
async function alertEvidenceStatements(db:D1Database,now:string) {
 const rows=await db.prepare(`SELECT DISTINCT t.ledger_id,t.id AS transaction_id,r.event_id,t.account_id,t.date,t.amount_minor,t.currency,t.kind,COALESCE(r.bank_reference,e.bank_reference) AS bank_reference,o.revision
  FROM transactions t JOIN transaction_overrides o ON o.ledger_id=t.ledger_id AND o.transaction_id=t.id
  JOIN transaction_source_records r ON r.ledger_id=t.ledger_id AND r.transaction_id=t.id AND r.source_kind='alert'
  JOIN alert_events e ON e.ledger_id=r.ledger_id AND e.id=r.event_id
  WHERE o.deleted_at IS NOT NULL AND julianday(?) - julianday(o.deleted_at)>=365 AND trim(COALESCE(r.bank_reference,e.bank_reference,''))<>''
  AND NOT EXISTS (SELECT 1 FROM transaction_retention_evidence x WHERE x.ledger_id=t.ledger_id AND x.transaction_id=t.id AND x.event_id=r.event_id)`).bind(now).all<ExpiredAlertEvidence>();
 return Promise.all(rows.results.map(async row=>{
  const digest=await retentionMatchDigest({ledgerId:row.ledger_id,transactionId:row.transaction_id,accountId:row.account_id,date:row.date,amountMinor:row.amount_minor,currency:row.currency,kind:row.kind,bankReference:row.bank_reference});
  return [db.prepare(`INSERT OR IGNORE INTO transaction_retention_evidence(ledger_id,transaction_id,event_id,match_digest)
   SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM transactions t JOIN transaction_overrides o ON o.ledger_id=t.ledger_id AND o.transaction_id=t.id JOIN transaction_source_records r ON r.ledger_id=t.ledger_id AND r.transaction_id=t.id JOIN alert_events e ON e.ledger_id=r.ledger_id AND e.id=r.event_id
    WHERE t.ledger_id=? AND t.id=? AND t.account_id=? AND t.date=? AND t.amount_minor=? AND t.currency=? AND t.kind=? AND r.event_id=? AND COALESCE(r.bank_reference,e.bank_reference)=? AND o.revision=? AND o.deleted_at IS NOT NULL AND julianday(?) - julianday(o.deleted_at)>=365)`)
   .bind(row.ledger_id,row.transaction_id,row.event_id,digest,row.ledger_id,row.transaction_id,row.account_id,row.date,row.amount_minor,row.currency,row.kind,row.event_id,row.bank_reference,row.revision,now),
   db.prepare(`INSERT INTO ledger_preferences(ledger_id) VALUES (CASE WHEN EXISTS (SELECT 1 FROM transaction_retention_evidence WHERE ledger_id=? AND transaction_id=? AND event_id=? AND match_digest=?) THEN ? ELSE NULL END) ON CONFLICT(ledger_id) DO NOTHING`)
    .bind(row.ledger_id,row.transaction_id,row.event_id,digest,row.ledger_id)];
 }));
}

export async function purgeExpiredTransactionOverrides(db:D1Database,now:string) {
 if(!Number.isFinite(Date.parse(now)))throw new RangeError('Invalid cleanup time.');
 const evidence=(await alertEvidenceStatements(db,now)).flat();
 const guarded="EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=transactions.ledger_id AND c.transaction_id=transactions.id)";
 const eligibleAlert=`EXISTS (SELECT 1 FROM transaction_source_records r JOIN transaction_retention_cleanup c ON c.ledger_id=r.ledger_id AND c.transaction_id=r.transaction_id WHERE r.ledger_id=alert_events.ledger_id AND r.event_id=alert_events.id)
  AND NOT EXISTS (SELECT 1 FROM transaction_source_records r WHERE r.ledger_id=alert_events.ledger_id AND r.event_id=alert_events.id AND NOT EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=r.ledger_id AND c.transaction_id=r.transaction_id))
  AND NOT EXISTS (SELECT 1 FROM alert_projections p WHERE p.ledger_id=alert_events.ledger_id AND p.event_id=alert_events.id AND p.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=p.ledger_id AND c.transaction_id=p.transaction_id))
  AND NOT EXISTS (SELECT 1 FROM alert_event_links l WHERE l.ledger_id=alert_events.ledger_id AND (l.from_event_id=alert_events.id OR l.to_event_id=alert_events.id) AND (EXISTS (SELECT 1 FROM transactions t WHERE t.ledger_id=l.ledger_id AND t.id=l.to_transaction_id AND NOT EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=t.ledger_id AND c.transaction_id=t.id)) OR EXISTS (SELECT 1 FROM alert_projections p WHERE p.ledger_id=l.ledger_id AND p.event_id=CASE WHEN l.from_event_id=alert_events.id THEN l.to_event_id ELSE l.from_event_id END AND p.transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=p.ledger_id AND c.transaction_id=p.transaction_id))))`;
 await db.batch([
  ...evidence,
  db.prepare("INSERT INTO transaction_retention_cleanup SELECT ledger_id,transaction_id FROM transaction_overrides WHERE deleted_at IS NOT NULL AND julianday(?) - julianday(deleted_at) >= 365").bind(now),
  db.prepare(`INSERT INTO ledger_preferences(ledger_id) SELECT CASE WHEN NOT EXISTS (
   SELECT 1 FROM transaction_source_records r JOIN alert_events e ON e.ledger_id=r.ledger_id AND e.id=r.event_id
   WHERE r.ledger_id=c.ledger_id AND r.transaction_id=c.transaction_id AND r.source_kind='alert' AND trim(COALESCE(r.bank_reference,e.bank_reference,''))<>''
    AND NOT EXISTS (SELECT 1 FROM transaction_retention_evidence x WHERE x.ledger_id=r.ledger_id AND x.transaction_id=r.transaction_id AND x.event_id=r.event_id)) THEN c.ledger_id ELSE NULL END
   FROM transaction_retention_cleanup c WHERE 1 ON CONFLICT(ledger_id) DO NOTHING`),
  db.prepare(`DELETE FROM transaction_override_operations WHERE EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=transaction_override_operations.ledger_id AND c.transaction_id=transaction_override_operations.transaction_id)`),
  db.prepare(`DELETE FROM recurring_stream_transactions WHERE EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=recurring_stream_transactions.ledger_id AND c.transaction_id=recurring_stream_transactions.transaction_id)`),
  db.prepare(`DELETE FROM annotation_revisions WHERE EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=annotation_revisions.ledger_id AND c.transaction_id=annotation_revisions.transaction_id)`),
  db.prepare(`UPDATE alert_events SET notification_posted_at=NULL,captured_at='1970-01-01T00:00:00Z',instrument_hint_kind=NULL,instrument_hint_value=NULL,event_money_currency=NULL,event_money_amount_minor=NULL,primary_money_role=NULL,amounts_json='[]',bank_displayed_time=NULL,bank_displayed_zone=NULL,bank_displayed_precision=NULL,bank_year_provenance=NULL,merchant=NULL,completeness_json='{}' WHERE ${eligibleAlert}`),
  db.prepare(`UPDATE alert_projections SET counted_currency=NULL,counted_amount_minor=NULL WHERE EXISTS (SELECT 1 FROM alert_events WHERE alert_events.id=alert_projections.event_id AND alert_events.ledger_id=alert_projections.ledger_id AND ${eligibleAlert}) AND (counted_currency IS NOT NULL OR counted_amount_minor IS NOT NULL)`),
  db.prepare(`UPDATE import_chunks SET rows_json=(SELECT json_group_array(json(CASE WHEN EXISTS (
   SELECT 1 FROM import_previews p JOIN transaction_source_records r ON r.ledger_id=p.ledger_id AND r.account_id=p.account_id AND r.file_sha256=p.file_sha256
   JOIN transaction_retention_cleanup c ON c.ledger_id=r.ledger_id AND c.transaction_id=r.transaction_id
   WHERE p.id=import_chunks.preview_id AND p.ledger_id=import_chunks.ledger_id AND p.status='published' AND r.source_kind='statement' AND r.row_index=json_extract(item.value,'$.rowIndex'))
   THEN json_object('rowId',json_extract(item.value,'$.rowId'),'rowIndex',json_extract(item.value,'$.rowIndex'),'accountId',json_extract(item.value,'$.accountId'),'date','1970-01-01','merchant','Deleted transaction','amountMinor',0,'currency',(SELECT a.currency FROM accounts a JOIN import_previews p ON p.account_id=a.id AND p.ledger_id=a.ledger_id WHERE p.id=import_chunks.preview_id AND p.ledger_id=import_chunks.ledger_id),'category','Uncategorized','kind','expense','status','confirmed','source','statement','fingerprint','redacted','canonicalTransactionId',json_extract(item.value,'$.canonicalTransactionId'),'sourceIdentity',json_object('bankSourceId',json_extract(item.value,'$.sourceIdentity.bankSourceId'),'bankRowId',json_extract(item.value,'$.sourceIdentity.bankRowId'))) ELSE item.value END)) FROM json_each(import_chunks.rows_json) item)
   WHERE EXISTS (SELECT 1 FROM import_previews p JOIN transaction_source_records r ON r.ledger_id=p.ledger_id AND r.account_id=p.account_id AND r.file_sha256=p.file_sha256 JOIN transaction_retention_cleanup c ON c.ledger_id=r.ledger_id AND c.transaction_id=r.transaction_id JOIN json_each(import_chunks.rows_json) item ON json_extract(item.value,'$.rowIndex')=r.row_index WHERE p.id=import_chunks.preview_id AND p.ledger_id=import_chunks.ledger_id AND p.status='published' AND r.source_kind='statement')`),
  db.prepare(`UPDATE transaction_source_records SET content_digest='' WHERE source_kind IN ('plaid','lunchflow') AND EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=transaction_source_records.ledger_id AND c.transaction_id=transaction_source_records.transaction_id)`),
  db.prepare(`UPDATE transactions SET date='1970-01-01',fx_lock_date=NULL,merchant='',amount_minor=0,currency=(SELECT currency FROM accounts WHERE accounts.id=transactions.account_id AND accounts.ledger_id=transactions.ledger_id),category='',kind='expense',status='confirmed',fingerprint=CASE WHEN source='statement' THEN '' ELSE fingerprint END,note=NULL,created_at='1970-01-01 00:00:00',updated_at='1970-01-01 00:00:00' WHERE ${guarded} AND (date IS NOT '1970-01-01' OR fx_lock_date IS NOT NULL OR merchant IS NOT '' OR amount_minor IS NOT 0 OR currency IS NOT (SELECT currency FROM accounts WHERE accounts.id=transactions.account_id AND accounts.ledger_id=transactions.ledger_id) OR category IS NOT '' OR kind IS NOT 'expense' OR status IS NOT 'confirmed' OR (source='statement' AND fingerprint IS NOT '') OR note IS NOT NULL OR created_at IS NOT '1970-01-01 00:00:00' OR updated_at IS NOT '1970-01-01 00:00:00')`),
  db.prepare(`UPDATE transaction_overrides SET account_id=NULL,date=NULL,merchant=NULL,amount_minor=NULL,currency=NULL,kind=NULL,category=NULL,note=NULL,annotation_revision=0,has_edits=0 WHERE EXISTS (SELECT 1 FROM transaction_retention_cleanup c WHERE c.ledger_id=transaction_overrides.ledger_id AND c.transaction_id=transaction_overrides.transaction_id) AND (account_id IS NOT NULL OR date IS NOT NULL OR merchant IS NOT NULL OR amount_minor IS NOT NULL OR currency IS NOT NULL OR kind IS NOT NULL OR category IS NOT NULL OR note IS NOT NULL OR annotation_revision<>0 OR has_edits<>0)`),
  db.prepare('DELETE FROM transaction_retention_cleanup'),
 ]);
}
