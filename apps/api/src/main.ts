import { buildApp } from './http/app.js';
import { loadConfig } from './config.js';
import { createMemoryRepositories } from './infra/memory/index.js';
import { createSmsSender } from './infra/sms/index.js';
import { systemClock } from './domain/entities.js';
import { applySeed } from './infra/db/seed.js';

const config = loadConfig();

if (config.NODE_ENV === 'production') {
  // Fail fast instead of silently running on volatile storage.
  if (!config.DATABASE_URL) {
    console.error('DATABASE_URL is required in production; in-memory repositories are dev-only.');
    process.exit(1);
  }
  console.error(
    'The Postgres repository adapter is not wired yet (task E2). Refusing to start with in-memory data.',
  );
  process.exit(1);
}

const repos = createMemoryRepositories();
// Provider chain from D3: SMS.ir first, Kavenegar as failover; `console` without keys.
const sms = createSmsSender(config);
// Development/tests only: make the app usable immediately (Baneh zone, plans, settings).
await applySeed(repos);
const { app } = await buildApp({
  config,
  repos,
  sms,
  clock: systemClock,
});

app.log.warn('Running with in-memory repositories — data is lost on restart (development only)');

await app.listen({ port: config.API_PORT, host: config.API_HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
