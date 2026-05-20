import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` doesn't need DB credentials — it only reads the schema.
// `drizzle-kit studio` / `push` use the URL from env (passed via `--env-file` or shell env).
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://accountio:accountio@localhost:5432/accountio',
  },
  verbose: true,
  strict: true,
});
