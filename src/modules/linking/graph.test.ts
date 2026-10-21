import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createAuthenticatedContext,
  createTestDocument,
  createTestPartner,
} from "@/kernel/db/test-fixtures";
import { documentLinkable } from "@/modules/documents";
import { _resetLinkables, type Linkable, registerLinkable } from "@/modules/linking";
import { partnerLinkable } from "@/modules/partners";
import { neighbourhood, nodeKey } from "./graph";
import { createLink } from "./linking";
import type { CreateLinkInput } from "./types";

const noopAudit: AuditLogger = { log: async () => {} };
let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL ||
  "postgresql://defterfab:test@localhost:5433/defterfab_test";
let adminPool: Pool;

/** A fake expense — stands in for the expenses module (created_from → document). */
const fakeExpenses = new Set<string>();
const fakeExpenseLinkable: Linkable = {
  type: "expense",
  async exists(_tx, id) {
    return fakeExpenses.has(id);
  },
  async summary(_tx, id) {
    return fakeExpenses.has(id)
      ? {
          type: "expense",
          id,
          label: `expense ${id.slice(0, 8)}`,
          amount: "120.00",
          currency: "SEK",
        }
      : null;
  },
};

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  resetRateLimit();
  mockHeaders = new Headers();
  _resetLinkables();
  for (const l of [partnerLinkable, documentLinkable, fakeExpenseLinkable]) registerLinkable(l);
  fakeExpenses.clear();
});

afterAll(async () => {
  await adminPool.end();
});

/**
 * The fixture: a partner with three documents (belongs_to), one of which an expense was created from.
 *   expense ─created_from→ doc1 ─belongs_to→ partner ←belongs_to─ doc2, doc3
 */
async function fixture() {
  const owner = await createAuthenticatedContext(auth, "owner");
  const { tenantId, userId } = owner.callerIdentity;
  const partner = await createTestPartner(adminPool, tenantId, userId);
  const [doc1, doc2, doc3] = await Promise.all([
    createTestDocument(adminPool, tenantId, userId, { fileName: "one.pdf" }),
    createTestDocument(adminPool, tenantId, userId, { fileName: "two.pdf" }),
    createTestDocument(adminPool, tenantId, userId, { fileName: "three.pdf" }),
  ]);
  const expenseId = crypto.randomUUID();
  fakeExpenses.add(expenseId);
  const links: CreateLinkInput[] = [
    {
      from: { type: "document", id: doc1.id },
      to: { type: "partner", id: partner.id },
      kind: "belongs_to",
    },
    {
      from: { type: "document", id: doc2.id },
      to: { type: "partner", id: partner.id },
      kind: "belongs_to",
    },
    {
      from: { type: "document", id: doc3.id },
      to: { type: "partner", id: partner.id },
      kind: "belongs_to",
    },
    {
      from: { type: "expense", id: expenseId },
      to: { type: "document", id: doc1.id },
      kind: "created_from",
    },
  ];
  await withTenantTransaction(prisma, tenantId, async (tx) => {
    for (const l of links) {
      const r = await createLink(tx, owner.callerIdentity, noopAudit, l);
      expect(r.error).toBeUndefined();
    }
  });
  return { tenantId, partner, doc1, doc2, doc3, expenseId };
}

