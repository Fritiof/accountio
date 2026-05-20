import type { JournalStatus } from '@/lib/types';

const styles: Record<JournalStatus | 'unknown', { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className: 'bg-(--color-warning)/15 text-(--color-warning) ring-1 ring-(--color-warning)/30',
  },
  approved: {
    label: 'Approved',
    className: 'bg-(--color-success)/15 text-(--color-success) ring-1 ring-(--color-success)/30',
  },
  rejected: {
    label: 'Rejected',
    className:
      'bg-(--color-destructive)/15 text-(--color-destructive) ring-1 ring-(--color-destructive)/30',
  },
  unknown: {
    label: '—',
    className: 'bg-(--color-muted) text-(--color-muted-foreground) ring-1 ring-(--color-border)',
  },
};

export function StatusBadge({ status }: { status: JournalStatus | null }) {
  const s = styles[status ?? 'unknown'];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}
