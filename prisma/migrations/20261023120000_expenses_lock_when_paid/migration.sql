-- F62 (lessons audit 14, D37): the database locks an expense's money facts on the same two facts as the
-- service's `isOpen` — a settlement line (any status) OR a `justifies` link onto the expense (its payment;
-- only the expenses module's *attach* writes it, F58). Before, only a settlement line locked: a paid
-- company-card expense could be changed by any route but the service. *Attach* writes the money before the
-- link, *detach* removes the link before it restores the estimate, so both still pass. Forward-only: the
-- function is replaced, the trigger keeps its name.
CREATE OR REPLACE FUNCTION expenses_lock_when_settled() RETURNS trigger AS $$
BEGIN
    IF (NEW."amount" IS DISTINCT FROM OLD."amount"
        OR NEW."currency" IS DISTINCT FROM OLD."currency"
        OR NEW."date" IS DISTINCT FROM OLD."date"
        OR NEW."amount_base" IS DISTINCT FROM OLD."amount_base"
        OR NEW."rate" IS DISTINCT FROM OLD."rate"
        OR NEW."rate_source" IS DISTINCT FROM OLD."rate_source"
        OR NEW."rate_date" IS DISTINCT FROM OLD."rate_date"
        OR NEW."paid_amount" IS DISTINCT FROM OLD."paid_amount"
        OR NEW."paid_currency" IS DISTINCT FROM OLD."paid_currency"
        OR NEW."payment_source_id" IS DISTINCT FROM OLD."payment_source_id"
        OR NEW."group_id" IS DISTINCT FROM OLD."group_id"
        OR NEW."key" IS DISTINCT FROM OLD."key")
       AND (EXISTS (SELECT 1 FROM "settlement_lines" sl WHERE sl."expense_id" = OLD."id")
            OR EXISTS (SELECT 1 FROM "links" l
                       WHERE l."kind" = 'justifies' AND l."to_type" = 'expense' AND l."to_id" = OLD."id"))
    THEN
        RAISE EXCEPTION 'expense_locked' USING ERRCODE = 'P0001',
            DETAIL = format('expense %s is settled or paid: its money facts are written once', OLD."key");
    END IF;
    IF NEW."key" IS DISTINCT FROM OLD."key" OR NEW."seq" IS DISTINCT FROM OLD."seq" OR NEW."alias" IS DISTINCT FROM OLD."alias" THEN
        RAISE EXCEPTION 'expense_locked' USING ERRCODE = 'P0001',
            DETAIL = format('expense %s: the key is assigned once', OLD."key");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

