import { defineConfig } from 'drizzle-kit';

/** `pnpm db:generate` writes reviewed SQL into infra/migrations (task E2-01). */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infra/db/schema.ts',
  out: '../../infra/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://benzin:benzin@localhost:5432/benzin',
  },
  verbose: true,
  strict: true,
});
