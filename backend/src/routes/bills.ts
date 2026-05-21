/**
 * Bills routes. Accepts a DB and JournalGenerator via the factory so tests
 * can inject a stub generator (no module-level mocking of Anthropic).
 */
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { DB } from '../db/client.ts';
import { bills, journalEntries, postings } from '../db/schema.ts';
import { loadChart } from '../lib/accounts.ts';
import type { JournalGenerator, JournalProposal } from '../lib/anthropic.ts';
import { JournalValidationError, assertAccountsValid, assertBalanced } from '../lib/journal.ts';
import { readStoredFile, storePdf } from '../lib/storage.ts';

export type BillsRouteDeps = {
  db: DB;
  generateJournal: JournalGenerator;
};

export function createBillsRoute(deps: BillsRouteDeps): Hono {
  const route = new Hono();
  const { db, generateJournal } = deps;

  // GET /api/bills — list newest first, joined with journal status.
  route.get('/', async (c) => {
    const rows = await db
      .select({
        id: bills.id,
        originalName: bills.originalName,
        supplierName: bills.supplierName,
        invoiceNumber: bills.invoiceNumber,
        invoiceDate: bills.invoiceDate,
        grossAmount: bills.grossAmount,
        currency: bills.currency,
        createdAt: bills.createdAt,
        status: journalEntries.status,
      })
      .from(bills)
      .leftJoin(journalEntries, eq(journalEntries.billId, bills.id))
      .orderBy(desc(bills.createdAt));
    return c.json({ bills: rows });
  });

  // POST /api/bills — multipart upload, store, generate, validate, persist.
  route.post('/', async (c) => {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new HTTPException(400, { message: 'Expected multipart/form-data body.' });
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: 'Missing "file" field.' });
    }
    if (file.type && file.type !== 'application/pdf') {
      throw new HTTPException(415, {
        message: `Unsupported media type: ${file.type}. Expected application/pdf.`,
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const stored = await storePdf({ bytes, originalName: file.name });

    // Load the live chart from DB once per request — used both for the LLM
    // prompt and for post-generation validation.
    const chart = await loadChart(db);

    // Single LLM call — generate + parse + zod-validate.
    let proposal: JournalProposal;
    try {
      proposal = await generateJournal({ pdf: bytes, filename: file.name, chart });
    } catch (err) {
      throw new HTTPException(502, {
        message: `Journal generation failed: ${(err as Error).message}`,
      });
    }

    // Accounting invariants. If they fail, we still persist (with status='pending'
    // and validation_errors set) so the UI can surface the issue and the user can reject.
    const validationIssues: string[] = [];
    try {
      assertAccountsValid(proposal.postings, chart);
    } catch (err) {
      if (err instanceof JournalValidationError) validationIssues.push(...err.issues);
      else throw err;
    }
    try {
      assertBalanced(proposal.postings);
    } catch (err) {
      if (err instanceof JournalValidationError) validationIssues.push(...err.issues);
      else throw err;
    }

    const detail = await db.transaction(async (tx) => {
      const [insertedBill] = await tx
        .insert(bills)
        .values({
          originalName: file.name,
          storagePath: stored.storagePath,
          mimeType: 'application/pdf',
          sizeBytes: stored.sizeBytes,
          supplierName: proposal.supplierName,
          invoiceNumber: proposal.invoiceNumber,
          invoiceDate: proposal.invoiceDate,
          dueDate: proposal.dueDate,
          currency: proposal.currency,
          netAmount: proposal.netAmount,
          vatAmount: proposal.vatAmount,
          grossAmount: proposal.grossAmount,
        })
        .returning();
      if (!insertedBill) throw new Error('Failed to insert bill');

      const [insertedEntry] = await tx
        .insert(journalEntries)
        .values({
          billId: insertedBill.id,
          status: 'pending',
          entryDate: proposal.invoiceDate,
          description: `Supplier invoice ${proposal.invoiceNumber ?? ''}`.trim(),
          llmReasoning: proposal.reasoning,
          validationErrors: validationIssues.length > 0 ? validationIssues.join('; ') : null,
        })
        .returning();
      if (!insertedEntry) throw new Error('Failed to insert journal entry');

      const postingRows = await tx
        .insert(postings)
        .values(
          proposal.postings.map((p, idx) => ({
            journalEntryId: insertedEntry.id,
            accountNumber: p.accountNumber,
            accountName: p.accountName,
            debit: p.debit,
            credit: p.credit,
            description: p.description,
            sortOrder: idx,
          })),
        )
        .returning();

      return { bill: insertedBill, journalEntry: insertedEntry, postings: postingRows };
    });

    return c.json(detail, 201);
  });

  // GET /api/bills/:id — full detail.
  route.get('/:id', async (c) => {
    const id = c.req.param('id');
    const detail = await loadDetail(db, id);
    if (!detail) throw new HTTPException(404, { message: 'Bill not found.' });
    return c.json(detail);
  });

  // GET /api/bills/:id/pdf — stream the stored PDF.
  route.get('/:id/pdf', async (c) => {
    const id = c.req.param('id');
    const [row] = await db.select().from(bills).where(eq(bills.id, id)).limit(1);
    if (!row) throw new HTTPException(404, { message: 'Bill not found.' });
    const file = readStoredFile(row.storagePath);
    if (!(await file.exists())) {
      throw new HTTPException(410, { message: 'PDF no longer available.' });
    }
    return new Response(file.stream(), {
      headers: {
        'Content-Type': row.mimeType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(row.originalName)}"`,
      },
    });
  });

  // POST /api/bills/:id/approve and /reject — idempotent.
  const decide = async (id: string, status: 'approved' | 'rejected') => {
    const [entry] = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.billId, id))
      .limit(1);
    if (!entry) throw new HTTPException(404, { message: 'Bill not found.' });

    if (entry.status !== status) {
      await db
        .update(journalEntries)
        .set({ status, decidedAt: new Date() })
        .where(eq(journalEntries.id, entry.id));
    }

    const detail = await loadDetail(db, id);
    if (!detail) throw new HTTPException(404, { message: 'Bill not found.' });
    return detail;
  };

  route.post('/:id/approve', async (c) => c.json(await decide(c.req.param('id'), 'approved')));
  route.post('/:id/reject', async (c) => c.json(await decide(c.req.param('id'), 'rejected')));

  return route;
}

async function loadDetail(db: DB, billId: string) {
  const [bill] = await db.select().from(bills).where(eq(bills.id, billId)).limit(1);
  if (!bill) return null;
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.billId, billId))
    .limit(1);
  if (!entry) return { bill, journalEntry: null, postings: [] };
  const entryPostings = await db
    .select()
    .from(postings)
    .where(eq(postings.journalEntryId, entry.id))
    .orderBy(postings.sortOrder);
  return { bill, journalEntry: entry, postings: entryPostings };
}
