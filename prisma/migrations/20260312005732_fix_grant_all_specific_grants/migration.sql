-- Fix GRANT ALL → specific grants for af_app role
-- The init migration used GRANT ALL which is overly permissive.
-- This migration revokes ALL and re-grants with table-specific permissions.

-- Step 0: Grant USAGE ON SCHEMA public (PG 17 no longer grants this by default)
GRANT USAGE ON SCHEMA public TO af_app;

-- Step 1: Revoke ALL on existing tables and sequences
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM af_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM af_app;

-- Step 2: Re-grant with specific permissions per table

-- Full CRUD tables (SELECT, INSERT, UPDATE, DELETE)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenants" TO af_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_configs" TO af_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "users" TO af_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "sessions" TO af_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "accounts" TO af_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "organizations" TO af_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "members" TO af_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "invitations" TO af_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "verifications" TO af_app;

-- Immutable / append-only tables (SELECT, INSERT only)
GRANT SELECT, INSERT ON TABLE "audit_logs" TO af_app;
GRANT SELECT, INSERT ON TABLE "ecb_rates" TO af_app;

-- Step 3: Sequences — USAGE and SELECT only
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO af_app;

-- Step 4: Fix ALTER DEFAULT PRIVILEGES for future tables/sequences
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM af_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM af_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO af_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO af_app;
