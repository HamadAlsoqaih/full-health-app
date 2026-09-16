/**
 * Generates the app icons.
 *
 * Why a generator rather than checked-in artwork: the manifest in vite.config.ts
 * names pwa-192.png, pwa-512.png and pwa-maskable-512.png, and public/ was empty
 * — so every icon in the shipped manifest resolved to a 404 and the app was not
 * installable at all. Chrome requires at least one fetchable icon of 192px or
 * more before it will offer "Install"; iOS ignores the manifest for its home
 * screen icon entirely and uses <link rel="apple-touch-icon"> instead, so that
 * one is generated too.
 *
 * These are PLACEHOLDERS — a legible mark in the product's own accent colour,
 * not a designed logo. Replace the PNGs (or edit the mark here) before launch.
 * They are checked in so a clone builds an installable app without running this.
 *
 * No image library is used because none is a dependency, and adding one to draw
 * four rectangles would be the wrong trade. PNG's baseline encoding is a zlib
 * stream of filtered scanlines, which node:zlib already provides.
 *
 * Run: npm run icons --workspace frontend
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { colors } from '../src/shared/theme/tokens.ts';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** Linear blend, `amount` being how much of `a` survives. */
function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  const at = (x: number, y: number) => Math.round(x * amount + y * (1 - amount));
  return { r: at(a.r, b.r), g: at(a.g, b.g), b: at(a.b, b.b) };
}

// The dark scheme's colours, because an icon sits on the OS's own background and
// a dark mark reads on both light and dark home screens.
const BACKGROUND = hexToRgb(colors.dark.bg);
const MARK = hexToRgb(colors.dark.accent);
// The shorter bars are the accent mixed back toward the background. Using the
// `accent-soft` token directly looked right in the editor and vanished in the
// icon: it is designed as a tint behind text, and at 12% luminance difference
// from `bg` the bars were invisible at 192px.
const MARK_DIM = mix(MARK, BACKGROUND, 0.45);

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes 8-bit RGB pixel data (no alpha — icons are opaque squares). */
function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type 2 = truecolour RGB
  ihdr.writeUInt8(0, 10); // deflate
  ihdr.writeUInt8(0, 11); // adaptive filtering
  ihdr.writeUInt8(0, 12); // no interlace

  // Each scanline is prefixed with its filter type; 0 means "none", which costs
  // a little size and keeps this readable.
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// The mark
// ---------------------------------------------------------------------------

/**
 * Three ascending bars — progress, which is what the app is about.
 *
 * Drawn inside a `safe` fraction of the canvas. For a maskable icon the OS may
 * crop to a circle inscribed in the square, so anything outside the central 80%
 * can be cut; the spec's guidance is to keep content within that zone. Using the
 * same inset for every size means all four icons look like the same mark.
 */
function drawMark(size: number, safe: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 3);

  const put = (x: number, y: number, color: Rgb): void => {
    const offset = (y * size + x) * 3;
    pixels[offset] = color.r;
    pixels[offset + 1] = color.g;
    pixels[offset + 2] = color.b;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) put(x, y, BACKGROUND);
  }

  const inset = Math.round((size * (1 - safe)) / 2);
  const zone = size - inset * 2;

  // Three bars with a gap of half a bar's width between them.
  const gap = Math.max(1, Math.round(zone / 12));
  const barWidth = Math.round((zone - gap * 2) / 3);
  const heights = [0.45, 0.72, 1].map((fraction) => Math.round(zone * fraction));

  heights.forEach((barHeight, index) => {
    const left = inset + index * (barWidth + gap);
    const bottom = inset + zone;
    const top = bottom - barHeight;
    // The tallest bar is the accent; the shorter two are dimmed, so the mark
    // still has shape when rendered small enough that colour is all you see.
    const color = index === heights.length - 1 ? MARK : MARK_DIM;

    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < left + barWidth; x += 1) {
        if (x >= 0 && x < size && y >= 0 && y < size) put(x, y, color);
      }
    }
  });

  return pixels;
}

function write(name: string, size: number, safe: number): void {
  const file = resolve(OUT_DIR, name);
  writeFileSync(file, encodePng(size, size, drawMark(size, safe)));
  console.log(`wrote ${name} (${size}×${size})`);
}

function writeFaviconSvg(): void {
  const bg = colors.dark.bg;
  // Same proportions as drawMark, expressed in a 64-unit viewBox.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Full Health">
  <rect width="64" height="64" rx="12" fill="${bg}"/>
  <rect x="12" y="34" width="11" height="18" rx="2" fill="${rgbToHex(MARK_DIM)}"/>
  <rect x="26.5" y="25" width="11" height="27" rx="2" fill="${rgbToHex(MARK_DIM)}"/>
  <rect x="41" y="14" width="11" height="38" rx="2" fill="${colors.dark.accent}"/>
</svg>
`;
  writeFileSync(resolve(OUT_DIR, 'favicon.svg'), svg);
  console.log('wrote favicon.svg');
}

mkdirSync(OUT_DIR, { recursive: true });

// Regular icons use most of the canvas; the maskable one keeps well inside the
// crop circle, which is the whole difference between the two.
write('pwa-192.png', 192, 0.72);
write('pwa-512.png', 512, 0.72);
write('pwa-maskable-512.png', 512, 0.52);
// iOS applies its own rounding and ignores the manifest, so this is a separate,
// full-bleed square referenced from index.html.
write('apple-touch-icon.png', 180, 0.72);
writeFaviconSvg();
