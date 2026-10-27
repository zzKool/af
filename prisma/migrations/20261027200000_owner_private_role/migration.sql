-- The owner's private instruments are bank accounts (F114, D60 — specs/linking/payment-record.md, US4).
-- Its own migration: Postgres cannot use a new enum value in the transaction that adds it.
ALTER TYPE "bank_account_role" ADD VALUE 'owner_private';
