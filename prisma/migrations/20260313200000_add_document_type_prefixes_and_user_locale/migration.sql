-- Migration: add_document_type_prefixes_and_user_locale
-- Story 3.4: Document-Type Prefixes & Personal Locale
--
-- Architecture:
--   document_type_prefixes — Tenant-level CRUD (tenant_id, RLS enabled).
--                            Configurable prefixes for business key generation.
--                            Document types are free-form strings (no enum).
--                            Downstream: Epic 5 document upload business keys.
--
--   user_preferences      — User-scoped (NO tenant_id, NO RLS).
--                            Stores personal display preferences (locale).
--                            Access controlled by userId from auth context.

-- ============================================================================
-- PART 1: document_type_prefixes (tenant-level, full CRUD with RLS)
-- ============================================================================

CREATE TABLE document_type_prefixes (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID            NOT NULL,
    document_type   VARCHAR(30)     NOT NULL,
    prefix          VARCHAR(10)     NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    created_by      UUID            NOT NULL,
    source          VARCHAR(20)     NOT NULL DEFAULT 'web'
);

-- Unique constraint: one prefix per document type per tenant
ALTER TABLE document_type_prefixes
    ADD CONSTRAINT document_type_prefixes_tenant_document_type_unique
    UNIQUE (tenant_id, document_type);

-- Foreign key to tenants
ALTER TABLE document_type_prefixes
    ADD CONSTRAINT document_type_prefixes_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: tenant isolation
ALTER TABLE document_type_prefixes ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_type_prefixes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON document_type_prefixes
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Grants: full CRUD for app role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE document_type_prefixes TO defterfab_app;

-- ============================================================================
-- PART 2: user_preferences (user-scoped, NO RLS)
-- ============================================================================

-- NO ROW LEVEL SECURITY on user_preferences (user-scoped, not tenant-scoped)
CREATE TABLE user_preferences (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID            NOT NULL UNIQUE,
    locale          VARCHAR(10),
    source          VARCHAR(20)     NOT NULL DEFAULT 'manual',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Grants: full CRUD for app role (no RLS — access controlled at application level by userId)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_preferences TO defterfab_app;
