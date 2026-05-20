'use client';

import { Button } from '@/components/ui/button';
import { Check, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ApproveRejectActions({ billId }: { billId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/bills/${billId}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button onClick={() => submit('approve')} disabled={busy !== null} className="flex-1">
          {busy === 'approve' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Approve
        </Button>
        <Button
          onClick={() => submit('reject')}
          disabled={busy !== null}
          variant="destructive"
          className="flex-1"
        >
          {busy === 'reject' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <X className="size-4" />
          )}
          Reject
        </Button>
      </div>
      {error && <p className="text-xs text-(--color-destructive)">{error}</p>}
    </div>
  );
}
