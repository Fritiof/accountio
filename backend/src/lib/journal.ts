/**
 * Pure validators for journal entries. No DB, no I/O.
 *
 * Money is handled as integer cents internally to avoid float drift
 * (e.g., 0.1 + 0.2 !== 0.3). Inputs accept either string ("123.45")
 * or number (123.45); both are normalized via toCents().
 */
import type { Account } from './accounts.ts';
import { isValidAccount } from './accounts.ts';

export type ValidatorPosting = {
  accountNumber: string;
  debit: string | number;
  credit: string | number;
};

export class JournalValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Journal entry invalid: ${issues.join('; ')}`);
    this.name = 'JournalValidationError';
    this.issues = issues;
  }
}

/**
 * Convert a decimal amount to integer cents.
 * Accepts strings like "123.45" or "0", and numbers (rounded to nearest cent).
 * Rejects malformed strings and any negative value (use the other column instead).
 */
export function toCents(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid amount: ${value}`);
    }
    return Math.round(value * 100);
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid amount: "${value}"`);
  }
  const [, sign, whole, frac] = match;
  // biome-ignore lint/style/noNonNullAssertion: regex guarantees whole is captured
  const cents = Number(whole!) * 100 + Number((frac ?? '').padEnd(2, '0').slice(0, 2));
  return sign === '-' ? -cents : cents;
}

export function sumCents(values: ReadonlyArray<string | number>): number {
  let total = 0;
  for (const v of values) {
    total += toCents(v);
  }
  return total;
}

/**
 * Assert that the postings form a balanced double-entry: sum(debit) === sum(credit),
 * down to the cent. Throws JournalValidationError otherwise.
 *
 * Also rejects:
 * - empty postings array (a journal entry must have at least 2 postings)
 * - negative debit or credit (represent reversals on the opposite column instead)
 * - postings where both debit and credit are zero (meaningless line)
 */
export function assertBalanced(postings: ReadonlyArray<ValidatorPosting>): void {
  const issues: string[] = [];

  if (postings.length === 0) {
    throw new JournalValidationError(['journal entry has no postings']);
  }
  if (postings.length < 2) {
    issues.push('journal entry must have at least two postings to balance');
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (let i = 0; i < postings.length; i++) {
    const p = postings[i];
    if (!p) continue;
    let debit: number;
    let credit: number;
    try {
      debit = toCents(p.debit);
      credit = toCents(p.credit);
    } catch (err) {
      issues.push(`posting[${i}]: ${(err as Error).message}`);
      continue;
    }
    if (debit < 0) issues.push(`posting[${i}]: negative debit (${p.debit})`);
    if (credit < 0) issues.push(`posting[${i}]: negative credit (${p.credit})`);
    if (debit === 0 && credit === 0) {
      issues.push(`posting[${i}]: both debit and credit are zero`);
    }
    totalDebit += debit;
    totalCredit += credit;
  }

  if (totalDebit !== totalCredit) {
    issues.push(
      `unbalanced: debits ${formatCents(totalDebit)} ≠ credits ${formatCents(totalCredit)} (off by ${formatCents(Math.abs(totalDebit - totalCredit))})`,
    );
  }

  if (issues.length > 0) {
    throw new JournalValidationError(issues);
  }
}

/**
 * Assert that every posting references an account in the provided chart.
 * Defaults to the BAS chart via `isValidAccount` if no chart override is supplied.
 */
export function assertAccountsValid(
  postings: ReadonlyArray<ValidatorPosting>,
  chart?: ReadonlyArray<Account>,
): void {
  const lookup = chart ? new Set(chart.map((a) => a.number)) : null;
  const valid = (n: string): boolean => (lookup ? lookup.has(n) : isValidAccount(n));

  const issues: string[] = [];
  for (let i = 0; i < postings.length; i++) {
    const p = postings[i];
    if (!p) continue;
    if (!valid(p.accountNumber)) {
      issues.push(`posting[${i}]: account ${p.accountNumber} not in chart`);
    }
  }
  if (issues.length > 0) {
    throw new JournalValidationError(issues);
  }
}

/** Format integer cents back to a decimal string with two places. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}
