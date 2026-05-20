/**
 * Filesystem storage for uploaded PDFs.
 * Files are written to UPLOAD_DIR with a randomly-generated filename; the
 * relative path is stored in the `bills.storage_path` column.
 */
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { env } from '../env.ts';

let dirReady = false;

async function ensureDir(): Promise<void> {
  if (dirReady) return;
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  dirReady = true;
}

export type StoredFile = {
  storagePath: string;
  absolutePath: string;
  sizeBytes: number;
};

export async function storePdf(input: {
  bytes: Uint8Array;
  originalName: string;
}): Promise<StoredFile> {
  await ensureDir();
  const ext = extname(input.originalName).toLowerCase() || '.pdf';
  const storagePath = `${randomUUID()}${ext}`;
  const absolutePath = join(env.UPLOAD_DIR, storagePath);
  await Bun.write(absolutePath, input.bytes);
  return {
    storagePath,
    absolutePath,
    sizeBytes: input.bytes.byteLength,
  };
}

export function resolveStoragePath(storagePath: string): string {
  return join(env.UPLOAD_DIR, storagePath);
}

export function readStoredFile(storagePath: string): ReturnType<typeof Bun.file> {
  return Bun.file(resolveStoragePath(storagePath));
}
