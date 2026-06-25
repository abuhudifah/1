/**
 * scripts/generate-icons.js
 * مولّد أيقونات PWA — تصميم احترافي
 * يعمل بـ Node.js المدمج فقط (بدون حزم خارجية)
 */

import { createDeflate } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';

// ─── CRC32 + PNG chunk ─────────────────────────────────────────
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
  const tb = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([len, tb, data, crcBuf]);
}

// ─── PNG Builder (RGB — للأيقونات الملونة) ────────────────────
async function buildPNG(pixels, width, height) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8]=8; ihdr[9]=2; // bit depth=8, color type=RGB

  const bpp = 3;
  const raw = Buffer.alloc(height * (1 + width * bpp));
  for (let y=0; y<height; y++) {
    raw[y*(width*bpp+1)] = 0;
    for (let x=0; x<width; x++) {
      const s = (y*width+x)*bpp, d = y*(width*bpp+1)+1+x*bpp;
      raw[d]=pixels[s]; raw[d+1]=pixels[s+1]; raw[d+2]=pixels[s+2];
    }
  }
  const compressed = await deflate(raw);
  return Buffer.concat([sig, chunk('IHDR',ihdr), chunk('IDAT',compressed), chunk('IEND',Buffer.alloc(0))]);
}

// ─── PNG Builder (RGBA — لأيقونة الإشعار الشفافة) ────────────
async function buildRGBAPNG(pixels, width, height) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8]=8; ihdr[9]=6; // bit depth=8, color type=RGBA

  const bpp = 4;
  const raw = Buffer.alloc(height * (1 + width * bpp));
  for (let y=0; y<height; y++) {
    raw[y*(width*bpp+1)] = 0;
    for (let x=0; x<width; x++) {
      const s = (y*width+x)*bpp, d = y*(width*bpp+1)+1+x*bpp;
      raw[d]=pixels[s]; raw[d+1]=pixels[s+1]; raw[d+2]=pixels[s+2]; raw[d+3]=pixels[s+3];
    }
  }
  const compressed = await deflate(raw);
  return Buffer.concat([sig, chunk('IHDR',ihdr), chunk('IDAT',compressed), chunk('IEND',Buffer.alloc(0))]);
}

function deflate(buf) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const d = createDeflate({ level: 6 });
    d.on('data', c => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    d.on('error', reject);
    d.end(buf);
  });
}

// ─── أدوات الرسم (RGB) ────────────────────────────────────────
function makeCanvas(size) {
  const px = Buffer.alloc(size * size * 3);
  const set = (x, y, r, g, b) => {
    x=Math.round(x); y=Math.round(y);
    if (x<0||x>=size||y<0||y>=size) return;
    const i=(y*size+x)*3; px[i]=r; px[i+1]=g; px[i+2]=b;
  };
  const fillRect = (x,y,w,h,r,g,b) => {
    x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
    for (let dy=0;dy<h;dy++) for (let dx=0;dx<w;dx++) set(x+dx,y+dy,r,g,b);
  };
  const fillRoundRect = (x,y,w,h,rad,r,g,b) => {
    x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h); rad=Math.round(Math.min(rad,w/2,h/2));
    for (let dy=0;dy<h;dy++) for (let dx=0;dx<w;dx++) {
      let ok=true;
      if      (dx<rad&&dy<rad)       ok=Math.hypot(dx-rad,dy-rad)<=rad;
      else if (dx>=w-rad&&dy<rad)    ok=Math.hypot(dx-(w-rad-1),dy-rad)<=rad;
      else if (dx<rad&&dy>=h-rad)    ok=Math.hypot(dx-rad,dy-(h-rad-1))<=rad;
      else if (dx>=w-rad&&dy>=h-rad) ok=Math.hypot(dx-(w-rad-1),dy-(h-rad-1))<=rad;
      if (ok) set(x+dx,y+dy,r,g,b);
    }
  };
  const fillCircle = (cx,cy,rr,r,g,b) => {
    cx=Math.round(cx); cy=Math.round(cy); rr=Math.round(rr);
    for (let y=cy-rr;y<=cy+rr;y++) for (let x=cx-rr;x<=cx+rr;x++)
      if ((x-cx)**2+(y-cy)**2<=rr*rr) set(x,y,r,g,b);
  };
  return { px, set, fillRect, fillRoundRect, fillCircle };
}

