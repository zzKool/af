-- D27 (open question B12): "what a document became" is a link, not a field on the document.
-- kind 'created_from': expense / supplier_invoice (from) → document (to). A document becomes at most one
-- entity and an entity is created from at most one document — both enforced here, independent of the service.

ALTER TABLE "links" DROP CONSTRAINT "links_kind_check";
ALTER TABLE "links" ADD CONSTRAINT "links_kind_check"
    CHECK ("kind" IN ('justifies', 'transfer', 'settles', 'belongs_to', 'created_from'));

CREATE UNIQUE INDEX "links_created_from_origin_key"
    ON "links"("tenant_id", "to_type", "to_id") WHERE "kind" = 'created_from';
CREATE UNIQUE INDEX "links_created_from_entity_key"
    ON "links"("tenant_id", "from_type", "from_id") WHERE "kind" = 'created_from';
