/**
 * Supplier matching + normalization.
 *
 * Matching priority (per the spec):
 *   1. exact org_number (Swedish 10-digit "556677-8899")
 *   2. exact vat_number (country-prefixed "SE556677889901")
 *   3. exact name (case-insensitive, trimmed)
 *   4. fall back to top-5 partial-name candidates
 *   5. nothing
 *
 * Identifier columns are stored in canonical form (VAT uppercase, org trimmed)
 * so equality matches don't need to lowercase at query time.
 */
import { eq, ilike, sql } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { type Supplier, suppliers } from '../db/schema.ts';

export type MatchInput = {
  orgNumber?: string | null;
  vatNumber?: string | null;
  name?: string | null;
};

export type MatchMethod = 'org_number' | 'vat_number' | 'name';

export type MatchResult =
  | { kind: 'exact'; supplier: Supplier; matchedBy: MatchMethod }
  | { kind: 'candidates'; candidates: Supplier[] }
  | { kind: 'none' };

/** Trim, return null for empty. Used at insert AND match time. */
export function normalizeOrgNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  return trimmed === '' ? null : trimmed;
}

/** Trim + uppercase the country prefix, return null for empty. */
export function normalizeVatNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  return trimmed === '' ? null : trimmed.toUpperCase();
}

/** Trim, collapse internal whitespace, return null for empty. */
export function normalizeName(input: string | null | undefined): string | null {
  if (!input) return null;
  const collapsed = input.trim().replace(/\s+/g, ' ');
  return collapsed === '' ? null : collapsed;
}

export async function findSupplierMatch(db: DB, input: MatchInput): Promise<MatchResult> {
  const org = normalizeOrgNumber(input.orgNumber);
  const vat = normalizeVatNumber(input.vatNumber);
  const name = normalizeName(input.name);

  // 1. exact org_number
  if (org) {
    const [hit] = await db.select().from(suppliers).where(eq(suppliers.orgNumber, org)).limit(1);
    if (hit) return { kind: 'exact', supplier: hit, matchedBy: 'org_number' };
  }

  // 2. exact vat_number
  if (vat) {
    const [hit] = await db.select().from(suppliers).where(eq(suppliers.vatNumber, vat)).limit(1);
    if (hit) return { kind: 'exact', supplier: hit, matchedBy: 'vat_number' };
  }

  // 3. exact name (case-insensitive). ILIKE without wildcards is case-insensitive equality.
  if (name) {
    const exact = await db
      .select()
      .from(suppliers)
      .where(ilike(suppliers.name, name))
      .orderBy(suppliers.name)
      .limit(2);
    if (exact.length === 1 && exact[0]) {
      return { kind: 'exact', supplier: exact[0], matchedBy: 'name' };
    }
    if (exact.length > 1) {
      // Multiple exact name matches — surface as candidates so the user disambiguates.
      return { kind: 'candidates', candidates: exact };
    }
  }

  // 4. partial-name candidates (top 5)
  if (name && name.length >= 2) {
    const candidates = await db
      .select()
      .from(suppliers)
      .where(ilike(suppliers.name, `%${name}%`))
      .orderBy(suppliers.name)
      .limit(5);
    if (candidates.length > 0) return { kind: 'candidates', candidates };
  }

  return { kind: 'none' };
}

/** Look up a supplier by id. */
export async function getSupplierById(db: DB, id: string): Promise<Supplier | null> {
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  return row ?? null;
}

/** List suppliers, newest first; optional case-insensitive substring search on name. */
export async function listSuppliers(db: DB, query?: string): Promise<Supplier[]> {
  const q = normalizeName(query);
  if (!q) {
    return db.select().from(suppliers).orderBy(sql`${suppliers.createdAt} DESC`);
  }
  return db
    .select()
    .from(suppliers)
    .where(ilike(suppliers.name, `%${q}%`))
    .orderBy(sql`${suppliers.createdAt} DESC`);
}