// ─── أدوات الرسم (RGBA) ──────────────────────────────────────
function makeCanvasRGBA(size) {
  const px = Buffer.alloc(size * size * 4, 0);
  const setA = (x, y, alpha=255) => {
    x=Math.round(x); y=Math.round(y);
    if (x<0||x>=size||y<0||y>=size) return;
    const i=(y*size+x)*4; px[i]=255; px[i+1]=255; px[i+2]=255; px[i+3]=Math.max(px[i+3],alpha);
  };
  const fillCircleA = (cx,cy,r) => {
    for (let y=Math.ceil(cy-r-1);y<=Math.floor(cy+r+1);y++)
      for (let x=Math.ceil(cx-r-1);x<=Math.floor(cx+r+1);x++) {
        const d=Math.sqrt((x-cx)**2+(y-cy)**2);
        if (d<=r-0.5) setA(x,y,255);
        else if (d<r+0.5) setA(x,y,Math.round(255*(r+0.5-d)));
      }
  };
  const fillRectA = (x,y,w,h) => {
    x=Math.round(x);y=Math.round(y);w=Math.round(w);h=Math.round(h);
    for (let dy=0;dy<h;dy++) for (let dx=0;dx<w;dx++) setA(x+dx,y+dy);
  };
  return { px, setA, fillCircleA, fillRectA };
}

// ═══════════════════════════════════════════════════════════════
// رسم أيقونة التطبيق الاحترافية (الحاسبة)
// ═══════════════════════════════════════════════════════════════
function drawAppIcon(size) {
  const { px, fillRect, fillRoundRect, fillCircle } = makeCanvas(size);
  const s = size / 512;

  // ── خلفية #0f172a
  fillRect(0, 0, size, size, 15, 23, 42);

  // ── جسم الحاسبة (بطاقة داخلية)
  const pad  = Math.round(28 * s);
  const bW   = size - pad * 2;
  const bH   = size - pad * 2;
  const bRad = Math.round(52 * s);
  fillRoundRect(pad, pad, bW, bH, bRad, 20, 30, 50); // #14203b

  // ── حاشية زرقاء رفيعة (إطار ناعم)
  const brd = Math.round(3 * s);
  for (let i=0; i<brd; i++) {
    // رسم outline دائري تقريباً
    const ox=pad-i-1, oy=pad-i-1, ow=bW+2*(i+1), oh=bH+2*(i+1);
    // نرسمه كـ 4 مستطيلات رفيعة
    fillRoundRect(ox, oy, ow, oh, bRad+i+1, 37, 99, 235); // #2563eb border
    fillRoundRect(ox+1, oy+1, ow-2, oh-2, bRad+i, 20, 30, 50); // امسح الداخل
  }
  // أعد رسم الداخل بعد الحاشية
  fillRoundRect(pad, pad, bW, bH, bRad, 20, 30, 50);

  // ── شاشة العرض
  const dpX  = pad + Math.round(20 * s);
  const dpY  = pad + Math.round(20 * s);
  const dpW  = bW  - Math.round(40 * s);
  const dpH  = Math.round(118 * s);
  const dpRad= Math.round(18 * s);
  fillRoundRect(dpX, dpY, dpW, dpH, dpRad, 10, 18, 36); // #0a1224 شاشة داكنة

  // ── خط رفيع أسفل الشاشة (مؤشر أزرق)
  fillRect(dpX + Math.round(12*s), dpY+dpH - Math.round(6*s), dpW - Math.round(24*s), Math.round(4*s), 37, 99, 235);

  // ── أرقام وهمية في الشاشة (ثلاث كتل بيضاء = رقم مكوّن من 4 أرقام)
  const numH = Math.round(34 * s);
  const numY = dpY + Math.round(44 * s);
  // "،0 3850" — نرسمها كأشرطة بيضاء
  const numRad = Math.round(4 * s);
  // شريط رئيسي
  fillRoundRect(dpX + dpW - Math.round(180*s), numY, Math.round(155*s), numH, numRad, 255, 255, 255);
  // فاصل عشري
  fillCircle(dpX + dpW - Math.round(205*s), numY + numH/2, Math.round(7*s), 255, 255, 255);
  // أرقام عشرية (أصغر)
  fillRoundRect(dpX + dpW - Math.round(256*s), numY + Math.round(9*s), Math.round(40*s), Math.round(18*s), numRad, 180, 200, 230);

  // ── شبكة الأزرار 4×4
  const cols=4, rows=4;
  const bAreaX = pad + Math.round(20*s);
  const bAreaY = dpY + dpH + Math.round(22*s);
  const bAreaW = bW - Math.round(40*s);
  const bAreaH = pad + bH - (bAreaY - pad) - Math.round(20*s);
  const gapX   = Math.round(16*s);
  const gapY   = Math.round(16*s);
  const btnW   = Math.round((bAreaW - gapX*(cols-1)) / cols);
  const btnH   = Math.round((bAreaH - gapY*(rows-1)) / rows);
  const btnR   = Math.round(Math.min(btnW, btnH) * 0.42);

  // بالوان الأزرار
  const C = {
    func : [51,  65,  85 ], // #334155 — وظائف (AC، +/-)
    num  : [30,  41,  59 ], // #1e293b — أرقام
    op   : [37,  99,  235], // #2563eb — عمليات (÷ × − +)
    eq   : [29,  78,  216], // #1d4ed8 — يساوي (أغمق)
  };

  const layout = [
    [C.func, C.func, C.func, C.op ],  // AC  +/-  %   ÷
    [C.num,  C.num,  C.num,  C.op ],  // 7   8    9   ×
    [C.num,  C.num,  C.num,  C.op ],  // 4   5    6   −
    [C.num,  C.num,  C.num,  C.eq ],  // 1   2    3   +
  ];

  for (let row=0; row<rows; row++) {
    for (let col=0; col<cols; col++) {
      const [r,g,b] = layout[row][col];
      const bx = bAreaX + col*(btnW+gapX);
      const by = bAreaY + row*(btnH+gapY);
      fillRoundRect(bx, by, btnW, btnH, btnR, r, g, b);

      // نقطة بيضاء مركزية (تمثّل رمز الزر)
      if (col < 3) {
        // أزرار الأرقام والوظائف: نقطة صغيرة
        const dotR = Math.round(btnW * 0.12);
        fillCircle(bx+btnW/2, by+btnH/2, dotR, 255, 255, 255);
      } else {
        // أزرار العمليات: خط أفقي أو رمز
        const symW = Math.round(btnW*0.4), symH = Math.round(Math.max(4*s, btnH*0.08));
        fillRoundRect(bx+btnW/2-symW/2, by+btnH/2-symH/2, symW, symH, 2, 255,255,255);
      }
    }
  }

  return px;
}

