import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { db } from '../src/db/client.ts';
import { suppliers } from '../src/db/schema.ts';
import { env } from '../src/env.ts';
import {
  findSupplierMatch,
  normalizeName,
  normalizeOrgNumber,
  normalizeVatNumber,
} from '../src/lib/suppliers.ts';

describe('normalize helpers (pure)', () => {
  test('normalizeOrgNumber trims and rejects empties', () => {
    expect(normalizeOrgNumber('  556677-8899  ')).toBe('556677-8899');
    expect(normalizeOrgNumber('')).toBeNull();
    expect(normalizeOrgNumber('   ')).toBeNull();
    expect(normalizeOrgNumber(null)).toBeNull();
    expect(normalizeOrgNumber(undefined)).toBeNull();
  });

  test('normalizeVatNumber uppercases the country prefix', () => {
    expect(normalizeVatNumber('se556677889901')).toBe('SE556677889901');
    expect(normalizeVatNumber('SE556677889901')).toBe('SE556677889901');
    expect(normalizeVatNumber('  de123456789  ')).toBe('DE123456789');
    expect(normalizeVatNumber(null)).toBeNull();
    expect(normalizeVatNumber('')).toBeNull();
  });

  test('normalizeName collapses internal whitespace and trims', () => {
    expect(normalizeName('  Acme   Consulting   AB  ')).toBe('Acme Consulting AB');
    expect(normalizeName('Acme')).toBe('Acme');
    expect(normalizeName(null)).toBeNull();
    expect(normalizeName('')).toBeNull();
    expect(normalizeName('  ')).toBeNull();
  });
});

// DB-backed integration tests below.

const sql = postgres(env.DATABASE_URL, { max: 1 });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});

afterAll(async () => {
  await sql.end();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE postings, journal_entries, bills, bill_drafts, suppliers RESTART IDENTITY CASCADE`;
});

async function seed(rows: { name: string; orgNumber?: string; vatNumber?: string }[]) {
  return db
    .insert(suppliers)
    .values(rows.map((r) => ({ name: r.name, orgNumber: r.orgNumber, vatNumber: r.vatNumber })))
    .returning();
}

describe('findSupplierMatch', () => {
  test('matches by org_number first (highest priority)', async () => {
    const [a] = await seed([{ name: 'Acme AB', orgNumber: '556677-8899' }]);
    const result = await findSupplierMatch(db, {
      orgNumber: '556677-8899',
      vatNumber: 'SE000000000001', // mismatching but should be ignored
      name: 'Different Name',
    });
    expect(result.kind).toBe('exact');
    if (result.kind === 'exact') {
      expect(result.matchedBy).toBe('org_number');
      expect(result.supplier.id).toBe(a?.id ?? '');
    }
  });

  test('falls back to vat_number when org_number does not match', async () => {
    const [a] = await seed([
      { name: 'Acme AB', orgNumber: '111111-1111', vatNumber: 'SE556677889901' },
    ]);
    const result = await findSupplierMatch(db, {
      orgNumber: '999999-9999', // no match
      vatNumber: 'SE556677889901',
      name: 'Different',
    });
    expect(result.kind).toBe('exact');
    if (result.kind === 'exact') {
      expect(result.matchedBy).toBe('vat_number');
      expect(result.supplier.id).toBe(a?.id ?? '');
    }
  });

  test('falls back to exact name when no identifier matches', async () => {
    const [a] = await seed([{ name: 'Acme Consulting AB' }]);
    const result = await findSupplierMatch(db, {
      orgNumber: '999999-9999',
      vatNumber: 'SE000000000001',
      name: 'acme  consulting  ab', // case + whitespace variations
    });
    expect(result.kind).toBe('exact');
    if (result.kind === 'exact') {
      expect(result.matchedBy).toBe('name');
      expect(result.supplier.id).toBe(a?.id ?? '');
    }
  });

  test('VAT number match is case-insensitive on the country prefix', async () => {
    await seed([{ name: 'Acme AB', vatNumber: 'SE556677889901' }]);
    const result = await findSupplierMatch(db, { vatNumber: 'se556677889901' });
    expect(result.kind).toBe('exact');
    if (result.kind === 'exact') expect(result.matchedBy).toBe('vat_number');
  });

  test('multiple suppliers with the same name return as candidates', async () => {
    await seed([
      { name: 'Acme AB', orgNumber: '111111-1111' },
      { name: 'Acme AB', orgNumber: '222222-2222' },
    ]);
    const result = await findSupplierMatch(db, { name: 'Acme AB' });
    expect(result.kind).toBe('candidates');
    if (result.kind === 'candidates') {
      expect(result.candidates.length).toBe(2);
    }
  });

  test('partial name match returns candidates when no exact', async () => {
    await seed([
      { name: 'Acme Consulting AB' },
      { name: 'Acme Industries AB' },
      { name: 'Unrelated Co' },
    ]);
    const result = await findSupplierMatch(db, { name: 'Acme' });
    expect(result.kind).toBe('candidates');
    if (result.kind === 'candidates') {
      expect(result.candidates.length).toBe(2);
      expect(result.candidates.map((s) => s.name).sort()).toEqual([
        'Acme Consulting AB',
        'Acme Industries AB',
      ]);
    }
  });

  test('returns none when nothing matches', async () => {
    await seed([{ name: 'Acme AB', orgNumber: '111111-1111' }]);
    const result = await findSupplierMatch(db, {
      orgNumber: '999999-9999',
      vatNumber: 'SE999999999999',
      name: 'No Such Supplier',
    });
    expect(result.kind).toBe('none');
  });

  test('returns none when input is entirely empty', async () => {
    await seed([{ name: 'Acme AB' }]);
    const result = await findSupplierMatch(db, {});
    expect(result.kind).toBe('none');
  });

  test('org_number wins even when vat_number also matches a different supplier', async () => {
    const [a] = await seed([
      { name: 'Acme AB', orgNumber: '111111-1111' },
      { name: 'Other AB', vatNumber: 'SE556677889901' },
    ]);
    const result = await findSupplierMatch(db, {
      orgNumber: '111111-1111',
      vatNumber: 'SE556677889901',
    });
    expect(result.kind).toBe('exact');
    if (result.kind === 'exact') {
      expect(result.matchedBy).toBe('org_number');
      expect(result.supplier.id).toBe(a?.id ?? '');
    }
  });

  test('vat_number wins over name when org_number is absent on the input', async () => {
    const [a] = await seed([
      { name: 'Acme AB', vatNumber: 'SE556677889901' },
      { name: 'Different AB' },
    ]);
    const result = await findSupplierMatch(db, {
      vatNumber: 'SE556677889901',
      name: 'Different AB',
    });
    expect(result.kind).toBe('exact');
    if (result.kind === 'exact') {
      expect(result.matchedBy).toBe('vat_number');
      expect(result.supplier.id).toBe(a?.id ?? '');
    }
  });
});
