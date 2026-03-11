import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Admin pool — ecb_rates has no RLS, so we use admin for all operations.
const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL ||
  "postgresql://defterfab:test@localhost:5433/defterfab_test";

let adminPool: Pool;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});

beforeEach(async () => {
  await adminPool.query("TRUNCATE ecb_rates");
});

afterAll(async () => {
  await adminPool.query("TRUNCATE ecb_rates");
  await adminPool.end();
});

async function insertRate(date: string, currencyPair: string, rate: string): Promise<void> {
  await adminPool.query(`INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, $2, $3)`, [
    date,
    currencyPair,
    rate,
  ]);
}

describe("ecb_rates immutability", () => {
  it("UPDATE has no effect — rowCount 0 and original data unchanged", async () => {
    await insertRate("2026-03-10", "EUR/SEK", "11.234567");

    const result = await adminPool.query(
      `UPDATE ecb_rates SET rate = 99.999999 WHERE date = '2026-03-10' AND currency_pair = 'EUR/SEK'`,
    );
    expect(result.rowCount).toBe(0);

    // Verify original data intact
    const { rows } = await adminPool.query(
      `SELECT rate::text FROM ecb_rates WHERE date = '2026-03-10' AND currency_pair = 'EUR/SEK'`,
    );
    expect(rows[0].rate).toBe("11.234567");
  });

  it("DELETE has no effect — rowCount 0 and data still exists", async () => {
    await insertRate("2026-03-10", "USD/SEK", "10.567890");

    const result = await adminPool.query(
      `DELETE FROM ecb_rates WHERE date = '2026-03-10' AND currency_pair = 'USD/SEK'`,
    );
    expect(result.rowCount).toBe(0);

    // Verify data still exists
    const { rows } = await adminPool.query(
      `SELECT rate::text FROM ecb_rates WHERE date = '2026-03-10' AND currency_pair = 'USD/SEK'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rate).toBe("10.567890");
  });

  it("INSERT succeeds for new rate (happy path)", async () => {
    await insertRate("2026-03-11", "CHF/SEK", "12.345678");

    const { rows } = await adminPool.query(
      `SELECT date::text, currency_pair, rate::text, fetched_at FROM ecb_rates WHERE date = '2026-03-11' AND currency_pair = 'CHF/SEK'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-03-11");
    expect(rows[0].currency_pair).toBe("CHF/SEK");
    expect(rows[0].rate).toBe("12.345678");
    expect(rows[0].fetched_at).toBeInstanceOf(Date);
  });

  it("duplicate INSERT with same (date, currency_pair) throws unique constraint error", async () => {
    await insertRate("2026-03-10", "EUR/SEK", "11.234567");

    await expect(insertRate("2026-03-10", "EUR/SEK", "99.999999")).rejects.toThrow(
      /unique constraint|duplicate key/i,
    );
  });
});
