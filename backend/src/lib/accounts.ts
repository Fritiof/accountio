/**
 * Chart of accounts (Swedish BAS kontoplan), subset provided in the interview spec.
 *
 * The canonical source of truth is the `accounts` table — see the seed migration
 * at src/db/migrations/0001_productive_thunderbolt_ross.sql. The constant below
 * is kept as a parallel definition: it's used by pure tests that don't want a DB,
 * and as a documentation anchor for which accounts the seed migration installs.
 *
 * Special accounts used by the LLM prompt:
 * - 2440 Leverantörsskulder — credited at gross for supplier payables
 * - 2640 Ingående moms — debited at the VAT (moms) amount on supplier invoices
 */
import type { DBOrTx } from '../db/client.ts';
import { accounts } from '../db/schema.ts';

export type Account = {
  number: string;
  name: string;
};

export const BAS_CHART: readonly Account[] = [
  { number: '1930', name: 'Företagskonto' },
  { number: '2440', name: 'Leverantörsskulder' },
  { number: '2640', name: 'Ingående moms' },
  { number: '4010', name: 'Inköp material & varor' },
  { number: '5010', name: 'Lokalhyra' },
  { number: '5060', name: 'Driftskostnader lokal' },
  { number: '5220', name: 'Hyra inventarier' },
  { number: '5410', name: 'Förbrukningsinventarier' },
  { number: '5460', name: 'Förbrukningsmaterial' },
  { number: '5610', name: 'Kontorsmaterial' },
  { number: '5690', name: 'Övriga kontorskostnader' },
  { number: '6110', name: 'Kontorsförnödenheter' },
  { number: '6211', name: 'Fast telefoni' },
  { number: '6230', name: 'Datakommunikation' },
  { number: '6310', name: 'Företagsförsäkringar' },
  { number: '6530', name: 'IT-tjänster' },
  { number: '6540', name: 'IT-drift & hosting' },
  { number: '6570', name: 'Programvara, licenser' },
  { number: '6910', name: 'Licensavgifter & medlemskap' },
  { number: '7631', name: 'Personalmat & fika' },
] as const;

const BY_NUMBER = new Map<string, Account>(BAS_CHART.map((a) => [a.number, a]));

/**
 * Sync membership check against the BAS_CHART constant. Used by validators when
 * no explicit chart is passed (i.e. pure tests). Production routes always load
 * the live chart from the DB and pass it explicitly to assertAccountsValid.
 */
export function isValidAccount(number: string): boolean {
  return BY_NUMBER.has(number);
}

/** Read the live chart from the database (or transaction). */
export async function loadChart(db: DBOrTx): Promise<Account[]> {
  const rows = await db
    .select({ number: accounts.number, name: accounts.name })
    .from(accounts)
    .orderBy(accounts.number);
  return rows;
}
