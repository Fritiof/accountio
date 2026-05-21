/**
 * Bills routes. Two-stage upload:
 *
 *   POST   /api/bills/prepare        — multipart upload, runs Claude, finds a supplier match, returns a draftId
 *   POST   /api/bills/confirm        — user picks supplier; bill + entry + postings persisted; draft deleted
 *   DELETE /api/bills/drafts/:id     — abandon a draft (deletes PDF + row)
 *   GET    /api/bills/drafts/:id/pdf — preview PDF for the confirm page
 *
 *   GET    /api/bills                — list confirmed bills
 *   GET    /api/bills/:id            — full detail (bill + entry + postings)
 *   GET    /api/bills/:id/pdf        — stream PDF
 *   POST   /api/bills/:id/approve    — flip status (idempotent)
 *   POST   /api/bills/:id/reject     — flip status (idempotent)
 *
 * The route factory accepts a DB + JournalGenerator so tests can stub the
 * Anthropic call without mocking modules.
 */
import { unlink } from 'node:fs/promises';
import { desc, eq, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { DB } from '../db/client.ts';
import { billDrafts, bills, journalEntries, postings, suppliers } from '../db/schema.ts';
import { loadChart } from '../lib/accounts.ts';
import type { JournalGenerator, JournalProposal } from '../lib/anthropic.ts';
import { JournalValidationError, assertAccountsValid, assertBalanced } from '../lib/journal.ts';
import { resolveStoragePath, storePdf } from '../lib/storage.ts';
import {
  findSupplierMatch,
  normalizeName,
  normalizeOrgNumber,
  normalizeVatNumber,
} from '../lib/suppliers.ts';

export type BillsRouteDeps = {
  db: DB;
  generateJournal: JournalGenerator;
};

const DRAFT_TTL_MS = 60 * 60 * 1000; // 1 hour

const confirmBodySchema = z.object({
  draftId: z.string().uuid(),
  supplier: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('existing'), id: z.string().uuid() }),
    z.object({
      kind: z.literal('create'),
      name: z.string().min(1),
      orgNumber: z.string().nullable().optional(),
      vatNumber: z.string().nullable().optional(),
    }),
  ]),
});

