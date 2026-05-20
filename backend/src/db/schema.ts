import { sql } from 'drizzle-orm';
import {
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const journalStatusEnum = pgEnum('journal_status', ['pending', 'approved', 'rejected']);

export const bills = pgTable('bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  originalName: text('original_name').notNull(),
  storagePath: text('storage_path').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),

  supplierName: text('supplier_name'),
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

export type Bill = typeof bills.$inferSelect;
export type NewBill = typeof bills.$inferInsert;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type NewJournalEntry = typeof journalEntries.$inferInsert;
export type Posting = typeof postings.$inferSelect;
export type NewPosting = typeof postings.$inferInsert;
export type JournalStatus = (typeof journalStatusEnum.enumValues)[number];
