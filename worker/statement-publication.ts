import { ImportStoreError } from './import-store';
import type { D1Database } from './db-types';
import { financialAuthorityPredicate, type FinancialContext } from './financial-authority';

/** Server-owned binding created after the preview enters publishing. Never parsed from a request body. */
export interface ImportPublicationBinding {
  previewId: string;
  ownerBindingDigest: string;
  operationId: string;
  revision: number;
  receiptId: string;
  publishedAt: string;
}

interface PublicationMetadata {
  operationId: string;
  accountId: string;
  fileSha256: string;
  filename: string;
  requestedCount: number;
  acceptedCount: number;
  duplicateCount: number;
  publication?: ImportPublicationBinding;
}

function publicationAuthority(context: FinancialContext, input: PublicationMetadata) {
  const authority = financialAuthorityPredicate(context, 'imports:write');
  const publication = input.publication;
  if (!publication) return authority;
  return {sql: `${authority.sql} AND EXISTS (SELECT 1 FROM import_previews p WHERE p.id=? AND p.ledger_id=?
    AND p.account_id=? AND p.file_sha256=? AND p.owner_binding_digest=? AND p.status='publishing' AND p.operation_id=? AND p.revision=? AND julianday(p.expires_at)>julianday('now'))`,
    bindings:[...authority.bindings,publication.previewId,context.ledgerId,input.accountId,input.fileSha256,publication.ownerBindingDigest,publication.operationId,publication.revision]};
}

function reviewCountSql() {
  return `(SELECT COUNT(*) FROM transactions t JOIN transaction_source_records r ON r.transaction_id=t.id AND r.ledger_id=t.ledger_id
    WHERE r.ledger_id=? AND r.source_kind='statement' AND r.account_id=? AND r.file_sha256=?
      AND (t.status='needs_review' OR EXISTS (SELECT 1 FROM statement_reconciliation_candidates c
        WHERE c.ledger_id=t.ledger_id AND c.statement_transaction_id=t.id AND c.status='open')))`;
}

function previewPublicationStatements(db: D1Database, context: FinancialContext, input: PublicationMetadata) {
  const publication = input.publication;
  if (!publication) return [];
  return [
    db.prepare(`UPDATE statement_reconciliation_candidates AS c SET
      status=(SELECT d.status FROM import_duplicate_decisions d WHERE d.preview_id=? AND d.ledger_id=? AND d.candidate_id=c.id),
      evidence_basis='user_review', updated_at=CURRENT_TIMESTAMP
      WHERE c.ledger_id=? AND c.status='open'
        AND c.source_record_id IN (SELECT id FROM transaction_source_records WHERE ledger_id=? AND account_id=? AND file_sha256=?)
        AND EXISTS (SELECT 1 FROM import_duplicate_decisions d WHERE d.preview_id=? AND d.ledger_id=? AND d.candidate_id=c.id)`)
      .bind(publication.previewId,context.ledgerId,context.ledgerId,context.ledgerId,input.accountId,input.fileSha256,publication.previewId,context.ledgerId),
    db.prepare(`UPDATE import_previews SET status='published',receipt_id=?,committed_count=?,duplicate_count=?,
      review_count=(SELECT review_count FROM import_commit_operations WHERE id=? AND ledger_id=?),published_at=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND ledger_id=? AND owner_binding_digest=? AND status='publishing' AND operation_id=? AND revision=?`)
      .bind(publication.receiptId,input.acceptedCount,input.duplicateCount,input.operationId,context.ledgerId,publication.publishedAt,
        publication.previewId,context.ledgerId,publication.ownerBindingDigest,publication.operationId,publication.revision),
  ];
}

/** Appended to the same D1 batch as every financial row; a failed authority/state guard aborts the batch. */
export function statementPublicationStatements(db: D1Database, context: FinancialContext, input: PublicationMetadata) {
  const authority = publicationAuthority(context,input);
  return [
    db.prepare(`INSERT INTO imports (id,ledger_id,account_id,filename,row_count,accepted_count,error_count,status)
      VALUES (?,?,?,?,?,?,0,'committed')`).bind(input.operationId,context.ledgerId,input.accountId,input.filename,input.requestedCount,input.acceptedCount),
    db.prepare(`INSERT INTO import_commit_operations
      (id,ledger_id,account_id,file_sha256,status,requested_count,accepted_count,duplicate_count,review_count)
      VALUES (?,CASE WHEN ${authority.sql} THEN ? ELSE NULL END,?,?,'committed',?,?,?,0)`)
      .bind(input.operationId,...authority.bindings,context.ledgerId,input.accountId,input.fileSha256,input.requestedCount,input.acceptedCount,input.duplicateCount),
    db.prepare(`UPDATE import_commit_operations SET review_count=${reviewCountSql()},
      status=CASE WHEN ${reviewCountSql()}>0 THEN 'partial_review' ELSE 'committed' END WHERE id=? AND ledger_id=?`)
      .bind(context.ledgerId,input.accountId,input.fileSha256,context.ledgerId,input.accountId,input.fileSha256,input.operationId,context.ledgerId),
    ...previewPublicationStatements(db,context,input),
  ];
}

/** Classify an expiry denial after the failed batch has rolled back. */
export async function assertPublicationNotExpired(db: D1Database, context: FinancialContext, publication?: ImportPublicationBinding) {
  if (!publication) return;
  const expired = await db.prepare(`SELECT 1 AS expired FROM import_previews WHERE id=? AND ledger_id=?
    AND status<>'published' AND julianday(expires_at)<=julianday('now')`).bind(publication.previewId,context.ledgerId).first();
  if (expired) throw new ImportStoreError('expired','The import preview has expired.',410);
}
