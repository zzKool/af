-- What a printed invoice needs about the company that nothing stored yet (specs/invoices FR-015):
-- a contact line (email, website, phone) and the bank account's IBAN / BIC for the payment box.
ALTER TABLE "tenants" ADD COLUMN "email" VARCHAR(254);
ALTER TABLE "tenants" ADD COLUMN "website" VARCHAR(200);
ALTER TABLE "tenants" ADD COLUMN "phone" VARCHAR(30);
ALTER TABLE "bank_accounts" ADD COLUMN "iban" VARCHAR(34);
ALTER TABLE "bank_accounts" ADD COLUMN "bic" VARCHAR(11);
