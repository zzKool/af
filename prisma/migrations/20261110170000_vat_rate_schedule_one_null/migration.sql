-- Lessons "two nulls" / V6 (the owner, 2026-11-10: "fix it"): rates cleared before F64 were stored as JSON `null`
-- ('null'::jsonb) instead of SQL NULL; F64 writes SQL NULL since. One null from now on: only those rows change, to the
-- value the code already reads them as (no rates). Idempotent; nothing else is touched.
UPDATE "vat_registrations" SET "rate_schedule" = NULL WHERE "rate_schedule" = 'null'::jsonb;
