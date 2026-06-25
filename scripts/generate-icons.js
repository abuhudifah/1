/**
 * scripts/generate-icons.js
 * مولّد أيقونات PWA — تصميم آلة حاسبة
 * يعمل بـ Node.js المدمج فقط (بدون حزم خارجية)
 */

import { createDeflate } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { promisify } from 'util';

const deflate = promisify((buf, opts, cb) => createDeflate(opts).end(buf).on('data', cb));

// ─── PNG Builder ───────────────────────────────────────────────
function crc32(buf) {
  const table = new Uint32Array(256).map((_, i) => {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([len, typeBytes, data, crc]);
}

async function buildPNG(pixels, width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // بناء الـ scanlines مع filter byte (0 = None)
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter byte
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      const r = y * (width * 3 + 1) + 1 + x * 3;
      raw[r]   = pixels[p];
      raw[r+1] = pixels[p+1];
      raw[r+2] = pixels[p+2];
    }
  }

  const compressed = await new Promise((resolve, reject) => {
    const chunks = [];
    const d = createDeflate({ level: 6 });
    d.on('data', c => chunks.push(c));
    d.on('end',  ()  => resolve(Buffer.concat(chunks)));
    d.on('error', reject);
    d.end(raw);
  });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── رسم الأيقونة ─────────────────────────────────────────────
function drawCalculator(size) {
  const pixels = Buffer.alloc(size * size * 3);

  const set = (x, y, r, g, b) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const p = (y * size + x) * 3;
    pixels[p] = r; pixels[p+1] = g; pixels[p+2] = b;
  };

  const fillRect = (x, y, w, h, r, g, b) => {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        set(x + dx, y + dy, r, g, b);
  };

  const fillRoundRect = (x, y, w, h, radius, r, g, b) => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = dx, cy = dy;
        // corner check
        let inCorner = false;
        if (cx < radius && cy < radius) {
          inCorner = Math.hypot(cx - radius, cy - radius) > radius;
        } else if (cx >= w - radius && cy < radius) {
          inCorner = Math.hypot(cx - (w - radius - 1), cy - radius) > radius;
        } else if (cx < radius && cy >= h - radius) {
          inCorner = Math.hypot(cx - radius, cy - (h - radius - 1)) > radius;
        } else if (cx >= w - radius && cy >= h - radius) {
          inCorner = Math.hypot(cx - (w - radius - 1), cy - (h - radius - 1)) > radius;
        }
        if (!inCorner) set(x + dx, y + dy, r, g, b);
      }
    }
  };

  const s = size / 512; // scale factor

  // ── خلفية داكنة (iOS Calculator dark)
  fillRect(0, 0, size, size, 28, 28, 30); // #1C1C1E

  // ── شريط الشاشة
  const dispX = Math.round(24 * s), dispY = Math.round(24 * s);
  const dispW = Math.round(464 * s), dispH = Math.round(110 * s);
  fillRoundRect(dispX, dispY, dispW, dispH, Math.round(14 * s), 44, 44, 46); // #2C2C2E

  // ── زر رقم على اليمين (محاكاة نص "0")
  const numW = Math.round(28 * s), numH = Math.round(52 * s);
  fillRoundRect(
    Math.round(420 * s), Math.round(48 * s),
    numW, numH, Math.round(6 * s),
    255, 255, 255
  );

  // ── صفوف الأزرار (4 × 5)
  const cols = 4, rows = 5;
  const btnSize = Math.round(98 * s);
  const gapX    = Math.round(14 * s);
  const gapY    = Math.round(14 * s);
  const startX  = Math.round(24 * s);
  const startY  = Math.round(154 * s);
  const radius  = Math.round(49 * s);

  const colors = [
    // صف 0: AC +/- % ÷
    [[99,99,102],[99,99,102],[99,99,102],[255,149,0]],
    // صف 1: 7 8 9 ×
    [[58,58,60],[58,58,60],[58,58,60],[255,149,0]],
    // صف 2: 4 5 6 −
    [[58,58,60],[58,58,60],[58,58,60],[255,149,0]],
    // صف 3: 1 2 3 +
    [[58,58,60],[58,58,60],[58,58,60],[255,149,0]],
    // صف 4: 0(wide) . =
    [[58,58,60],[58,58,60],[255,149,0]],
  ];

  for (let row = 0; row < rows; row++) {
    const rowColors = colors[row];
    let col = 0;
    for (let ci = 0; ci < rowColors.length; ci++) {
      const [r, g, b] = rowColors[ci];
      // زر الـ 0 في الصف الأخير: عريض مزدوج
      const isWide = (row === rows - 1 && ci === 0);
      const w = isWide ? btnSize * 2 + gapX : btnSize;
      const x = startX + col * (btnSize + gapX);
      const y = startY + row * (btnSize + gapY);
      fillRoundRect(x, y, w, btnSize, radius, r, g, b);
      col += isWide ? 2 : 1;
    }
  }

  return pixels;
}

// ─── توليد الأحجام ────────────────────────────────────────────
const sizes = [
  { name: 'icon-192.png',        size: 192 },
  { name: 'icon-512.png',        size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'favicon-32.png',      size: 32  },
];

const outDir = new URL('../assets/icons/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

for (const { name, size } of sizes) {
  const pixels = drawCalculator(size);
  const png    = await buildPNG(pixels, size, size);
  writeFileSync(outDir + name, png);
  console.log(`✅ ${name} (${size}×${size})`);
}
console.log('🎉 جميع الأيقونات جاهزة في assets/icons/');
