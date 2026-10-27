import type { D1Database, LedgerId } from './db-types';
import { assertFinancialAuthority, immutableFinancialContext, type FinancialContext } from './financial-authority';
import { ledgerScopedIdentifier } from './ledger-identifiers';
import { reviewStateGuard, publishReview } from './review-publication';

function text(value: string, field: string, max = 2048) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new RangeError(`${field} is not bounded.`);
  return value;
}

export interface AnnotationRevisionInput {
  id: string;
  transactionId: string;
  authorSubjectHash: string;
  revision: number;
  category: string;
  note: string | null;
}

function annotationAuthor(context: FinancialContext, fallback: string) {
  return 'credentialType' in context ? context.subjectHash : fallback;
}

export async function appendAnnotationRevision(db: D1Database, suppliedContext: FinancialContext, suppliedInput: AnnotationRevisionInput) {
  const context = immutableFinancialContext(suppliedContext);
  const input = { ...suppliedInput };
  const author = annotationAuthor(suppliedContext, input.authorSubjectHash);
  await assertFinancialAuthority(db, context, 'ledger:review');
  const id = await ledgerScopedIdentifier(context, 'annotation', input.id);
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new RangeError('Annotation revision must be positive.');
  const statement = db.prepare(`INSERT INTO annotation_revisions
    (id, ledger_id, transaction_id, author_subject_hash, revision, category, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
    text(id, 'annotation id', 256),
    context.ledgerId,
    text(input.transactionId, 'annotation transaction id', 256),
    text(author, 'annotation author hash', 256),
    input.revision,
    text(input.category, 'annotation category', 256),
    input.note === null ? null : text(input.note, 'annotation note', 4096),
  );
  const revisionGuard = reviewStateGuard(db, context, `EXISTS (
      SELECT 1 FROM transactions WHERE id=? AND ledger_id=?)
    AND (SELECT COALESCE(MAX(revision),0) FROM annotation_revisions
      WHERE transaction_id=? AND ledger_id=?)=?`, [
    input.transactionId, context.ledgerId,
    input.transactionId, context.ledgerId, input.revision - 1,
  ]);
  await publishReview(db, context, [revisionGuard, statement]);
  return id;
}

export async function readLatestAnnotation(db: D1Database, suppliedContext: FinancialContext, transactionId: string) {
  const context = immutableFinancialContext(suppliedContext);
  await assertFinancialAuthority(db, context, 'ledger:read');
  const result = await db.prepare(`SELECT id, ledger_id, transaction_id, author_subject_hash, revision, category, note, created_at
    FROM annotation_revisions WHERE ledger_id = ? AND transaction_id = ? ORDER BY revision DESC LIMIT 1`).bind(context.ledgerId, text(transactionId, 'annotation transaction id', 256)).first<{
      id: string;
      ledger_id: LedgerId;
      transaction_id: string;
      author_subject_hash: string;
      revision: number;
      category: string;
      note: string | null;
      created_at: string;
    }>();
  await assertFinancialAuthority(db, context, 'ledger:read');
  return result;
}
