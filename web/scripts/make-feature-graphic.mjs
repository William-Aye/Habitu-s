// Writes docs/launch/feature-graphic.png (1024x500, the Google Play feature graphic):
// the app name and tagline in white on the accent colour.
// Same approach as make-og.mjs: no dependencies, a tiny pixel font and zlib.
// Run: node web/scripts/make-feature-graphic.mjs
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const W = 1024, H = 500;
const BG = [0x1a, 0x56, 0xdb], FG = [255, 255, 255];

// 5x7 glyphs, one string per row, "#" = filled.
const G = {
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  b: ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
  c: [".....", ".....", ".###.", "#....", "#....", "#...#", ".###."],
  d: ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  g: [".....", ".####", "#...#", "#...#", ".####", "....#", ".###."],
  h: ["#....", "#....", "####.", "#...#", "#...#", "#...#", "#...#"],
  i: ["..#..", ".....", ".##..", "..#..", "..#..", "..#..", ".###."],
  l: [".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  o: [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  p: [".....", ".....", "####.", "#...#", "####.", "#....", "#...."],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  s: [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
  t: [".#...", ".#...", "####.", ".#...", ".#...", ".#..#", "..##."],
  u: [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#"],
  v: [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  z: [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"],
  é: ["...#.", "..#..", ".###.", "#...#", "#####", "#....", ".###."],
  è: [".#...", "..#..", ".###.", "#...#", "#####", "#....", ".###."],
};

const px = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) px.set(BG, i * 3);

// Draws centred text; a space is a blank 3-cell gap. Returns nothing.
function drawLine(text, scale, y0) {
  const gap = 1;
  const cells = [...text].reduce((n, ch, i) => n + (ch === " " ? 3 : 5) + (i ? gap : 0), 0);
  let x = Math.round((W - cells * scale) / 2);
  [...text].forEach((ch, i) => {
    if (i) x += gap * scale;
    if (ch === " ") { x += 3 * scale; return; }
    const glyph = G[ch];
    if (!glyph) throw new Error(`no glyph for ${ch}`);
    glyph.forEach((row, r) => [...row].forEach((c, k) => {
      if (c !== "#") return;
      for (let yy = y0 + r * scale; yy < y0 + (r + 1) * scale; yy++)
        for (let xx = x + k * scale; xx < x + (k + 1) * scale; xx++) px.set(FG, (yy * W + xx) * 3);
    }));
    x += 5 * scale;
  });
}

drawLine("Habitués", 16, 110);
drawLine("Des activités régulières", 6, 275);
drawLine("près de chez vous", 6, 335);

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
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "launch", "feature-graphic.png");
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
