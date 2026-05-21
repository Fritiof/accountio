import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { type PostgresJsQueryResultHKT, drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.ts';
import * as schema from './schema.ts';

export const queryClient = postgres(env.DATABASE_URL, {
  max: 10,
});

export const db = drizzle(queryClient, { schema });

export type DB = typeof db;
export type DBTx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
/** Either the root db or a transaction handle — same query API. Used by
 *  helpers that need to work both standalone and inside a transaction. */
export type DBOrTx = DB | DBTx;
