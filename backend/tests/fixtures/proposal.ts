/**
 * Realistic Claude tool-use output for the sample invoice. Used to stub the
 * JournalGenerator in route tests so they don't make real API calls.
 *
 * Amounts use the Swedish supplier-invoice pattern: debit expense + debit 2640
 * VAT, credit 2440 supplier payable.
 */
import type { JournalProposal } from '../../src/lib/anthropic.ts';

const HEADER = {
  supplierName: 'Acme Consulting AB',
  supplierVatNumber: 'SE556677889901',
  invoiceNumber: 'INV-2025-0042',
  invoiceDate: '2025-05-01',
  dueDate: '2025-05-31',
  currency: 'SEK',
  netAmount: '10000.00',
  vatAmount: '2500.00',
  grossAmount: '12500.00',
  reasoning:
    'IT consulting line booked to 6530 IT-tjänster (best match). 25% VAT split to 2640 Ingående moms. Gross total credited to 2440 Leverantörsskulder.',
} as const;

export const balancedProposal: JournalProposal = {
  ...HEADER,
  postings: [
    {
      accountNumber: '6530',
      accountName: 'IT-tjänster',
      debit: '10000.00',
      credit: '0',
      description: 'IT consulting — 10h',
    },
    {
      accountNumber: '2640',
      accountName: 'Ingående moms',
      debit: '2500.00',
      credit: '0',
      description: 'VAT 25%',
    },
    {
      accountNumber: '2440',
      accountName: 'Leverantörsskulder',
      debit: '0',
      credit: '12500.00',
      description: 'Supplier payable',
    },
  ],
};

export const unbalancedProposal: JournalProposal = {
  ...HEADER,
  postings: [
    {
      accountNumber: '6530',
      accountName: 'IT-tjänster',
      debit: '10000.00',
      credit: '0',
      description: 'IT consulting — 10h',
    },
    {
      accountNumber: '2640',
      accountName: 'Ingående moms',
      debit: '2500.00',
      credit: '0',
      description: 'VAT 25%',
    },
    {
      accountNumber: '2440',
      accountName: 'Leverantörsskulder',
      debit: '0',
      credit: '99.99', // off by 12,400.01
      description: 'Supplier payable (intentionally unbalanced)',
    },
  ],
};

export const unknownAccountProposal: JournalProposal = {
  ...HEADER,
  postings: [
    {
      accountNumber: '9999', // not in BAS chart
      accountName: 'Mystery account',
      debit: '10000.00',
      credit: '0',
      description: 'Unknown',
    },
    {
      accountNumber: '2640',
      accountName: 'Ingående moms',
      debit: '2500.00',
      credit: '0',
      description: 'VAT 25%',
    },
    {
      accountNumber: '2440',
      accountName: 'Leverantörsskulder',
      debit: '0',
      credit: '12500.00',
      description: 'Supplier payable',
    },
  ],
};
