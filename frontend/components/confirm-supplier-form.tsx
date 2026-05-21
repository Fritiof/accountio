'use client';

import { Button } from '@/components/ui/button';
import type { JournalProposal, Supplier, SupplierMatch } from '@/lib/types';
import { Check, Loader2, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Choice =
  | {
      kind: 'existing';
      supplier: Supplier;
      matchedBy?: SupplierMatch extends { kind: 'exact'; matchedBy: infer M } ? M : never;
    }
  | {
      kind: 'create';
      name: string;
      orgNumber: string;
      vatNumber: string;
    };

function fromProposal(proposal: JournalProposal): Choice {
  return {
    kind: 'create',
    name: proposal.supplierName ?? '',
    orgNumber: proposal.supplierOrgNumber ?? '',
    vatNumber: proposal.supplierVatNumber ?? '',
  };
}

export function ConfirmSupplierForm({
  draftId,
  proposal,
  match,
}: {
  draftId: string;
  proposal: JournalProposal;
  match: SupplierMatch;
}) {
  const router = useRouter();

  // Initial choice: if there's an exact match, default to using it. Otherwise
  // default to creating a new one with the PDF's data pre-filled.
  const initialChoice: Choice =
    match.kind === 'exact'
      ? { kind: 'existing', supplier: match.supplier }
      : fromProposal(proposal);

  const [choice, setChoice] = useState<Choice>(initialChoice);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const supplier =
        choice.kind === 'existing'
          ? { kind: 'existing' as const, id: choice.supplier.id }
          : {
              kind: 'create' as const,
              name: choice.name.trim(),
              orgNumber: choice.orgNumber.trim() || null,
              vatNumber: choice.vatNumber.trim() || null,
            };

      const res = await fetch('/api/bills/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftId, supplier }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(msg || `Confirm failed (${res.status})`);
      }
      const { bill } = (await res.json()) as { bill: { id: string } };
      router.push(`/bills/${bill.id}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      await fetch(`/api/bills/drafts/${draftId}`, { method: 'DELETE' });
    } catch {
      /* best-effort */
    }
    router.push('/');
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {match.kind === 'exact' && (
        <MatchBanner kind="exact" supplier={match.supplier} matchedBy={match.matchedBy} />
      )}
      {match.kind === 'candidates' && <MatchBanner kind="candidates" />}
      {match.kind === 'none' && <MatchBanner kind="none" />}

      {match.kind === 'exact' && (
        <div className="space-y-2">
          <label className="flex items-start gap-2 cursor-pointer rounded-lg border p-3 hover:bg-(--color-muted)/40">
            <input
              type="radio"
              name="supplier-choice"
              checked={choice.kind === 'existing' && choice.supplier.id === match.supplier.id}
              onChange={() => setChoice({ kind: 'existing', supplier: match.supplier })}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-medium">Use matched supplier</div>
              <div className="text-sm">{match.supplier.name}</div>
              <div className="text-xs text-(--color-muted-foreground) font-mono">
                {match.supplier.orgNumber ?? '—'} · {match.supplier.vatNumber ?? '—'}
              </div>
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer rounded-lg border p-3 hover:bg-(--color-muted)/40">
            <input
              type="radio"
              name="supplier-choice"
              checked={choice.kind === 'create'}
              onChange={() => setChoice(fromProposal(proposal))}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-medium">Create new supplier instead</div>
              <div className="text-sm text-(--color-muted-foreground)">
                Treat this as a different supplier
              </div>
            </div>
          </label>
        </div>
      )}

      {match.kind === 'candidates' && (
        <div className="space-y-2">
          {match.candidates.map((c) => (
            <label
              key={c.id}
              className="flex items-start gap-2 cursor-pointer rounded-lg border p-3 hover:bg-(--color-muted)/40"
            >
              <input
                type="radio"
                name="supplier-choice"
                checked={choice.kind === 'existing' && choice.supplier.id === c.id}
                onChange={() => setChoice({ kind: 'existing', supplier: c })}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-(--color-muted-foreground) font-mono">
                  {c.orgNumber ?? '—'} · {c.vatNumber ?? '—'}
                </div>
              </div>
            </label>
          ))}
          <label className="flex items-start gap-2 cursor-pointer rounded-lg border p-3 hover:bg-(--color-muted)/40">
            <input
              type="radio"
              name="supplier-choice"
              checked={choice.kind === 'create'}
              onChange={() => setChoice(fromProposal(proposal))}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-medium">None of these — create a new supplier</div>
            </div>
          </label>
        </div>
      )}

      {choice.kind === 'create' && (
        <div className="rounded-lg border bg-(--color-muted)/30 p-4 space-y-3">
          <div>
            <div className="text-xs text-(--color-muted-foreground) mb-1">Name</div>
            <input
              value={choice.name}
              onChange={(e) => setChoice({ ...choice, name: e.target.value })}
              className="w-full rounded-md border bg-(--color-background) px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-(--color-muted-foreground) mb-1">Org. no.</div>
              <input
                value={choice.orgNumber}
                onChange={(e) => setChoice({ ...choice, orgNumber: e.target.value })}
                placeholder="556677-8899"
                className="w-full rounded-md border bg-(--color-background) px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
              />
            </div>
            <div>
              <div className="text-xs text-(--color-muted-foreground) mb-1">VAT no.</div>
              <input
                value={choice.vatNumber}
                onChange={(e) => setChoice({ ...choice, vatNumber: e.target.value })}
                placeholder="SE556677889901"
                className="w-full rounded-md border bg-(--color-background) px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-(--color-primary)"
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-(--color-destructive)/40 bg-(--color-destructive)/5 p-3 text-sm text-(--color-destructive)">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button
          onClick={submit}
          disabled={submitting || cancelling || (choice.kind === 'create' && !choice.name.trim())}
          className="flex-1"
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Confirm and book
        </Button>
        <Button onClick={cancel} disabled={submitting || cancelling} variant="outline">
          {cancelling ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          Cancel
        </Button>
      </div>
    </div>
  );
}

function MatchBanner({
  kind,
  supplier,
  matchedBy,
}: {
  kind: 'exact' | 'candidates' | 'none';
  supplier?: Supplier;
  matchedBy?: 'org_number' | 'vat_number' | 'name';
}) {
  if (kind === 'exact' && supplier) {
    const label = matchedBy?.replace('_', ' ') ?? 'identifier';
    return (
      <div className="rounded-lg border border-(--color-success)/40 bg-(--color-success)/5 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium text-(--color-success)">
          <Check className="size-4" /> Matched by {label}
        </div>
        <div className="mt-1">
          <span className="font-medium">{supplier.name}</span>
          <span className="text-(--color-muted-foreground)">
            {' · '}
            <span className="font-mono">{supplier.orgNumber ?? '—'}</span>
            {' · '}
            <span className="font-mono">{supplier.vatNumber ?? '—'}</span>
          </span>
        </div>
      </div>
    );
  }
  if (kind === 'candidates') {
    return (
      <div className="rounded-lg border border-(--color-warning)/40 bg-(--color-warning)/5 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium text-(--color-warning)">
          <Search className="size-4" /> No exact match — did you mean…?
        </div>
        <p className="mt-1 text-(--color-muted-foreground)">
          Pick the supplier you intended, or create a new one.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="font-medium">No matching supplier on file</div>
      <p className="mt-1 text-(--color-muted-foreground)">
        We'll create a new supplier from the invoice details below.
      </p>
    </div>
  );
}
