#!/usr/bin/env node
/**
 * Generates the PWA icon set (task E9-15) — pure Node, no image dependency, so the icons are
 * reproducible on a clean checkout: `pnpm --filter @benzin/web icons`.
 *
 * The artwork is drawn with maths at the target resolution (4×4 supersampled), not resized from
 * a bitmap: a fuel droplet on the brand green, matching `--brand` (10 110 68) in tokens.css.
 * The maskable variant keeps the droplet inside the 80% safe zone and lets the background bleed
 * to the edges, which is what Android expects.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const BRAND = [10, 110, 68];
const WHITE = [255, 255, 255];

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Coverage of the rounded square (0 outside, 1 inside) with a soft 1px edge. */
function roundedSquare(x, y, size, radius) {
  const inset = size * 0.5;
  const qx = Math.abs(x - inset) - (inset - radius);
  const qy = Math.abs(y - inset) - (inset - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const signed = outside + Math.min(Math.max(qx, qy), 0) - radius;
  return clamp01(0.5 - signed);
}

/** Coverage of the droplet: a circle body joined to a smooth cone that ends in a point. */
function droplet(x, y, size, scale) {
  const cx = size * 0.5;
  const apex = size * (0.5 - 0.28 * scale);
  const cy = size * (0.5 + 0.16 * scale);
  const r = size * 0.19 * scale;
  const body = r - Math.hypot(x - cx, y - cy);
  let cone = -1;
  // Above the tip there is no cone at all: without this guard the clamped t would paint a hairline.
  if (y <= cy && y >= apex) {
    const t = clamp01((y - apex) / (cy - apex));
    // sin(t·π/2): zero width at the tip, vertical tangent where it meets the circle.
    const half = r * Math.sin((t * Math.PI) / 2);
    cone = half - Math.abs(x - cx);
  }
  const signed = Math.max(body, cone);
  return clamp01(0.5 + signed);
}

function render(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.78 : 1;
  const samples = 4;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let background = 0;
      let ink = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = px + (sx + 0.5) / samples;
          const y = py + (sy + 0.5) / samples;
          background += maskable ? 1 : roundedSquare(x, y, size, radius);
          ink += droplet(x, y, size, scale);
        }
      }
      const total = samples * samples;
      const bg = background / total;
      const drop = Math.min(ink / total, bg);
      const rgb = [0, 1, 2].map((i) => Math.round(BRAND[i] * (1 - drop) + WHITE[i] * drop));
      const offset = (py * size + px) * 4;
      pixels[offset] = rgb[0];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[2];
      // iOS and maskable icons are composited on the OS background: keep the square opaque.
      pixels[offset + 3] = Math.round(bg * 255);
    }
  }
  return encodePng(pixels, size, size);
}

function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon-180.png', 180, {}],
  ['favicon-32.png', 32, {}],
];

mkdirSync(OUT, { recursive: true });
for (const [name, size, options] of targets) {
  writeFileSync(join(OUT, name), render(size, options));
  console.info(`[icons] ${name} (${size}×${size})`);
}
