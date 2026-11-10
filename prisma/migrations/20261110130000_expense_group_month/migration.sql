-- T025 (specs/justify/tasks.md, F174): the month a batch expense group stands for, as a fact (`YYYY-MM`) — set when
-- the reading dialog creates the month's group for a paper; the group proposal (`proposeGroupForDate`) reads it
-- instead of recognising the month in the group's name. Additive: one nullable column and its shape check; nothing
-- dropped, no existing value rewritten.
ALTER TABLE "expense_groups" ADD COLUMN "month" CHAR(7);
ALTER TABLE "expense_groups"
  ADD CONSTRAINT "expense_groups_month_check" CHECK ("month" IS NULL OR "month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- the backfill (idempotent — only batch groups without a month): the month today's name says, by the rule the
-- proposal used until now (`monthOfGroupName`): a `2026-07` in the name, else the first `<word> <year>` whose word
-- is an English month or its start (`July 2026`, `Jul 2026`, `Mar. 2026`). A trip group is proposed by its days.
DO $$
DECLARE
  filled integer;
BEGIN
  WITH parsed AS (
    SELECT
      id,
      substring(description from '(?:^|[^0-9])([0-9]{4}-(?:0[1-9]|1[0-2]))(?![0-9])') AS iso,
      lower(substring(description from '\m([A-Za-z]{3,9})\.?\s+[0-9]{4}\M')) AS word,
      substring(description from '\m[A-Za-z]{3,9}\.?\s+([0-9]{4})\M') AS year
    FROM expense_groups
    WHERE kind = 'batch' AND month IS NULL
  ),
  resolved AS (
    SELECT
      p.id,
      COALESCE(
        p.iso,
        (
          SELECT p.year || '-' || lpad(m.n::text, 2, '0')
          FROM unnest(ARRAY['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
                            'september', 'october', 'november', 'december']) WITH ORDINALITY AS m(name, n)
          WHERE p.word IS NOT NULL AND (m.name = p.word OR m.name LIKE p.word || '%')
          ORDER BY m.n
          LIMIT 1
        )
      ) AS month
    FROM parsed p
  )
  UPDATE expense_groups g
  SET month = r.month
  FROM resolved r
  WHERE g.id = r.id AND r.month IS NOT NULL;
  GET DIAGNOSTICS filled = ROW_COUNT;
  RAISE NOTICE 'expense_group_month: % batch group(s) given the month their name says', filled;
END $$;