export function createBillsRoute(deps: BillsRouteDeps): Hono {
  const route = new Hono();
  const { db, generateJournal } = deps;

  // ----- LIST + DETAIL -----------------------------------------------------

  route.get('/', async (c) => {
    const rows = await db
      .select({
        id: bills.id,
        originalName: bills.originalName,
        supplierName: bills.supplierName,
        supplierId: bills.supplierId,
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

  route.get('/:id', async (c) => {
    const detail = await loadDetail(db, c.req.param('id'));
    if (!detail) throw new HTTPException(404, { message: 'Bill not found.' });
    return c.json(detail);
  });

  route.get('/:id/pdf', async (c) => {
    const id = c.req.param('id');
    const [row] = await db.select().from(bills).where(eq(bills.id, id)).limit(1);
    if (!row) throw new HTTPException(404, { message: 'Bill not found.' });
    return streamPdf(row.storagePath, row.mimeType, row.originalName);
  });

  // ----- APPROVE / REJECT --------------------------------------------------

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

  // ----- PREPARE (stage 1) -------------------------------------------------

  route.post('/prepare', async (c) => {
    // Sweep expired drafts before doing anything else.
    await sweepExpiredDrafts(db);

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

    const chart = await loadChart(db);

    let proposal: JournalProposal;
    try {
      proposal = await generateJournal({ pdf: bytes, filename: file.name, chart });
    } catch (err) {
      // Clean up the orphaned PDF we just wrote — there's no draft row pointing at it.
      await unlink(resolveStoragePath(stored.storagePath)).catch(() => {});
      throw new HTTPException(502, {
        message: `Journal generation failed: ${(err as Error).message}`,
      });
    }

    const match = await findSupplierMatch(db, {
      orgNumber: proposal.supplierOrgNumber,
      vatNumber: proposal.supplierVatNumber,
      name: proposal.supplierName,
    });

    const [draft] = await db
      .insert(billDrafts)
      .values({
        storagePath: stored.storagePath,
        originalName: file.name,
        mimeType: 'application/pdf',
        sizeBytes: stored.sizeBytes,
        proposalJson: proposal,
        matchSupplierId: match.kind === 'exact' ? match.supplier.id : null,
        matchMethod: match.kind === 'exact' ? match.matchedBy : null,
        expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
      })
      .returning();
    if (!draft) throw new Error('Failed to insert draft');

    return c.json(
      {
        draftId: draft.id,
        proposal,
        match,
      },
      201,
    );
  });

  // ----- CONFIRM (stage 2) -------------------------------------------------

  route.post('/confirm', async (c) => {
    const parsed = confirmBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new HTTPException(400, { message: `Invalid body: ${parsed.error.message}` });
    }
    const body = parsed.data;

    const [draft] = await db
      .select()
      .from(billDrafts)
      .where(eq(billDrafts.id, body.draftId))
      .limit(1);
    if (!draft) throw new HTTPException(404, { message: 'Draft not found.' });
    if (draft.expiresAt.getTime() < Date.now()) {
      // Clean up and tell the caller to re-upload.
      await deleteDraftAndPdf(db, draft.id, draft.storagePath);
      throw new HTTPException(410, { message: 'Draft has expired; re-upload required.' });
    }

    const proposal = draft.proposalJson as JournalProposal;

    // Resolve or create the supplier.
    const supplierId = await resolveSupplier(db, body.supplier);

    // Re-run validators authoritatively at confirm time.
    const validationIssues: string[] = [];
    const chart = await loadChart(db);
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
          originalName: draft.originalName,
          storagePath: draft.storagePath,
          mimeType: draft.mimeType,
          sizeBytes: draft.sizeBytes,
          supplierId,
          supplierName: proposal.supplierName,
          supplierOrgNumber: proposal.supplierOrgNumber,
          supplierVatNumber: proposal.supplierVatNumber,
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

      // PDF stays at the same storage_path; only delete the draft row.
      await tx.delete(billDrafts).where(eq(billDrafts.id, draft.id));

      return { bill: insertedBill, journalEntry: insertedEntry, postings: postingRows };
    });

    return c.json(detail, 201);
  });

  // ----- DRAFT MANAGEMENT --------------------------------------------------

  route.delete('/drafts/:id', async (c) => {
    const id = c.req.param('id');
    const [draft] = await db.select().from(billDrafts).where(eq(billDrafts.id, id)).limit(1);
    if (!draft) throw new HTTPException(404, { message: 'Draft not found.' });
    await deleteDraftAndPdf(db, id, draft.storagePath);
    return c.body(null, 204);
  });

  route.get('/drafts/:id/pdf', async (c) => {
    const id = c.req.param('id');
    const [draft] = await db.select().from(billDrafts).where(eq(billDrafts.id, id)).limit(1);
    if (!draft) throw new HTTPException(404, { message: 'Draft not found.' });
    return streamPdf(draft.storagePath, draft.mimeType, draft.originalName);
  });

  // GET /api/bills/drafts/:id — JSON for the confirm page (server component fetches this).
  route.get('/drafts/:id', async (c) => {
    const id = c.req.param('id');
    const [draft] = await db.select().from(billDrafts).where(eq(billDrafts.id, id)).limit(1);
    if (!draft) throw new HTTPException(404, { message: 'Draft not found.' });
    if (draft.expiresAt.getTime() < Date.now()) {
      await deleteDraftAndPdf(db, draft.id, draft.storagePath);
      throw new HTTPException(410, { message: 'Draft has expired; re-upload required.' });
    }

    // Re-run the match in case suppliers have changed since prepare.
    const proposal = draft.proposalJson as JournalProposal;
    const match = await findSupplierMatch(db, {
      orgNumber: proposal.supplierOrgNumber,
      vatNumber: proposal.supplierVatNumber,
      name: proposal.supplierName,
    });

    return c.json({
      draftId: draft.id,
      originalName: draft.originalName,
      proposal,
      match,
    });
  });

  return route;
}

// ----- helpers ------------------------------------------------------------

async function streamPdf(storagePath: string, mimeType: string, originalName: string) {
  const file = Bun.file(resolveStoragePath(storagePath));
  if (!(await file.exists())) {
    throw new HTTPException(410, { message: 'PDF no longer available.' });
  }
  return new Response(file.stream(), {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(originalName)}"`,
    },
  });
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

async function deleteDraftAndPdf(db: DB, draftId: string, storagePath: string) {
  await db.delete(billDrafts).where(eq(billDrafts.id, draftId));
  await unlink(resolveStoragePath(storagePath)).catch(() => {});
}

async function sweepExpiredDrafts(db: DB) {
  const expired = await db
    .select({ id: billDrafts.id, storagePath: billDrafts.storagePath })
    .from(billDrafts)
    .where(lt(billDrafts.expiresAt, new Date()));
  for (const row of expired) {
    await deleteDraftAndPdf(db, row.id, row.storagePath);
  }
}

/**
 * Resolve the user's supplier choice to a concrete supplier id.
 * - `existing`: verify supplier exists, return id
 * - `create`: insert (with org/VAT normalization). If the unique index fires
 *   (another request just created the same identifier), re-query and use that.
 */
async function resolveSupplier(
  db: DB,
  choice: z.infer<typeof confirmBodySchema>['supplier'],
): Promise<string> {
  if (choice.kind === 'existing') {
    const [row] = await db.select().from(suppliers).where(eq(suppliers.id, choice.id)).limit(1);
    if (!row) throw new HTTPException(404, { message: 'Selected supplier not found.' });
    return row.id;
  }

  const orgNumber = normalizeOrgNumber(choice.orgNumber);
  const vatNumber = normalizeVatNumber(choice.vatNumber);
  const name = normalizeName(choice.name);
  if (!name) {
    throw new HTTPException(400, { message: 'Supplier name is required.' });
  }

  try {
    const [created] = await db.insert(suppliers).values({ name, orgNumber, vatNumber }).returning();
    if (!created) throw new Error('Failed to insert supplier');
    return created.id;
  } catch (err) {
    // Unique violation — race with another request. Look up by whichever
    // identifier we have and use the existing row.
    const match = await findSupplierMatch(db, { orgNumber, vatNumber, name });
    if (match.kind === 'exact') return match.supplier.id;
    throw err;
  }
}
