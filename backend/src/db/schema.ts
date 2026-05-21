import { sql } from 'drizzle-orm';
import {
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const journalStatusEnum = pgEnum('journal_status', ['pending', 'approved', 'rejected']);

export const accounts = pgTable('accounts', {
  number: text('number').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    orgNumber: text('org_number'),
    vatNumber: text('vat_number'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Partial unique indexes: only enforce uniqueness when the identifier is present.
    // Values are stored in canonical form (VAT uppercase, org trimmed) — see lib/suppliers.ts.
    orgUnique: uniqueIndex('suppliers_org_unique')
      .on(t.orgNumber)
      .where(sql`${t.orgNumber} IS NOT NULL`),
    vatUnique: uniqueIndex('suppliers_vat_unique')
      .on(t.vatNumber)
      .where(sql`${t.vatNumber} IS NOT NULL`),
  }),
);

export const bills = pgTable('bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  originalName: text('original_name').notNull(),
  storagePath: text('storage_path').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),

  // Confirmed link to a supplier. Nullable in this commit so the existing
  // POST /api/bills route keeps compiling; tightened to NOT NULL in the
  // commit that introduces the prepare/confirm flow.
  supplierId: uuid('supplier_id').references(() => suppliers.id),

  // Snapshots of what was on the invoice at upload time — preserved even if the
  // supplier record is later renamed/updated. The supplierId is the source of truth.
  supplierName: text('supplier_name'),
  supplierOrgNumber: text('supplier_org_number'),
  supplierVatNumber: text('supplier_vat_number'),

  invoiceNumber: text('invoice_number'),
  invoiceDate: date('invoice_date'),
  dueDate: date('due_date'),
  currency: text('currency').notNull().default('SEK'),

  netAmount: numeric('net_amount', { precision: 14, scale: 2 }),
  vatAmount: numeric('vat_amount', { precision: 14, scale: 2 }),
  grossAmount: numeric('gross_amount', { precision: 14, scale: 2 }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'cascade' }),
    status: journalStatusEnum('status').notNull().default('pending'),
    entryDate: date('entry_date'),
    description: text('description'),
    llmReasoning: text('llm_reasoning'),
    validationErrors: text('validation_errors'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    billIdUnique: uniqueIndex('journal_entries_bill_id_unique').on(t.billId),
  }),
);

export const postings = pgTable('postings', {
  id: uuid('id').primaryKey().defaultRandom(),
  journalEntryId: uuid('journal_entry_id')
    .notNull()
    .references(() => journalEntries.id, { onDelete: 'cascade' }),
  accountNumber: text('account_number').notNull(),
  accountName: text('account_name').notNull(),
  debit: numeric('debit', { precision: 14, scale: 2 }).notNull().default(sql`0`),
  credit: numeric('credit', { precision: 14, scale: 2 }).notNull().default(sql`0`),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
});

/**
 * Short-lived row holding a PDF + LLM proposal + best-match candidate, between
 * the prepare and confirm stages of upload. Swept on each /prepare call
 * (DELETE WHERE expires_at < now()) — typical TTL is 1 hour.
 */
export const billDrafts = pgTable('bill_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  storagePath: text('storage_path').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  proposalJson: jsonb('proposal_json').notNull(),
  matchSupplierId: uuid('match_supplier_id').references(() => suppliers.id, {
    onDelete: 'set null',
  }),
  matchMethod: text('match_method'), // 'org_number' | 'vat_number' | 'name' | null
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Supplier = typeof suppliers.$inferSelect;
export type NewSupplier = typeof suppliers.$inferInsert;
export type Bill = typeof bills.$inferSelect;
export type NewBill = typeof bills.$inferInsert;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type NewJournalEntry = typeof journalEntries.$inferInsert;
export type Posting = typeof postings.$inferSelect;
export type NewPosting = typeof postings.$inferInsert;
export type JournalStatus = (typeof journalStatusEnum.enumValues)[number];
export type BillDraft = typeof billDrafts.$inferSelect;
export type NewBillDraft = typeof billDrafts.$inferInsert;
