-- A justified row names a partner (F129, D73 — specs/justify/rework.md US4 / US5).
-- The *no proof needed* reasons type a partner from now on (there is no proof to derive one from), so four partners
-- exist once per tenant — the bank, Skatteverket, the Swiss FTA, the owner as employee — ordinary and editable, found
-- again by `partners.system_role`, a column no form shows. The rows flagged *no proof* before today carry no partner:
-- they are placed from their rule's partner, else from their account (bank fees / interest → the bank, tax → the
-- agency of the account's currency, salary → the owner); what cannot be placed re-opens as *no proof · no partner*.
-- The no-proof rules get the same map. Every row touched gets an audit `update` row (`source = migration`,
-- `new_data.migration = justified_partner`) — the trail is the reversal path (docs/deployment.md). Counts are
-- logged as NOTICEs. Runs as the compose's superuser (the tables are FORCE ROW LEVEL SECURITY — lessons, F113);
-- a second run finds every role held and changes nothing.

-- ----------------------------------------------------------------------------
-- 1. the column: the role a seeded partner plays, one per tenant
-- ----------------------------------------------------------------------------
ALTER TABLE "partners" ADD COLUMN "system_role" VARCHAR(20);
ALTER TABLE "partners" ADD CONSTRAINT "partners_system_role_check"
    CHECK ("system_role" IS NULL OR "system_role" IN ('bank', 'tax_agency_se', 'tax_agency_ch', 'owner'));
CREATE UNIQUE INDEX "partners_tenant_system_role_key" ON "partners" ("tenant_id", "system_role") WHERE "system_role" IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. per tenant: a hand-made partner of the name gets the role (D70 would refuse a twin), the missing ones are inserted
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE jp_owner ("tenant_id" UUID PRIMARY KEY, "user_id" UUID NOT NULL) ON COMMIT DROP;
DO $$
DECLARE
    t            record;
    wanted       record;
    owner_user   uuid;
    owner_name   text;
    bank_name    text;
    existing     uuid;
    n_created    int;
    n_attached   int;
    tot_created  int := 0;
    tot_attached int := 0;
    tot_tenants  int := 0;
    skipped      int := 0;
