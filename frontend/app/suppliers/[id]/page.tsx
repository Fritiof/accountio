import { getSupplier } from '@/lib/api';
import { formatDate } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function SupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getSupplier(id);
  if (!data) notFound();

  const { supplier, billCount } = data;

  return (
    <div className="space-y-4">
      <Link
        href="/"
        className="text-sm text-(--color-muted-foreground) hover:text-(--color-foreground)"
      >
        ← Back to bills
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">{supplier.name}</h1>
        <p className="text-sm text-(--color-muted-foreground)">
          {billCount} {billCount === 1 ? 'invoice' : 'invoices'} on file · added{' '}
          {formatDate(supplier.createdAt)}
        </p>
      </div>

      <div className="rounded-lg border p-4 max-w-md">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-(--color-muted-foreground)">Org. no.</dt>
          <dd className="text-right font-mono">{supplier.orgNumber ?? '—'}</dd>
          <dt className="text-(--color-muted-foreground)">VAT no.</dt>
          <dd className="text-right font-mono">{supplier.vatNumber ?? '—'}</dd>
        </dl>
      </div>

      <p className="text-xs text-(--color-muted-foreground)">
        Edit/delete suppliers and a full invoice history per supplier are out of scope for v1.
      </p>
    </div>
  );
}
