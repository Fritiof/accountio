import { formatMoney } from '@/lib/format';
import type { Posting } from '@/lib/types';

export function JournalEntryTable({
  postings,
  currency,
}: {
  postings: Posting[];
  currency: string;
}) {
  const debitTotal = postings.reduce((s, p) => s + Number(p.debit), 0);
  const creditTotal = postings.reduce((s, p) => s + Number(p.credit), 0);
  const balanced = debitTotal.toFixed(2) === creditTotal.toFixed(2);

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-(--color-muted) text-left text-(--color-muted-foreground)">
          <tr>
            <th className="px-3 py-2 font-medium w-20">Account</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 text-right font-medium w-32">Debit</th>
            <th className="px-3 py-2 text-right font-medium w-32">Credit</th>
          </tr>
        </thead>
        <tbody>
          {postings.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="px-3 py-2 font-mono tabular-nums">{p.accountNumber}</td>
              <td className="px-3 py-2">
                <div>{p.accountName}</div>
                {p.description && (
                  <div className="text-xs text-(--color-muted-foreground)">{p.description}</div>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {Number(p.debit) > 0 ? formatMoney(p.debit, currency) : ''}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {Number(p.credit) > 0 ? formatMoney(p.credit, currency) : ''}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-(--color-muted)/60 font-medium">
            <td className="px-3 py-2" colSpan={2}>
              Totals {balanced ? '— balanced ✓' : '— UNBALANCED ⚠'}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatMoney(debitTotal.toFixed(2), currency)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatMoney(creditTotal.toFixed(2), currency)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
