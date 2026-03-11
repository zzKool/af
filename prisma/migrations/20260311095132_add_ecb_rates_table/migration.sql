-- CreateTable
CREATE TABLE "ecb_rates" (
    "date" DATE NOT NULL,
    "currency_pair" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ecb_rates_pkey" PRIMARY KEY ("date","currency_pair")
);

-- Explicit GRANT for app role — ecb_rates is global (no RLS), read/write by app
GRANT SELECT, INSERT ON "ecb_rates" TO defterfab_app;

-- Immutability: prevent UPDATE and DELETE (silently drops — does NOT throw)
CREATE RULE ecb_rates_no_update AS ON UPDATE TO ecb_rates DO INSTEAD NOTHING;
CREATE RULE ecb_rates_no_delete AS ON DELETE TO ecb_rates DO INSTEAD NOTHING;
