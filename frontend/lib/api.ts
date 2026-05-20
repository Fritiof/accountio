/**
 * Typed fetch helpers. Used by server components (via the in-network
 * BACKEND_URL) and by client components (via the same-origin Next.js
 * rewrite). The path stays `/api/...` in both cases.
 */
import type { BillDetail, BillListItem } from './types.ts';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';

/** Resolve a URL — absolute in server contexts, same-origin in browser. */
function resolveUrl(path: string): string {
  if (typeof window !== 'undefined') return path;
  return new URL(path, BACKEND_URL).toString();
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(resolveUrl(path), { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function listBills(): Promise<BillListItem[]> {
  const data = await getJson<{ bills: BillListItem[] }>('/api/bills');
  return data.bills;
}

export async function getBillDetail(id: string): Promise<BillDetail> {
  return getJson<BillDetail>(`/api/bills/${id}`);
}
