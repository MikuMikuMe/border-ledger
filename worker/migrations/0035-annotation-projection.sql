UPDATE transactions AS transaction_row
SET category = (
      SELECT revision.category FROM annotation_revisions revision
      WHERE revision.ledger_id = transaction_row.ledger_id AND revision.transaction_id = transaction_row.id
      ORDER BY revision.revision DESC LIMIT 1
    ),
    note = (
      SELECT revision.note FROM annotation_revisions revision
      WHERE revision.ledger_id = transaction_row.ledger_id AND revision.transaction_id = transaction_row.id
      ORDER BY revision.revision DESC LIMIT 1
    )
WHERE EXISTS (
  SELECT 1 FROM annotation_revisions revision
  WHERE revision.ledger_id = transaction_row.ledger_id AND revision.transaction_id = transaction_row.id
    AND revision.revision = (
      SELECT MAX(latest.revision) FROM annotation_revisions latest
      WHERE latest.ledger_id = transaction_row.ledger_id AND latest.transaction_id = transaction_row.id
    )
    AND (transaction_row.category IS NOT revision.category OR transaction_row.note IS NOT revision.note)
);