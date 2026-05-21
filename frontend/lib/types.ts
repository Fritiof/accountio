/**
 * Shared API response types — kept in sync with backend/src/db/schema.ts
 * and backend/src/routes/bills.ts.
 */
export type JournalStatus = 'pending' | 'approved' | 'rejected';

export type Account = {
  number: string;
  name: string;
};

export type Bill = {
  id: string;
  originalName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  supplierName: string | null;
  supplierOrgNumber: string | null;
  supplierVatNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  netAmount: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  createdAt: string;
};

export type JournalEntry = {
  id: string;
  billId: string;
  status: JournalStatus;
  entryDate: string | null;
  description: string | null;
  llmReasoning: string | null;
  validationErrors: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type Posting = {
  id: string;
  journalEntryId: string;
  accountNumber: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string | null;
  sortOrder: number;
};

export type BillListItem = {
  id: string;
  originalName: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  grossAmount: string | null;
  currency: string;
  createdAt: string;
  status: JournalStatus | null;
};

export type BillDetail = {
  bill: Bill;
  journalEntry: JournalEntry | null;
  postings: Posting[];
};
