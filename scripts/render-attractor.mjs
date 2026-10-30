// Renders the hero attractor as a still, for browsers without WebGL2 and for
// the share image. Uses the same parameters (the hero's first frame) and the
// same tone mapping as src/scripts/attractor.ts, so the two crossfade cleanly.
//
// usage: node scripts/render-attractor.mjs out.png [width]

import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const EXTENT_X = 2.72;
const EXTENT_Y = 2.02;
const [a, b, c, d] = [-1.8, 1.7 + 0.14 * Math.sin(1.3), -1.6 + 0.119 * Math.sin(2.1), -0.9 + 0.119 * Math.sin(0.4)];

const out = process.argv[2];
const W = Number(process.argv[3] ?? 1600);
const H = Math.round((W * EXTENT_Y) / EXTENT_X);
const k = W / (2 * EXTENT_X);
const density = new Float64Array(W * H);
const samples = 120e6;

let x = 0.1;
let y = 0.1;
for (let i = 0; i < samples + 100; i++) {
  const nx = Math.sin(a * y) + c * Math.cos(a * x);
  y = Math.sin(b * x) + d * Math.cos(b * y);
  x = nx;
  if (i < 100) continue;
  const px = Math.floor(W / 2 + x * k);
  const py = Math.floor(H / 2 + y * k);
  if (px >= 0 && px < W && py >= 0 && py < H) density[py * W + px]++;
}

const exposure = (0.7 * 0.35 * W * H) / samples;
const rows = Buffer.alloc((W + 1) * H);
for (let row = 0; row < H; row++) {
  rows[row * (W + 1)] = 0;
  for (let col = 0; col < W; col++) {
    const v = Math.pow(1 - Math.exp(-density[row * W + col] * exposure), 0.9);
    rows[row * (W + 1) + 1 + col] = Math.round(9 + (238 - 9) * v);
  }
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 0; // greyscale
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log(`${out} ${W}x${H}`);
