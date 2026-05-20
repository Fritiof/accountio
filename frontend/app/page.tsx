import { StatusBadge } from '@/components/status-badge';
import { UploadButton } from '@/components/upload-button';
import { listBills } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import Link from 'next/link';

export default async function Home() {
  const bills = await listBills();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Bills</h1>
          <p className="text-sm text-(--color-muted-foreground)">
            Upload an invoice PDF — Claude proposes a balanced journal entry against the BAS chart.
          </p>
        </div>
        <UploadButton />
      </div>

      {bills.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-(--color-muted-foreground)">
          No bills yet. Click <span className="font-medium">Upload invoice</span> to get started.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-(--color-muted) text-left text-(--color-muted-foreground)">
              <tr>
                <th className="px-4 py-2 font-medium">Supplier</th>
                <th className="px-4 py-2 font-medium">Invoice no.</th>
                <th className="px-4 py-2 font-medium">Invoice date</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} className="border-t hover:bg-(--color-muted)/40">
                  <td className="px-4 py-3">{b.supplierName ?? b.originalName}</td>
                  <td className="px-4 py-3 text-(--color-muted-foreground)">
                    {b.invoiceNumber ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-(--color-muted-foreground)">
                    {formatDate(b.invoiceDate)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMoney(b.grossAmount, b.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/bills/${b.id}`}
                      className="text-(--color-primary) underline-offset-4 hover:underline"
                    >
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
