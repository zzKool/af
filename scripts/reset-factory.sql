-- The factory reset (the owner, 2026-11-09: "really start from a fresh app"): every table emptied but the ones
-- that come from an outside source and must stay right — the BAS chart (bas_groups, bas_categories), the ECB
-- rates (ecb_rates) — and the app's own configuration (bank_formats: how a Nordea CSV reads; the migrations).
-- The login, the organisation, the company, the VAT registrations, the bank accounts, the traktamente rates and
-- every working item go. psql variable: commit (true = write, false = count and roll back).
-- TRUNCATE without CASCADE: if a kept table pointed at an emptied one, Postgres refuses and nothing changes.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE wiped (tbl text PRIMARY KEY, rows bigint) ON COMMIT DROP;
DO $$
DECLARE
  keep text[] := ARRAY['_prisma_migrations', 'bas_groups', 'bas_categories', 'ecb_rates', 'bank_formats'];
  t text;
  n bigint;
  list text := '';
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
           WHERE s.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> ALL (keep) ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    INSERT INTO wiped VALUES (t, n);
    list := list || CASE WHEN list = '' THEN '' ELSE ', ' END || format('public.%I', t);
  END LOOP;
  EXECUTE 'TRUNCATE ' || list || ' RESTART IDENTITY';
  -- queued work; the schedules come back when the app starts
  TRUNCATE pgboss.job;
END $$;
SELECT tbl AS "emptied", rows FROM wiped WHERE rows > 0 ORDER BY tbl;
SELECT 'bas_categories' AS "kept", count(*) AS rows FROM bas_categories
  UNION ALL SELECT 'bas_groups', count(*) FROM bas_groups
  UNION ALL SELECT 'ecb_rates', count(*) FROM ecb_rates;
\if :commit
COMMIT;
\else
ROLLBACK;
\endif
