import { ApproveRejectActions } from '@/components/approve-reject-actions';
import { JournalEntryTable } from '@/components/journal-entry-table';
import { StatusBadge } from '@/components/status-badge';
import { getBillDetail } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail: Awaited<ReturnType<typeof getBillDetail>>;
  try {
    detail = await getBillDetail(id);
  } catch {
    notFound();
  }
  const { bill, journalEntry, postings } = detail;
  const currency = bill.currency;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="text-sm text-(--color-muted-foreground) hover:text-(--color-foreground)"
        >
          ← Back to bills
        </Link>
        {journalEntry && <StatusBadge status={journalEntry.status} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* PDF column */}
        <div className="overflow-hidden rounded-lg border bg-(--color-muted)/30">
          <iframe
            src={`/api/bills/${bill.id}/pdf`}
            title={bill.originalName}
            className="h-[80vh] w-full"
          />
        </div>

        {/* Journal entry column */}
        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="text-(--color-muted-foreground)">Supplier</div>
              <div className="text-right font-medium">{bill.supplierName ?? '—'}</div>

              <div className="text-(--color-muted-foreground)">Invoice no.</div>
              <div className="text-right font-mono">{bill.invoiceNumber ?? '—'}</div>

              <div className="text-(--color-muted-foreground)">Invoice date</div>
              <div className="text-right">{formatDate(bill.invoiceDate)}</div>

              <div className="text-(--color-muted-foreground)">Due date</div>
              <div className="text-right">{formatDate(bill.dueDate)}</div>

              <div className="text-(--color-muted-foreground)">Net</div>
              <div className="text-right tabular-nums">{formatMoney(bill.netAmount, currency)}</div>

              <div className="text-(--color-muted-foreground)">VAT</div>
              <div className="text-right tabular-nums">{formatMoney(bill.vatAmount, currency)}</div>

              <div className="text-(--color-muted-foreground)">Gross</div>
              <div className="text-right tabular-nums font-medium">
                {formatMoney(bill.grossAmount, currency)}
              </div>
            </div>
          </div>

          {postings.length > 0 ? (
            <JournalEntryTable postings={postings} currency={currency} />
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-(--color-muted-foreground)">
              No journal entry yet.
            </div>
          )}

          {journalEntry?.validationErrors && (
            <div className="rounded-lg border border-(--color-destructive)/40 bg-(--color-destructive)/5 p-3 text-sm">
              <div className="font-medium text-(--color-destructive)">Validation issues</div>
              <p className="mt-1 text-(--color-destructive)/90">{journalEntry.validationErrors}</p>
            </div>
          )}

          {journalEntry?.llmReasoning && (
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">Claude's reasoning</summary>
              <p className="mt-2 text-(--color-muted-foreground)">{journalEntry.llmReasoning}</p>
            </details>
          )}

          {journalEntry && journalEntry.status === 'pending' && (
            <ApproveRejectActions billId={bill.id} />
          )}
          {journalEntry && journalEntry.status !== 'pending' && (
            <div className="rounded-lg border bg-(--color-muted)/40 p-3 text-sm">
              {journalEntry.status === 'approved' ? 'Approved' : 'Rejected'}
              {journalEntry.decidedAt && (
                <span className="text-(--color-muted-foreground)">
                  {' '}
                  on {formatDate(journalEntry.decidedAt)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
