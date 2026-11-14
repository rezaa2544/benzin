import { eq } from 'drizzle-orm';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createOwnerSchema, toAsciiDigits } from '@benzin/shared';
import { loadConfig } from '../config.js';
import { createMemoryRepositories } from '../infra/memory/index.js';
import * as schema from '../infra/db/schema.js';
import { users } from '../infra/db/schema.js';

/**
 * One-command owner bootstrap (task E8-10).
 *
 *   pnpm --filter @benzin/api owner:create -- --phone 09123456789 --name "مالک بنزین"
 *
 * With DATABASE_URL the account is written to Postgres (idempotent: an existing owner
 * phone is reported, a USER phone is refused — roles are never escalated silently).
 * Without it the command explains what is missing instead of pretending to persist.
 */

const argument = (name: string): string | null => {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1] ?? null;
  return null;
};

async function main(): Promise<void> {
  const config = loadConfig();
  const phoneRaw = argument('phone');
  if (!phoneRaw) {
    console.error('usage: owner:create -- --phone 09xxxxxxxxx [--name "مالک بنزین"]');
    process.exitCode = 1;
    return;
  }
  const input = createOwnerSchema.parse({
    phone: toAsciiDigits(phoneRaw.trim()),
    displayName: argument('name') ?? undefined,
  });

  if (!config.DATABASE_URL) {
    // Development convenience: memory mode can still show the exact row that would be written.
    const repos = createMemoryRepositories();
    const existing = await repos.users.findByPhone(input.phone);
    if (existing) {
      console.info(`حساب با شماره ${input.phone} از قبل وجود دارد (نقش: ${existing.role}).`);
      return;
    }
    const created = await repos.users.create({ phone: input.phone, role: 'OWNER' });
    created.displayName = input.displayName;
    await repos.users.save(created);
    console.info(
      `نقش OWNER برای ${input.phone} ساخته شد — فقط در حافظه‌ی همین اجرا.\n` +
        'برای ماندگاری، DATABASE_URL را تنظیم و db:migrate/db:seed را اجرا کنید.',
    );
    return;
  }

  const client = new Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  const db = drizzle(client, { schema });
  try {
    const [existing] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.phone, input.phone))
      .limit(1);
    if (existing) {
      if (existing.role === 'OWNER') {
        console.info(`حساب مالک از قبل وجود دارد (${input.phone}).`);
        return;
      }
      console.error(
        `شماره‌ی ${input.phone} با نقش ${existing.role} ثبت شده است؛ ارتقای نقش باید از پنل انجام شود.`,
      );
      process.exitCode = 1;
      return;
    }
    await db.insert(users).values({
      phone: input.phone,
      displayName: input.displayName,
      role: 'OWNER',
      status: 'ACTIVE',
    });
    console.info(`حساب OWNER برای ${input.phone} ساخته شد. ورود با کد یک‌بارمصرف انجام می‌شود.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
