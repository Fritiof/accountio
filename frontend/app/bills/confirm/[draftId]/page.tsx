import { ConfirmSupplierForm } from '@/components/confirm-supplier-form';
import { JournalEntryTable } from '@/components/journal-entry-table';
import { getDraft } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function ConfirmPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  const draft = await getDraft(draftId);
  if (!draft) notFound();

  const { proposal, match } = draft;
  const currency = proposal.currency;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="text-sm text-(--color-muted-foreground) hover:text-(--color-foreground)"
        >
          ← Back to bills
        </Link>
        <span className="text-xs text-(--color-muted-foreground)">
          Step 2 / 2 · Confirm supplier
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* PDF preview */}
        <div className="overflow-hidden rounded-lg border bg-(--color-muted)/30">
          <iframe
            src={`/api/bills/drafts/${draftId}/pdf`}
            title={draft.originalName}
            className="h-[80vh] w-full"
          />
        </div>

        {/* Confirmation column */}
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-semibold">Confirm supplier</h1>
            <p className="text-sm text-(--color-muted-foreground)">
              Tie this invoice to a supplier, then book the proposed journal entry.
            </p>
          </div>

          {/* What Claude parsed from the PDF */}
          <div className="rounded-lg border p-4">
            <div className="text-xs uppercase tracking-wide text-(--color-muted-foreground) mb-2">
              Detected from PDF
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div className="text-(--color-muted-foreground)">Supplier</div>
              <div className="text-right font-medium">{proposal.supplierName ?? '—'}</div>
              <div className="text-(--color-muted-foreground)">Org. no.</div>
              <div className="text-right font-mono">{proposal.supplierOrgNumber ?? '—'}</div>
              <div className="text-(--color-muted-foreground)">VAT no.</div>
              <div className="text-right font-mono">{proposal.supplierVatNumber ?? '—'}</div>
              <div className="text-(--color-muted-foreground)">Invoice no.</div>
              <div className="text-right font-mono">{proposal.invoiceNumber ?? '—'}</div>
              <div className="text-(--color-muted-foreground)">Invoice date</div>
              <div className="text-right">{formatDate(proposal.invoiceDate)}</div>
              <div className="text-(--color-muted-foreground)">Gross</div>
              <div className="text-right tabular-nums font-medium">
                {formatMoney(proposal.grossAmount, currency)}
              </div>
            </div>
          </div>

          {/* Supplier confirmation form */}
          <ConfirmSupplierForm draftId={draftId} proposal={proposal} match={match} />

          {/* Collapsible preview of the proposed journal entry */}
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              Preview proposed journal entry ({proposal.postings.length} postings)
            </summary>
            <div className="border-t p-3">
              <JournalEntryTable
                postings={proposal.postings.map((p, idx) => ({
                  id: `preview-${idx}`,
                  journalEntryId: 'preview',
                  accountNumber: p.accountNumber,
                  accountName: p.accountName,
                  debit: p.debit,
                  credit: p.credit,
                  description: p.description,
                  sortOrder: idx,
                }))}
                currency={currency}
              />
              {proposal.reasoning && (
                <p className="mt-2 text-xs text-(--color-muted-foreground)">
                  <span className="font-medium">Claude:</span> {proposal.reasoning}
                </p>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
