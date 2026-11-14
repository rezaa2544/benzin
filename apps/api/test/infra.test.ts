import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Task E0-03 — the local stack must be *coherent*, not just present.
 *
 * Docker itself is not available in this sandbox, so the failure this test exists for is the one
 * that actually happened: Caddy proxied `/` to a `web` service that docker-compose never defined,
 * and a plain `docker compose up` failed with "host not found in upstream". Reading the three files
 * together catches that class of drift in CI, before anyone pays for a VPS to discover it.
 */

const repo = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const read = (path: string): string => readFileSync(repo(path), 'utf8');

/** Minimal reader for the compose file: service names (two-space keys under `services:`) and the
 * container port of each published mapping (`'${VAR:-3000}:3000'` → 3000). */
function services(yaml: string): Map<string, number[]> {
  const found = new Map<string, number[]>();
  const lines = yaml.split('\n');
  let inServices = false;
  let current: string | null = null;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inServices = line.trim() === 'services:';
      current = null;
      continue;
    }
    if (!inServices) continue;
    const header = /^ {2}([a-z][\w-]*):\s*$/.exec(line);
    if (header?.[1]) {
      current = header[1];
      found.set(current, []);
      continue;
    }
    const mapping = /^\s+-\s+'([^']+)'/.exec(line);
    const target = mapping?.[1];
    if (!current || !target || !target.includes(':')) continue;
    const containerPort = Number(target.split(':').at(-1));
    if (Number.isInteger(containerPort)) found.get(current)!.push(containerPort);
  }
  return found;
}

const compose = read('infra/docker-compose.yml');
const stack = services(compose);
const caddy = read('infra/Caddyfile');

describe('docker stack (E0-03)', () => {
  it('defines every service Caddy needs', () => {
    for (const name of ['postgres', 'redis', 'api', 'admin', 'web', 'caddy']) {
      expect(stack.has(name), `compose service ${name}`).toBe(true);
    }
  });

  it('only proxies to services that exist, on the port that service listens on', () => {
    const upstreams = [...caddy.matchAll(/reverse_proxy\s+([a-z][\w-]*):(\d+)/g)];
    expect(upstreams.length).toBeGreaterThan(0);

    for (const [, name, port] of upstreams) {
      expect(stack.has(name!), `reverse_proxy → ${name}`).toBe(true);
      expect(stack.get(name!), `${name} publishes a port`).toContain(Number(port));
    }
  });

  it('builds from Dockerfiles that exist and matches their exposed port', () => {
    const dockerfiles = [...compose.matchAll(/dockerfile:\s*(\S+)/g)].map((match) => match[1]!);
    expect(dockerfiles).toEqual(
      expect.arrayContaining([
        'infra/Dockerfile.api',
        'infra/Dockerfile.admin',
        'infra/Dockerfile.web',
      ]),
    );
    for (const file of dockerfiles) {
      expect(existsSync(repo(file)), file).toBe(true);
    }
    // Every service the edge talks to must expose the port the edge expects.
    for (const [name, port] of [
      ['api', 3000],
      ['admin', 4173],
      ['web', 4173],
    ] as const) {
      const dockerfile = [...compose.matchAll(/dockerfile:\s*(\S+)/g)]
        .map((match) => match[1]!)
        .find((file) => file.endsWith(`Dockerfile.${name}`));
      expect(dockerfile, `${name} Dockerfile`).toBeTruthy();
      expect(read(dockerfile!), `${dockerfile} EXPOSE ${port}`).toContain(`EXPOSE ${port}`);
    }
  });

  it('waits for Postgres, Redis and the API to be healthy before starting the apps', () => {
    for (const name of ['postgres', 'redis', 'api']) {
      const block = compose.split(new RegExp(`^  ${name}:`, 'm'))[1] ?? '';
      expect(block.slice(0, block.search(/^ {2}[a-z][\w-]*:/m)), `${name} healthcheck`).toContain(
        'healthcheck:',
      );
    }
    expect(compose).toMatch(/postgres:\s*\n\s*condition: service_healthy/);
    expect(compose).toMatch(/api:\s*\n\s*condition: service_healthy/);
  });

  it('mounts the Caddyfile and the boot-time migrations the images expect', () => {
    expect(caddy).toContain('reverse_proxy api:3000');
    for (const file of ['./Caddyfile', './migrations']) {
      expect(existsSync(repo(`infra/${file.replace('./', '')}`)), file).toBe(true);
    }
    expect(compose).toContain('./Caddyfile:/etc/caddy/Caddyfile:ro');
    expect(compose).toContain('./migrations:/docker-entrypoint-initdb.d:ro');
  });
});

describe('web image (E9-15)', () => {
  it('serves the worker, the manifest and the icons from the origin root with sane caching', () => {
    const conf = read('infra/web-nginx.conf');
    expect(conf).toContain('location = /sw.js');
    expect(conf).toMatch(/location = \/sw\.js\s*\{[^}]*no-cache/);
    expect(conf).toContain('location = /manifest.webmanifest');
    expect(conf).toMatch(/default_type application\/manifest\+json/);
    expect(conf).toContain('location /icons/');
    // SPA history routes must resolve to the shell, not to a 404.
    expect(conf).toContain('try_files $uri /index.html');
  });

  it('builds the customer app, not the admin panel', () => {
    const dockerfile = read('infra/Dockerfile.web');
    expect(dockerfile).toContain('pnpm --filter @benzin/web build');
    expect(dockerfile).not.toContain('@benzin/admin');
    expect(dockerfile).toContain('apps/web/dist');
  });
});