// ═══════════════════════════════════════════════════════════════
// رسم أيقونة الإشعار — ناقوس أبيض على شفاف (RGBA)
// Android يتطلب أبيض + ألفا — أي لون آخر يُجاهَل ويُظهَر أبيض
// ═══════════════════════════════════════════════════════════════
function drawNotificationIcon(size) {
  const { px, fillCircleA, fillRectA } = makeCanvasRGBA(size);
  const s = size / 96;
  const cx = size / 2;

  // 1. مقبض (ذيل) في الأعلى
  fillRectA(cx - 4*s, 8*s, 8*s, 10*s);

  // 2. قبة الناقوس (نصف دائرة علوية)
  const domeR = 28*s, domeCY = 44*s;
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    const dy=y-domeCY, dx=x-cx;
    if (dy<=0 && dx*dx+dy*dy<=domeR*domeR) {
      const i=(y*size+x)*4; px[i]=255;px[i+1]=255;px[i+2]=255;px[i+3]=255;
    }
  }

  // 3. جسم الناقوس (يتسع كلما نزلنا)
  for (let y=Math.round(domeCY); y<Math.round(68*s); y++) {
    const ys = y/s;
    const t  = (ys-44)/(68-44); // 0→1
    const hw = (28 + t*6)*s;    // يتسع من 28 إلى 34
    fillRectA(Math.round(cx-hw), y, Math.round(hw*2), 1);
  }

  // 4. شفة سفلية (أعرض — فم الناقوس)
  fillRectA(cx - 36*s, 68*s, 72*s, 8*s);

  // 5. دمدمة (نقطة صغيرة أسفل الناقوس)
  fillCircleA(cx, 84*s, 6*s);

  return px;
}

// ═══════════════════════════════════════════════════════════════
// توليد الأيقونات
// ═══════════════════════════════════════════════════════════════
const outDir = new URL('../assets/icons/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

// أيقونات التطبيق (RGB)
const appSizes = [
  { name: 'icon-512.png',          size: 512 },
  { name: 'icon-192.png',          size: 192 },
  { name: 'apple-touch-icon.png',  size: 180 },
  { name: 'favicon-32.png',        size: 32  },
];

for (const { name, size } of appSizes) {
  const px  = drawAppIcon(size);
  const png = await buildPNG(px, size, size);
  writeFileSync(outDir + name, png);
  console.log(`✅ ${name} (${size}×${size})`);
}

// أيقونة الإشعار (RGBA — أبيض على شفاف)
const notifSizes = [
  { name: 'notification-icon.png', size: 96  },
  { name: 'favicon-32.png',        size: 32  }, // أعد توليد الـ favicon أيضاً
];

for (const { name, size } of notifSizes) {
  if (name === 'favicon-32.png') continue; // يُعالَج في الـ RGB
  const px  = drawNotificationIcon(size);
  const png = await buildRGBAPNG(px, size, size);
  writeFileSync(outDir + name, png);
  console.log(`✅ ${name} (${size}×${size}) — RGBA`);
}

console.log('🎉 جميع الأيقونات جاهزة في assets/icons/');
