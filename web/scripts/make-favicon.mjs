// Writes web/public/favicon.ico: a 16x16 solid accent-colour square (#1a56db). Run: node web/scripts/make-favicon.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 16;
const [r, g, b] = [0x1a, 0x56, 0xdb];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image

const xor = Buffer.alloc(SIZE * SIZE * 4);
for (let i = 0; i < SIZE * SIZE; i++) xor.set([b, g, r, 255], i * 4); // BGRA
const and = Buffer.alloc(SIZE * 4); // 1-bit mask, 16 px = 2 bytes padded to 4 per row; all zero: opaque
const dib = Buffer.alloc(40);
dib.writeUInt32LE(40, 0);
dib.writeInt32LE(SIZE, 4);
dib.writeInt32LE(SIZE * 2, 8); // height counts the mask
dib.writeUInt16LE(1, 12);
dib.writeUInt16LE(32, 14);
dib.writeUInt32LE(xor.length + and.length, 20);
const image = Buffer.concat([dib, xor, and]);

const entry = Buffer.alloc(16);
entry[0] = SIZE;
entry[1] = SIZE;
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(image.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "favicon.ico");
fs.writeFileSync(out, Buffer.concat([header, entry, image]));
console.log(`wrote ${out}`);
