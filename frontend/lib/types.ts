/**
 * Shared API response types — kept in sync with backend/src/db/schema.ts
 * and backend/src/routes/bills.ts.
 */
export type JournalStatus = 'pending' | 'approved' | 'rejected';

export type Account = {
  number: string;
  name: string;
};

export type Supplier = {
  id: string;
  name: string;
  orgNumber: string | null;
  vatNumber: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupplierMatch =
  | { kind: 'exact'; supplier: Supplier; matchedBy: 'org_number' | 'vat_number' | 'name' }
  | { kind: 'candidates'; candidates: Supplier[] }
  | { kind: 'none' };

export type JournalProposalPosting = {
  accountNumber: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
};

export type JournalProposal = {
  supplierName: string | null;
  supplierOrgNumber: string | null;
  supplierVatNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  postings: JournalProposalPosting[];
  reasoning: string;
};

export type PrepareResponse = {
  draftId: string;
  proposal: JournalProposal;
  match: SupplierMatch;
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
