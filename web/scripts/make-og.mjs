// Writes web/public/og-default.png (1200x630): the site name on the accent colour.
// No dependencies: a tiny pixel font and zlib. Run: node web/scripts/make-og.mjs
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const W = 1200, H = 630;
const BG = [0x1a, 0x56, 0xdb], FG = [255, 255, 255];

// 5x7 glyphs, one string per row, "#" = filled.
const G = {
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  b: ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
  i: ["..#..", ".....", ".##..", "..#..", "..#..", "..#..", ".###."],
  t: [".#...", ".#...", "####.", ".#...", ".#...", ".#..#", "..##."],
  u: [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#"],
  é: ["...#.", "..#..", ".###.", "#...#", "#####", "#....", ".###."],
  s: [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
};
const word = "Habitués";
const scale = 22, gap = 1; // cell size in px, gap in cells between glyphs
const wCells = word.length * 5 + (word.length - 1) * gap;
const x0 = Math.round((W - wCells * scale) / 2);
const y0 = Math.round((H - 7 * scale) / 2);

const px = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) px.set(BG, i * 3);
[...word].forEach((ch, n) => {
  G[ch].forEach((row, r) => {
    [...row].forEach((c, k) => {
      if (c !== "#") return;
      const bx = x0 + (n * (5 + gap) + k) * scale, by = y0 + r * scale;
      for (let y = by; y < by + scale; y++) for (let x = bx; x < bx + scale; x++) px.set(FG, (y * W + x) * 3);
    });
  });
});

const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, sum]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.set([8, 2, 0, 0, 0], 8);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "og-default.png");
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
