import type { D1Database, LedgerId } from './db-types';

function text(value: string, field: string, max = 2048) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new RangeError(`${field} is not bounded.`);
  return value;
}

export interface AnnotationRevisionInput {
  id: string;
  ledgerId?: LedgerId;
  transactionId: string;
  authorSubjectHash: string;
  revision: number;
  category: string;
  note: string | null;
}

export async function appendAnnotationRevision(db: D1Database, input: AnnotationRevisionInput) {
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new RangeError('Annotation revision must be positive.');
  await db.prepare(`INSERT INTO annotation_revisions
    (id, ledger_id, transaction_id, author_subject_hash, revision, category, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
    text(input.id, 'annotation id', 256),
    input.ledgerId ?? 'personal',
    text(input.transactionId, 'annotation transaction id', 256),
    text(input.authorSubjectHash, 'annotation author hash', 256),
    input.revision,
    text(input.category, 'annotation category', 256),
    input.note === null ? null : text(input.note, 'annotation note', 4096),
  ).run();
}

export async function readLatestAnnotation(db: D1Database, transactionId: string) {
  return db.prepare(`SELECT id, ledger_id, transaction_id, author_subject_hash, revision, category, note, created_at
    FROM annotation_revisions WHERE transaction_id = ? ORDER BY revision DESC LIMIT 1`).bind(text(transactionId, 'annotation transaction id', 256)).first<{
      id: string;
      ledger_id: LedgerId;
      transaction_id: string;
      author_subject_hash: string;
      revision: number;
      category: string;
      note: string | null;
      created_at: string;
    }>();
}
