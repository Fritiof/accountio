#!/usr/bin/env bun
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../env.ts';

const migrationClient = postgres(env.DATABASE_URL, { max: 1 });

console.log('▶ Running migrations against', env.DATABASE_URL.replace(/:[^:@]+@/, ':***@'));
await migrate(drizzle(migrationClient), { migrationsFolder: './src/db/migrations' });
console.log('✓ Migrations complete');

await migrationClient.end();
