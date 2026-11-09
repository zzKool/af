-- The working items to drop, by scope and from a date (scripts/reset-working-data.sh asks; the owner,
-- 2026-11-09). psql variables: from (a date, or -infinity for everything), the scopes bank, docs, partners,
-- invoices, expenses, subs, rules (true / false), commit (true = write, false = count and roll back).
-- One transaction. Every statement names its rows; nothing cascades across modules. What is kept: the login,
-- the company, the bank accounts, the VAT registrations, the BAS chart and settings, the rates, the system
-- partners, the seed rules, the schedules.
\set ON_ERROR_STOP on
BEGIN;
\o /dev/null
SELECT set_config('af.from', :'from', true), set_config('af.bank', :'bank', true),
       set_config('af.docs', :'docs', true), set_config('af.partners', :'partners', true),
       set_config('af.invoices', :'invoices', true), set_config('af.expenses', :'expenses', true),
       set_config('af.subs', :'subs', true), set_config('af.rules', :'rules', true);
\o

CREATE TEMP TABLE gone (t text NOT NULL, id uuid NOT NULL, PRIMARY KEY (t, id)) ON COMMIT DROP;

DO $$
DECLARE
  f date := current_setting('af.from')::date;
  everything boolean := current_setting('af.from') = '-infinity';
  s_bank boolean := current_setting('af.bank')::boolean;
  s_docs boolean := current_setting('af.docs')::boolean;
  s_partners boolean := current_setting('af.partners')::boolean;
  s_invoices boolean := current_setting('af.invoices')::boolean;
  s_expenses boolean := current_setting('af.expenses')::boolean;
  s_subs boolean := current_setting('af.subs')::boolean;
  s_rules boolean := current_setting('af.rules')::boolean;
  n integer;
