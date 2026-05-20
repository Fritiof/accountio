'use client';

import { Button } from '@/components/ui/button';
import { Loader2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

export function UploadButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/bills', { method: 'POST', body: form });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(msg || `Upload failed (${res.status})`);
      }
      const detail = (await res.json()) as { bill: { id: string } };
      router.push(`/bills/${detail.bill.id}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />
      <Button onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Asking Claude…
          </>
        ) : (
          <>
            <Upload className="size-4" /> Upload invoice
          </>
        )}
      </Button>
      {error && <span className="text-xs text-(--color-destructive)">{error}</span>}
    </div>
  );
}
