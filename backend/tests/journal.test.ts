import { describe, expect, test } from 'bun:test';
import { BAS_CHART } from '../src/lib/accounts.ts';
import {
  JournalValidationError,
  assertAccountsValid,
  assertBalanced,
  formatCents,
  toCents,
} from '../src/lib/journal.ts';

describe('toCents', () => {
  test('parses decimal strings to integer cents', () => {
    expect(toCents('0')).toBe(0);
    expect(toCents('1')).toBe(100);
    expect(toCents('1.5')).toBe(150);
    expect(toCents('1.50')).toBe(150);
    expect(toCents('123.45')).toBe(12345);
    expect(toCents('0.01')).toBe(1);
    expect(toCents('1000000.00')).toBe(100000000);
  });

  test('handles trailing zeros and missing decimals', () => {
    expect(toCents('1.5')).toBe(toCents('1.50'));
    expect(toCents('1')).toBe(toCents('1.00'));
  });

  test('parses numeric inputs by rounding', () => {
    expect(toCents(1)).toBe(100);
    expect(toCents(1.5)).toBe(150);
    expect(toCents(0.01)).toBe(1);
    // Float-drift trap: 0.1 + 0.2 = 0.30000000000000004 — still rounds to 30 cents
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  test('rejects malformed strings', () => {
    expect(() => toCents('abc')).toThrow(/Invalid amount/);
    expect(() => toCents('1.2.3')).toThrow(/Invalid amount/);
    expect(() => toCents('')).toThrow(/Invalid amount/);
  });

  test('rejects non-finite numbers', () => {
    expect(() => toCents(Number.NaN)).toThrow(/Invalid amount/);
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow(/Invalid amount/);
  });
});

describe('formatCents', () => {
  test('round-trips through toCents for representative values', () => {
    const cases = ['0.00', '1.00', '1.50', '123.45', '0.01', '1000000.00'];
    for (const c of cases) {
      expect(formatCents(toCents(c))).toBe(c);
    }
  });

  test('formats negative cents with leading minus', () => {
    expect(formatCents(-150)).toBe('-1.50');
  });
});

describe('assertBalanced', () => {
  test('passes for the canonical Swedish supplier invoice pattern', () => {
    // 10,000 SEK net rent + 2,500 SEK VAT = 12,500 SEK gross
    const postings = [
      { accountNumber: '5010', debit: '10000.00', credit: '0' },
      { accountNumber: '2640', debit: '2500.00', credit: '0' },
      { accountNumber: '2440', debit: '0', credit: '12500.00' },
    ];
    expect(() => assertBalanced(postings)).not.toThrow();
  });

  test('passes when debits === credits to the cent', () => {
    expect(() =>
      assertBalanced([
        { accountNumber: '5010', debit: '0.01', credit: '0' },
        { accountNumber: '2440', debit: '0', credit: '0.01' },
      ]),
    ).not.toThrow();
  });

  test('throws when off by a single cent', () => {
    expect(() =>
      assertBalanced([
        { accountNumber: '5010', debit: '100.00', credit: '0' },
        { accountNumber: '2440', debit: '0', credit: '99.99' },
      ]),
    ).toThrow(JournalValidationError);
  });

  test('throws on empty postings', () => {
    expect(() => assertBalanced([])).toThrow(/no postings/);
  });

  test('throws on a single posting (cannot balance non-trivially)', () => {
    expect(() => assertBalanced([{ accountNumber: '5010', debit: '100', credit: '0' }])).toThrow(
      /at least two postings/,
    );
  });

  test('throws on negative debit', () => {
    expect(() =>
      assertBalanced([
        { accountNumber: '5010', debit: '-100', credit: '0' },
        { accountNumber: '2440', debit: '0', credit: '-100' },
      ]),
    ).toThrow(/negative debit/);
  });

  test('does not let negatives cancel out the balance check', () => {
    // If a negative debit were accumulated into the running total, the balance
    // could spuriously appear correct (-500 + 500 = 0 = credits). Then the UI
    // would show "balanced ✓" alongside the "negative debit" warning. The
    // negative-sign issue must dominate.
    let error: JournalValidationError | null = null;
    try {
      assertBalanced([
        { accountNumber: '5010', debit: '-500', credit: '0' },
        { accountNumber: '5010', debit: '500', credit: '0' },
        { accountNumber: '2440', debit: '0', credit: '0' }, // would-be balancing zero credit
      ]);
    } catch (err) {
      if (err instanceof JournalValidationError) error = err;
      else throw err;
    }
    expect(error).not.toBeNull();
    if (error) {
      const text = error.issues.join(' ');
      expect(text).toMatch(/negative debit/);
      // Crucially, the balance check must also fail — the totals should NOT
      // come out equal because the invalid posting is skipped.
      expect(text).toMatch(/unbalanced/);
    }
  });

  test('throws on negative credit', () => {
    expect(() =>
      assertBalanced([
        { accountNumber: '5010', debit: '100', credit: '0' },
        { accountNumber: '2440', debit: '0', credit: '-100' },
      ]),
    ).toThrow(/negative credit/);
  });

  test('throws when a posting has both zero debit and zero credit', () => {
    expect(() =>
      assertBalanced([
        { accountNumber: '5010', debit: '100', credit: '0' },
        { accountNumber: '2440', debit: '0', credit: '100' },
        { accountNumber: '5010', debit: '0', credit: '0' },
      ]),
    ).toThrow(/both debit and credit are zero/);
  });

  test('survives the float-drift trap (0.1 + 0.2 vs 0.3)', () => {
    // Sum of 0.1 + 0.2 in raw JS is 0.30000000000000004.
    // With integer cents both sides come out to 30, so this must pass.
    expect(() =>
      assertBalanced([
        { accountNumber: '5010', debit: 0.1, credit: 0 },
        { accountNumber: '5010', debit: 0.2, credit: 0 },
        { accountNumber: '2440', debit: 0, credit: 0.3 },
      ]),
    ).not.toThrow();
  });

  test('aggregates multiple issues into one error', () => {
    try {
      assertBalanced([
        { accountNumber: '5010', debit: '-1', credit: '0' },
        { accountNumber: '2440', debit: '0', credit: '99' },
      ]);
      throw new Error('expected validation error');
    } catch (err) {
      expect(err).toBeInstanceOf(JournalValidationError);
      const e = err as JournalValidationError;
      expect(e.issues.length).toBeGreaterThanOrEqual(2);
      expect(e.issues.join(' ')).toMatch(/negative debit/);
      expect(e.issues.join(' ')).toMatch(/unbalanced/);
    }
  });
});

describe('assertAccountsValid', () => {
  test('passes when every posting references a BAS chart account', () => {
    expect(() =>
      assertAccountsValid(
        [
          { accountNumber: '5010', debit: '0', credit: '0' },
          { accountNumber: '2440', debit: '0', credit: '0' },
          { accountNumber: '2640', debit: '0', credit: '0' },
        ],
        BAS_CHART,
      ),
    ).not.toThrow();
  });

  test('throws when a posting references an unknown account', () => {
    expect(() =>
      assertAccountsValid(
        [
          { accountNumber: '5010', debit: '0', credit: '0' },
          { accountNumber: '9999', debit: '0', credit: '0' },
        ],
        BAS_CHART,
      ),
    ).toThrow(/account 9999 not in chart/);
  });

  test('defaults to the BAS chart when no chart argument is supplied', () => {
    expect(() => assertAccountsValid([{ accountNumber: '9999', debit: '0', credit: '0' }])).toThrow(
      /account 9999/,
    );
    expect(() =>
      assertAccountsValid([{ accountNumber: '5010', debit: '0', credit: '0' }]),
    ).not.toThrow();
  });

  test('lists all unknown accounts, not just the first', () => {
    try {
      assertAccountsValid(
        [
          { accountNumber: '0001', debit: '0', credit: '0' },
          { accountNumber: '5010', debit: '0', credit: '0' },
          { accountNumber: '0002', debit: '0', credit: '0' },
        ],
        BAS_CHART,
      );
      throw new Error('expected validation error');
    } catch (err) {
      expect(err).toBeInstanceOf(JournalValidationError);
      const e = err as JournalValidationError;
      expect(e.issues.length).toBe(2);
      expect(e.issues.join(' ')).toMatch(/0001/);
      expect(e.issues.join(' ')).toMatch(/0002/);
    }
  });
});