BEGIN
  -- ── what goes ─────────────────────────────────────────────────────────────────────────────────────────
  IF s_bank THEN
    INSERT INTO gone SELECT 'bank_transaction', id FROM bank_transactions WHERE booking_date >= f;
    -- a refund settlement stands on its bank row
    INSERT INTO gone SELECT 'settlement', id FROM settlements
      WHERE bank_transaction_id IN (SELECT id FROM gone WHERE t = 'bank_transaction') ON CONFLICT DO NOTHING;
    -- an import whose rows all go goes with its CSV
    INSERT INTO gone SELECT 'bank_import', i.id FROM bank_imports i
      WHERE NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE b.bank_import_id = i.id
                          AND b.id NOT IN (SELECT id FROM gone WHERE t = 'bank_transaction'))
        AND (everything OR coalesce(i.period_from, i.imported_at::date) >= f);
    INSERT INTO gone SELECT 'document', document_id FROM bank_imports
      WHERE id IN (SELECT id FROM gone WHERE t = 'bank_import') AND document_id IS NOT NULL ON CONFLICT DO NOTHING;
  END IF;

  IF s_invoices THEN
    INSERT INTO gone SELECT 'invoice', id FROM invoices WHERE coalesce(issue_date, created_at::date) >= f;
    -- a credit note of an invoice that goes goes too
    INSERT INTO gone SELECT 'invoice', id FROM invoices
      WHERE related_invoice_id IN (SELECT id FROM gone WHERE t = 'invoice') ON CONFLICT DO NOTHING;
    INSERT INTO gone SELECT 'document', pdf_document_id FROM invoices
      WHERE id IN (SELECT id FROM gone WHERE t = 'invoice') AND pdf_document_id IS NOT NULL ON CONFLICT DO NOTHING;
    INSERT INTO gone SELECT 'vat_declaration', id FROM swiss_vat_declarations
      WHERE everything OR coalesce(declared_at::date, created_at::date) >= f;
  END IF;

  IF s_expenses THEN
    INSERT INTO gone SELECT 'expense', id FROM expenses WHERE date >= f;
    INSERT INTO gone SELECT 'supplier_invoice', id FROM supplier_invoices WHERE invoice_date >= f;
    INSERT INTO gone SELECT 'trip', id FROM trips WHERE departure_at::date >= f;
    INSERT INTO gone SELECT 'expense', per_diem_expense_id FROM trips
      WHERE id IN (SELECT id FROM gone WHERE t = 'trip') AND per_diem_expense_id IS NOT NULL ON CONFLICT DO NOTHING;
    INSERT INTO gone SELECT 'settlement', id FROM settlements WHERE created_at::date >= f ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO gone SELECT 'document', statement_document_id FROM settlements
    WHERE id IN (SELECT id FROM gone WHERE t = 'settlement') AND statement_document_id IS NOT NULL ON CONFLICT DO NOTHING;
  INSERT INTO gone SELECT 'document', per_diem_document_id FROM trips
    WHERE id IN (SELECT id FROM gone WHERE t = 'trip') AND per_diem_document_id IS NOT NULL ON CONFLICT DO NOTHING;

  IF s_subs THEN
    INSERT INTO gone SELECT 'subscription', id FROM subscriptions WHERE everything OR start_date >= f;
  END IF;

  IF s_docs THEN
    INSERT INTO gone SELECT 'document', id FROM documents WHERE created_at::date >= f ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO gone SELECT 'package_build', id FROM package_builds
    WHERE document_id IN (SELECT id FROM gone WHERE t = 'document') OR (s_docs AND (everything OR period >= to_char(f, 'YYYY-MM')));
  INSERT INTO gone SELECT 'document', document_id FROM package_builds
    WHERE id IN (SELECT id FROM gone WHERE t = 'package_build') AND document_id IS NOT NULL ON CONFLICT DO NOTHING;

  IF s_rules THEN
    INSERT INTO gone SELECT 'rule', id FROM categorisation_rules WHERE source <> 'seed' AND (everything OR created_at::date >= f);
  END IF;

  -- ── the deletes, children first — the links first (a linked row refuses to go, block_delete_when_linked) ──
  DELETE FROM links l WHERE EXISTS (SELECT 1 FROM gone g WHERE g.id IN (l.from_id, l.to_id));
  DELETE FROM proposals WHERE bank_transaction_id IN (SELECT id FROM gone WHERE t = 'bank_transaction')
    OR document_id IN (SELECT id FROM gone WHERE t = 'document')
    OR target_id IN (SELECT id FROM gone);
  DELETE FROM settlements WHERE id IN (SELECT id FROM gone WHERE t = 'settlement');
  DELETE FROM journal_entries WHERE s_bank AND entry_date >= f;
  DELETE FROM bank_transactions WHERE id IN (SELECT id FROM gone WHERE t = 'bank_transaction');
  DELETE FROM bank_imports WHERE id IN (SELECT id FROM gone WHERE t = 'bank_import');

  DELETE FROM invoices WHERE id IN (SELECT id FROM gone WHERE t = 'invoice') AND related_invoice_id IS NOT NULL;
  DELETE FROM invoices WHERE id IN (SELECT id FROM gone WHERE t = 'invoice');
  DELETE FROM swiss_vat_declarations WHERE id IN (SELECT id FROM gone WHERE t = 'vat_declaration');

  DELETE FROM trips WHERE id IN (SELECT id FROM gone WHERE t = 'trip');
  UPDATE trips SET per_diem_expense_id = NULL WHERE per_diem_expense_id IN (SELECT id FROM gone WHERE t = 'expense');
  UPDATE swiss_vat_declarations SET payment_expense_id = NULL
    WHERE payment_expense_id IN (SELECT id FROM gone WHERE t = 'expense');
  DELETE FROM expenses WHERE id IN (SELECT id FROM gone WHERE t = 'expense');
  DELETE FROM supplier_invoices WHERE id IN (SELECT id FROM gone WHERE t = 'supplier_invoice');
  DELETE FROM subscriptions WHERE id IN (SELECT id FROM gone WHERE t = 'subscription');

  -- what still points at a document that goes lets go of it
  DELETE FROM package_builds WHERE id IN (SELECT id FROM gone WHERE t = 'package_build');
  UPDATE invoices SET pdf_document_id = NULL WHERE pdf_document_id IN (SELECT id FROM gone WHERE t = 'document');
  UPDATE bank_imports SET document_id = NULL WHERE document_id IN (SELECT id FROM gone WHERE t = 'document');
  UPDATE settlements SET statement_document_id = NULL
    WHERE statement_document_id IN (SELECT id FROM gone WHERE t = 'document');
  UPDATE trips SET per_diem_document_id = NULL WHERE per_diem_document_id IN (SELECT id FROM gone WHERE t = 'document');
  DELETE FROM documents WHERE id IN (SELECT id FROM gone WHERE t = 'document');

  -- expense groups left empty (created in the period)
  IF s_expenses THEN
    INSERT INTO gone SELECT 'expense_group', g.id FROM expense_groups g
      WHERE (everything OR g.created_at::date >= f)
        AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.group_id = g.id)
        AND NOT EXISTS (SELECT 1 FROM supplier_invoices s WHERE s.group_id = g.id)
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.group_id = g.id)
        AND NOT EXISTS (SELECT 1 FROM trips x WHERE x.group_id = g.id);
    DELETE FROM expense_groups WHERE id IN (SELECT id FROM gone WHERE t = 'expense_group');
  END IF;

  DELETE FROM categorisation_rules WHERE id IN (SELECT id FROM gone WHERE t = 'rule');

  -- contracts started in the period that no remaining invoice uses, then the partners nothing uses any more
  IF s_partners THEN
    INSERT INTO gone SELECT 'contract', c.id FROM contracts c
      WHERE (everything OR c.start_date >= f) AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.contract_id = c.id);
    DELETE FROM links l WHERE EXISTS (SELECT 1 FROM gone g WHERE g.t = 'contract' AND g.id IN (l.from_id, l.to_id));
    DELETE FROM contract_rates WHERE contract_id IN (SELECT id FROM gone WHERE t = 'contract');
    DELETE FROM contracts WHERE id IN (SELECT id FROM gone WHERE t = 'contract');
    INSERT INTO gone SELECT 'partner', p.id FROM partners p
      WHERE p.system_role IS NULL AND (everything OR p.created_at::date >= f)
        AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.partner_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM expenses x WHERE x.partner_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM supplier_invoices x WHERE x.partner_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM subscriptions x WHERE x.partner_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM bank_transactions x WHERE x.partner_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM journal_entries x WHERE x.partner_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM categorisation_rules x WHERE x.partner_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM contracts x WHERE x.partner_id = p.id OR x.assigned_employee_id = p.id);
    DELETE FROM links l WHERE EXISTS (SELECT 1 FROM gone g WHERE g.t = 'partner' AND g.id IN (l.from_id, l.to_id));
    DELETE FROM partners WHERE id IN (SELECT id FROM gone WHERE t = 'partner');
  END IF;

  -- ── what pointed at them ──────────────────────────────────────────────────────────────────────────────
  DELETE FROM audit_logs a WHERE a.entity_id IN (SELECT id::text FROM gone);
  DELETE FROM pgboss.job j WHERE j.state IN ('created', 'retry', 'active')
    AND EXISTS (SELECT 1 FROM gone g WHERE g.t = 'document' AND j.data::text LIKE '%' || g.id || '%');

  -- the numbers start again after the last one kept: client documents (VA26-INV, -QUO, -CN), refunds (ST26),
  -- expense keys (exg-213-Tr); an upload month with nothing left; the group counter only on a full reset
  DELETE FROM number_series ns WHERE ns.series ~ '-(INV|QUO|CN)$'
    AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.tenant_id = ns.tenant_id AND i.number LIKE ns.series || '-%');
  UPDATE number_series ns SET next_value = 1 + (SELECT max(substring(i.number FROM '-([0-9]+)$')::int) FROM invoices i
      WHERE i.tenant_id = ns.tenant_id AND i.number LIKE ns.series || '-%')
    WHERE ns.series ~ '-(INV|QUO|CN)$';
  DELETE FROM number_series ns WHERE ns.series ~ '^ST[0-9]{2}$'
    AND NOT EXISTS (SELECT 1 FROM settlements s WHERE s.tenant_id = ns.tenant_id AND s.number LIKE ns.series || '-%');
  UPDATE number_series ns SET next_value = 1 + (SELECT max(substring(s.number FROM '-([0-9]+)$')::int) FROM settlements s
      WHERE s.tenant_id = ns.tenant_id AND s.number LIKE ns.series || '-%')
    WHERE ns.series ~ '^ST[0-9]{2}$';
  WITH used AS (
    SELECT e.tenant_id, 'exg-' || g.number || '-' || e.alias AS series, e.seq FROM expenses e JOIN expense_groups g ON g.id = e.group_id
    UNION ALL
    SELECT s.tenant_id, 'exg-' || g.number || '-' || s.alias, s.seq FROM supplier_invoices s JOIN expense_groups g ON g.id = s.group_id
  )
  DELETE FROM number_series ns WHERE ns.series LIKE 'exg-%'
    AND NOT EXISTS (SELECT 1 FROM used u WHERE u.tenant_id = ns.tenant_id AND u.series = ns.series);
  WITH used AS (
    SELECT e.tenant_id, 'exg-' || g.number || '-' || e.alias AS series, e.seq FROM expenses e JOIN expense_groups g ON g.id = e.group_id
    UNION ALL
    SELECT s.tenant_id, 'exg-' || g.number || '-' || s.alias, s.seq FROM supplier_invoices s JOIN expense_groups g ON g.id = s.group_id
  )
  UPDATE number_series ns SET next_value = 1 + (SELECT max(u.seq) FROM used u WHERE u.tenant_id = ns.tenant_id AND u.series = ns.series)
    WHERE ns.series LIKE 'exg-%';
  DELETE FROM number_series ns WHERE ns.series LIKE 'doc-%'
    AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.tenant_id = ns.tenant_id
                      AND to_char(d.created_at, 'YYYY-MM') = substring(ns.series FROM 5));
  IF everything AND s_expenses AND NOT EXISTS (SELECT 1 FROM expense_groups) THEN
    DELETE FROM number_series WHERE series = 'expense_group';
  END IF;
  -- a full reset also forgets the table layouts
  IF everything AND s_bank AND s_docs AND s_partners AND s_invoices AND s_expenses AND s_subs AND s_rules THEN
    DELETE FROM table_preferences;
  END IF;
END $$;

-- what this run drops (or would drop)
SELECT t AS "drops", count(*) AS "rows" FROM gone GROUP BY t ORDER BY t;

\if :commit
COMMIT;
\else
ROLLBACK;
\endif