BEGIN
    FOR t IN SELECT "id" FROM "tenants" ORDER BY "created_at", "id" LOOP
        -- who owns the four: the oldest member with the owner role, else the oldest member, else who imported the
        -- first row, else who made the first partner — a tenant with nobody gets nothing (named below)
        SELECT m."user_id" INTO owner_user FROM "members" m
         WHERE m."organization_id" = t."id" ORDER BY (m."role" <> 'owner'), m."created_at" LIMIT 1;
        IF owner_user IS NULL THEN
            SELECT "created_by" INTO owner_user FROM "bank_transactions" WHERE "tenant_id" = t."id" ORDER BY "created_at" LIMIT 1;
        END IF;
        IF owner_user IS NULL THEN
            SELECT "created_by" INTO owner_user FROM "partners" WHERE "tenant_id" = t."id" ORDER BY "created_at" LIMIT 1;
        END IF;
        IF owner_user IS NULL THEN
            RAISE NOTICE 'justified_partner: tenant % has no member — nothing seeded for it', t."id";
            skipped := skipped + 1;
            CONTINUE;
        END IF;
        INSERT INTO jp_owner VALUES (t."id", owner_user);
        SELECT COALESCE(NULLIF(btrim(u."name"), ''), NULLIF(split_part(u."email", '@', 1), ''), 'Owner')
          INTO owner_name FROM "users" u WHERE u."id" = owner_user;
        owner_name := COALESCE(owner_name, 'Owner');
        -- the bank: the bank_name of the format the tenant's statement accounts use; else the one format the app ships
        SELECT f."bank_name" INTO bank_name
          FROM "bank_accounts" a JOIN "bank_formats" f ON f."id" = a."bank_format_id"
         WHERE a."tenant_id" = t."id" ORDER BY a."created_at" LIMIT 1;
        IF bank_name IS NULL THEN
            SELECT f."bank_name" INTO bank_name FROM "bank_formats" f ORDER BY f."created_at" LIMIT 1;
        END IF;
        bank_name := COALESCE(bank_name, 'Nordea');

        n_created := 0;
        n_attached := 0;
        FOR wanted IN
            SELECT * FROM (VALUES
                ('bank',          bank_name,                                ARRAY['vendor']::text[],    NULL::text,
                 ARRAY[lower(bank_name)]),
                ('tax_agency_se', 'Skatteverket',                           ARRAY['authority']::text[], 'SEK',
                 ARRAY['skatteverket']),
                ('tax_agency_ch', 'Swiss Federal Tax Administration (FTA)', ARRAY['authority']::text[], 'CHF',
                 ARRAY['swiss federal tax administration (fta)', 'swiss federal tax administration', 'fta', 'estv', 'afc']),
                ('owner',         owner_name,                               ARRAY['employee']::text[],  NULL::text,
                 ARRAY[lower(btrim(regexp_replace(owner_name, '\s+', ' ', 'g')))])
            ) AS v("role", "name", "types", "currency", "folded")
        LOOP
            -- the role held already: a second run
            IF EXISTS (SELECT 1 FROM "partners" p WHERE p."tenant_id" = t."id" AND p."system_role" = wanted."role") THEN
                CONTINUE;
            END IF;
            existing := NULL;
            SELECT p."id" INTO existing FROM "partners" p
             WHERE p."tenant_id" = t."id" AND p."system_role" IS NULL
               AND lower(btrim(regexp_replace(p."name", '\s+', ' ', 'g'))) = ANY (wanted."folded")
             ORDER BY p."created_at" LIMIT 1;
            IF existing IS NOT NULL THEN
                UPDATE "partners" SET "system_role" = wanted."role", "updated_at" = now() WHERE "id" = existing;
                INSERT INTO "audit_logs" ("tenant_id", "user_id", "action", "entity_type", "entity_id", "old_data", "new_data", "source")
                VALUES (t."id", owner_user, 'update', 'partner', existing::text,
                        jsonb_build_object('systemRole', NULL),
                        jsonb_build_object('systemRole', wanted."role", 'migration', 'justified_partner'), 'migration');
                n_attached := n_attached + 1;
            ELSE
                INSERT INTO "partners" ("tenant_id", "name", "types", "default_currency", "system_role", "created_by", "source", "updated_at")
                VALUES (t."id", wanted."name", wanted."types", wanted."currency", wanted."role", owner_user, 'migration', now())
                RETURNING "id" INTO existing;
                INSERT INTO "audit_logs" ("tenant_id", "user_id", "action", "entity_type", "entity_id", "new_data", "source")
                VALUES (t."id", owner_user, 'create', 'partner', existing::text,
                        jsonb_build_object('id', existing, 'name', wanted."name", 'types', to_jsonb(wanted."types"),
                                           'defaultCurrency', wanted."currency", 'systemRole', wanted."role",
                                           'isActive', true, 'source', 'migration', 'migration', 'justified_partner'),
                        'migration');
                n_created := n_created + 1;
            END IF;
        END LOOP;
        tot_tenants := tot_tenants + 1;
        tot_created := tot_created + n_created;
        tot_attached := tot_attached + n_attached;
        RAISE NOTICE 'justified_partner: tenant % — % partner(s) created, % role(s) attached to a hand-made partner', t."id", n_created, n_attached;
    END LOOP;
    RAISE NOTICE 'justified_partner: % partner(s) created and % role(s) attached over % tenant(s); % tenant(s) without a member skipped',
        tot_created, tot_attached, tot_tenants, skipped;
END $$;

