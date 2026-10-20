-- D30 (open question B15, owner's OK 2026-10-20): the two v2 numbering tables are gone.
-- document_type_prefixes — the configurable prefix engine, replaced by the fixed UPLOAD_KIND_PREFIX
--   constants in src/modules/numbering/keys.ts (D6). Nothing has read or written it since 4.4.
-- document_key_counters  — the monthly upload counters, carried over into number_series('doc-yyyy-mm')
--   by 20261020150000_add_number_series. Nothing has read or written it since.
-- Data dropped: tenant prefix rows (constants now) and counters already copied. Not reversible by design.

DROP TABLE IF EXISTS "document_type_prefixes";
DROP TABLE IF EXISTS "document_key_counters";