describe("neighbourhood", () => {
  it("walks two hops from a document: its partner, then the partner's other documents and its own expense", async () => {
    const f = await fixture();
    const g = await withTenantTransaction(prisma, f.tenantId, (tx) =>
      neighbourhood(tx, { type: "document", id: f.doc1.id }),
    );
    expect(g).not.toBeNull();
    if (!g) return;
    expect(g.root).toBe(`document:${f.doc1.id}`);
    expect(g.nodes).toHaveLength(5);
    expect(g.edges).toHaveLength(4);
    expect(g.truncated).toBe(false);
    const byKey = new Map(g.nodes.map((n) => [n.key, n]));
    expect(byKey.get(g.root)).toMatchObject({ depth: 0, parent: null, label: f.doc1.businessKey });
    expect(byKey.get(nodeKey({ type: "partner", id: f.partner.id }))).toMatchObject({
      depth: 1,
      parent: g.root,
    });
    expect(byKey.get(nodeKey({ type: "expense", id: f.expenseId }))).toMatchObject({
      depth: 1,
      parent: g.root,
      amount: "120.00",
      currency: "SEK",
    });
    expect(byKey.get(nodeKey({ type: "document", id: f.doc2.id }))).toMatchObject({
      depth: 2,
      parent: nodeKey({ type: "partner", id: f.partner.id }),
      label: f.doc2.businessKey,
    });
    expect(byKey.get(nodeKey({ type: "document", id: f.doc3.id }))?.depth).toBe(2);
    // every edge names two nodes of the picture
    for (const e of g.edges) {
      expect(byKey.has(e.from)).toBe(true);
      expect(byKey.has(e.to)).toBe(true);
    }
    expect(g.edges.map((e) => e.kind).sort()).toEqual([
      "belongs_to",
      "belongs_to",
      "belongs_to",
      "created_from",
    ]);
  });

  it("stops at the depth and says so when more exists beyond the last ring", async () => {
    const f = await fixture();
    const g = await withTenantTransaction(prisma, f.tenantId, (tx) =>
      neighbourhood(tx, { type: "document", id: f.doc2.id }, { depth: 1 }),
    );
    // doc2 → partner; the partner's other documents are one hop further
    expect(g?.nodes.map((n) => n.depth)).toEqual([0, 1]);
    expect(g?.edges).toHaveLength(1);
    expect(g?.truncated).toBe(true);
    // depth 2 reaches doc1 and doc3; doc1's expense is a third hop away
    const g2 = await withTenantTransaction(prisma, f.tenantId, (tx) =>
      neighbourhood(tx, { type: "document", id: f.doc2.id }, { depth: 2 }),
    );
    expect(g2?.nodes).toHaveLength(4);
    expect(g2?.truncated).toBe(true);
    const g3 = await withTenantTransaction(prisma, f.tenantId, (tx) =>
      neighbourhood(tx, { type: "document", id: f.doc2.id }, { depth: 3 }),
    );
    expect(g3?.nodes).toHaveLength(5);
    expect(g3?.truncated).toBe(false);
  });

  it("caps the nodes, keeps only the edges it can draw and flags the cut", async () => {
    const f = await fixture();
    const g = await withTenantTransaction(prisma, f.tenantId, (tx) =>
      neighbourhood(tx, { type: "partner", id: f.partner.id }, { maxNodes: 3 }),
    );
    expect(g?.nodes).toHaveLength(3);
    expect(g?.edges).toHaveLength(2);
    expect(g?.truncated).toBe(true);
    expect(g?.nodes.every((n) => n.depth <= 1)).toBe(true);
  });

  it("is null for an entity that does not exist and a lone entity has only itself", async () => {
    const f = await fixture();
    const lone = await createTestDocument(
      adminPool,
      f.tenantId,
      (await adminPool.query("SELECT created_by FROM documents WHERE id = $1", [f.doc1.id])).rows[0]
        .created_by,
      { fileName: "lone.pdf" },
    );
    const [missing, single] = await withTenantTransaction(prisma, f.tenantId, (tx) =>
      Promise.all([
        neighbourhood(tx, { type: "document", id: crypto.randomUUID() }),
        neighbourhood(tx, { type: "document", id: lone.id }),
      ]),
    );
    expect(missing).toBeNull();
    expect(single).toMatchObject({
      nodes: [{ depth: 0, label: lone.businessKey }],
      edges: [],
      truncated: false,
    });
  });

  it("never crosses tenants — another tenant's links do not appear", async () => {
    const f = await fixture();
    const other = await createAuthenticatedContext(auth, "owner");
    const seen = await withTenantTransaction(prisma, other.callerIdentity.tenantId, (tx) =>
      neighbourhood(tx, { type: "partner", id: f.partner.id }),
    );
    expect(seen).toBeNull();
  });
});
