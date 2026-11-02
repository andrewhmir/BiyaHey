import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

/**
 * Generates the PWA install icons checked in under `apps/web/public/icons`.
 *
 * Chrome's installability check wants real 192 and 512 PNGs (an SVG-only
 * manifest is not enough), and a maskable variant needs its artwork inside the
 * safe zone. There is no image dependency in this repo, so this script encodes
 * the PNGs directly with Node's zlib: a teal field, a white "route" polyline
 * and three stop dots. Run `node apps/web/scripts/generate-icons.mjs` after
 * changing the design; the generated files are committed.
 *
 * Artwork is deliberately simple: it must stay legible at 48 px and remain
 * valid as a maskable icon (content scaled into the centre 62%).
 */

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const TEAL = [0x00, 0x69, 0x6d];
const WHITE = [0xff, 0xff, 0xff];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[n] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function blend(base, top, amount) {
  return [
    Math.round(base[0] + (top[0] - base[0]) * amount),
    Math.round(base[1] + (top[1] - base[1]) * amount),
    Math.round(base[2] + (top[2] - base[2]) * amount),
  ];
}

function coverage(distance, radius) {
  const feather = 0.004;
  return Math.max(0, Math.min(1, (radius + feather - distance) / (2 * feather)));
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** RGBA pixel source for a teal field with a white route and stop dots. */
function makeRenderer(contentScale) {
  const points = [
    [0.3, 0.7],
    [0.5, 0.5],
    [0.7, 0.3],
  ].map(([x, y]) => [0.5 + (x - 0.5) * contentScale, 0.5 + (y - 0.5) * contentScale]);
  const strokeHalf = 0.052 * contentScale;
  const nodeRadius = 0.082 * contentScale;
  const nodeCoreRadius = 0.034 * contentScale;

  return (x, y) => {
    let routeCoverage = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const [ax, ay] = points[index];
      const [bx, by] = points[index + 1];
      const distance = distanceToSegment(x, y, ax, ay, bx, by);
      routeCoverage = Math.max(routeCoverage, coverage(distance, strokeHalf));
    }

    let nodeCoverage = 0;
    let coreCoverage = 0;
    for (const [nx, ny] of points) {
      const distance = Math.hypot(x - nx, y - ny);
      nodeCoverage = Math.max(nodeCoverage, coverage(distance, nodeRadius));
      coreCoverage = Math.max(coreCoverage, coverage(distance, nodeCoreRadius));
    }

    let color = TEAL;
    if (routeCoverage > 0) color = blend(color, WHITE, routeCoverage);
    if (nodeCoverage > 0) color = blend(color, WHITE, nodeCoverage);
    if (coreCoverage > 0) color = blend(color, TEAL, coreCoverage);
    return [color[0], color[1], color[2], 255];
  };
}

function encodePng(size, render) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let row = 0; row < size; row += 1) {
    raw[row * stride] = 0; // filter: none
    for (let column = 0; column < size; column += 1) {
      const [red, green, blue, alpha] = render((column + 0.5) / size, (row + 0.5) / size);
      const offset = row * stride + 1 + column * 4;
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = alpha;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // bytes 10-12 stay zero: deflate compression, adaptive filtering, no interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngSize(png) {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('generated file is not a PNG');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const ICONS = [
  { file: 'icon-192.png', size: 192, contentScale: 1 },
  { file: 'icon-512.png', size: 512, contentScale: 1 },
  { file: 'maskable-512.png', size: 512, contentScale: 0.62 },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const icon of ICONS) {
  const png = encodePng(icon.size, makeRenderer(icon.contentScale));
  const dimensions = pngSize(png);
  if (dimensions.width !== icon.size || dimensions.height !== icon.size) {
    throw new Error(`${icon.file} is ${dimensions.width}x${dimensions.height}`);
  }
  writeFileSync(resolve(OUT_DIR, icon.file), png);
  console.log(`wrote ${icon.file} (${dimensions.width}x${dimensions.height}, ${png.length} bytes)`);
}
