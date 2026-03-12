-- Fix bas_categories permissions: REVOKE default privileges and add INSERT rule
-- ALTER DEFAULT PRIVILEGES granted INSERT/UPDATE/DELETE when table was created.
-- bas_categories should be SELECT-only for the app role.

-- Revoke write permissions granted by ALTER DEFAULT PRIVILEGES
REVOKE INSERT, UPDATE, DELETE ON TABLE bas_categories FROM defterfab_app;

-- Add INSERT rule for completeness (belt-and-suspenders with REVOKE)
CREATE RULE no_insert_bas AS ON INSERT TO bas_categories DO INSTEAD NOTHING;
