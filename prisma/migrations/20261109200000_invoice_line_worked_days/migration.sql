-- F168 (the owner, 2026-11-09: "might be nice to store them"): the days worked a line bills, as picked on the invoice
-- studio's calendar. Additive and nullable-free with an empty default — every existing line keeps its quantity and
-- gets no days; nothing is dropped or rewritten.
ALTER TABLE "invoice_lines" ADD COLUMN "worked_days" DATE[] NOT NULL DEFAULT '{}';