-- ----------------------------------------------------------------------------
-- 3. the backfill of partner_id on the rows flagged *no proof needed*: (a) the rule's partner, else (b) the account
--    — both digit forms of the codes (D68's four digits may run before or after); categorised_by and rule_id untouched
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE jp_rows ("id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "partner_id" UUID NOT NULL, "how" TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO jp_rows
SELECT bt."id", bt."tenant_id", r."partner_id", 'rule'
  FROM "bank_transactions" bt
  JOIN "categorisation_rules" r ON r."id" = bt."rule_id" AND r."tenant_id" = bt."tenant_id"
 WHERE bt."no_document_needed" AND bt."partner_id" IS NULL AND r."partner_id" IS NOT NULL;
INSERT INTO jp_rows
SELECT bt."id", bt."tenant_id", p."id", 'account'
  FROM "bank_transactions" bt
  JOIN "bank_accounts" a ON a."id" = bt."bank_account_id"
  JOIN "partners" p ON p."tenant_id" = bt."tenant_id" AND p."system_role" =
       CASE
           WHEN bt."bas_code" IN ('657', '6570', '831', '8310') THEN 'bank'
           WHEN bt."bas_code" IN ('251', '2510') THEN CASE WHEN a."currency" = 'CHF' THEN 'tax_agency_ch' ELSE 'tax_agency_se' END
           WHEN bt."bas_code" IN ('721', '7210') THEN 'owner'
       END
 WHERE bt."no_document_needed" AND bt."partner_id" IS NULL
   AND NOT EXISTS (SELECT 1 FROM jp_rows j WHERE j."id" = bt."id");
UPDATE "bank_transactions" bt
   SET "partner_id" = j."partner_id", "updated_at" = now()
  FROM jp_rows j
 WHERE j."id" = bt."id";
INSERT INTO "audit_logs" ("tenant_id", "user_id", "action", "entity_type", "entity_id", "old_data", "new_data", "source")
SELECT j."tenant_id", o."user_id", 'update', 'bank_transaction', j."id"::text,
       jsonb_build_object('partnerId', NULL),
       jsonb_build_object('partnerId', j."partner_id", 'migration', 'justified_partner'),
       'migration'
  FROM jp_rows j JOIN jp_owner o ON o."tenant_id" = j."tenant_id";

-- ----------------------------------------------------------------------------
-- 4. the no-proof rules without a partner: the same map on their own code (the two defaults → the bank)
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE jp_rules ("id" UUID PRIMARY KEY, "tenant_id" UUID NOT NULL, "partner_id" UUID NOT NULL) ON COMMIT DROP;
INSERT INTO jp_rules
SELECT r."id", r."tenant_id", p."id"
  FROM "categorisation_rules" r
  LEFT JOIN "bank_accounts" a ON a."id" = r."bank_account_id"
  JOIN "partners" p ON p."tenant_id" = r."tenant_id" AND p."system_role" =
       CASE
           WHEN r."bas_code" IN ('657', '6570', '831', '8310') THEN 'bank'
           WHEN r."bas_code" IN ('251', '2510') THEN CASE WHEN a."currency" = 'CHF' THEN 'tax_agency_ch' ELSE 'tax_agency_se' END
           WHEN r."bas_code" IN ('721', '7210') THEN 'owner'
       END
 WHERE r."no_document_needed" AND r."partner_id" IS NULL;
UPDATE "categorisation_rules" r
   SET "partner_id" = j."partner_id", "updated_at" = now()
  FROM jp_rules j
 WHERE j."id" = r."id";
INSERT INTO "audit_logs" ("tenant_id", "user_id", "action", "entity_type", "entity_id", "old_data", "new_data", "source")
SELECT j."tenant_id", o."user_id", 'update', 'categorisation_rule', j."id"::text,
       jsonb_build_object('partnerId', NULL),
       jsonb_build_object('partnerId', j."partner_id", 'migration', 'justified_partner'),
       'migration'
  FROM jp_rules j JOIN jp_owner o ON o."tenant_id" = j."tenant_id";

-- ----------------------------------------------------------------------------
-- 5. the counts
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    by_rule     int;
    by_account  int;
    reopened    int;
    on_savings  int;
    rules_given int;
    rules_left  int;
BEGIN
    SELECT count(*) FILTER (WHERE "how" = 'rule'), count(*) FILTER (WHERE "how" = 'account') INTO by_rule, by_account FROM jp_rows;
    SELECT count(*) FILTER (WHERE a."role" <> 'savings'), count(*) FILTER (WHERE a."role" = 'savings')
      INTO reopened, on_savings
      FROM "bank_transactions" bt JOIN "bank_accounts" a ON a."id" = bt."bank_account_id"
     WHERE bt."no_document_needed" AND bt."partner_id" IS NULL;
    SELECT count(*) INTO rules_given FROM jp_rules;
    SELECT count(*) INTO rules_left FROM "categorisation_rules" WHERE "is_active" AND "no_document_needed" AND "partner_id" IS NULL;
    RAISE NOTICE 'justified_partner: % row(s) backfilled — % by their rule, % by their account; % row(s) re-open as *no proof · no partner* (% more on a savings account need none)',
        by_rule + by_account, by_rule, by_account, reopened, on_savings;
    RAISE NOTICE 'justified_partner: % rule(s) given a partner; % active no-proof rule(s) left for *Needs a look*', rules_given, rules_left;
END $$;
