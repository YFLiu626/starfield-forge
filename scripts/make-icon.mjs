import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outPath = resolve("build/icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];

mkdirSync(dirname(outPath), { recursive: true });

function makeRgba(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size * 0.48;
  const border = Math.max(2, Math.round(size * 0.055));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const dx = x - center;
      const dy = y - center;
      const d = Math.hypot(dx, dy);
      const vignette = Math.max(0, 1 - d / radius);
      pixels[idx] = Math.round(5 + vignette * 9);
      pixels[idx + 1] = Math.round(18 + vignette * 38);
      pixels[idx + 2] = Math.round(24 + vignette * 52);
      pixels[idx + 3] = 255;

      if (x < border || y < border || x >= size - border || y >= size - border) {
        pixels[idx] = 48;
        pixels[idx + 1] = 221;
        pixels[idx + 2] = 239;
      }
    }
  }

  const stars = [
    [0.21, 0.24, 0.8],
    [0.78, 0.2, 0.65],
    [0.16, 0.76, 0.72],
    [0.83, 0.73, 0.88],
    [0.62, 0.36, 0.5]
  ];
  for (const [sx, sy, alpha] of stars) {
    drawDisc(pixels, size, sx * size, sy * size, Math.max(1, size * 0.018), [210, 252, 255, alpha]);
  }

  drawSevenSegmentDigit(pixels, size, 3, size * 0.16, size * 0.32, size * 0.27, size * 0.42);
  drawSevenSegmentDigit(pixels, size, 0, size * 0.49, size * 0.32, size * 0.27, size * 0.42);
  return pixels;
}

function drawDisc(pixels, size, cx, cy, radius, color) {
  const [r, g, b, alpha] = color;
  const minX = Math.max(0, Math.floor(cx - radius * 2));
  const maxX = Math.min(size - 1, Math.ceil(cx + radius * 2));
  const minY = Math.max(0, Math.floor(cy - radius * 2));
  const maxY = Math.min(size - 1, Math.ceil(cy + radius * 2));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      const amount = Math.max(0, 1 - d / (radius * 2)) * alpha;
      if (amount <= 0) continue;
      const idx = (y * size + x) * 4;
      pixels[idx] = Math.round(pixels[idx] * (1 - amount) + r * amount);
      pixels[idx + 1] = Math.round(pixels[idx + 1] * (1 - amount) + g * amount);
      pixels[idx + 2] = Math.round(pixels[idx + 2] * (1 - amount) + b * amount);
    }
  }
}

function drawSevenSegmentDigit(pixels, size, digit, left, top, width, height) {
  const segments = {
    0: ["a", "b", "c", "d", "e", "f"],
    3: ["a", "b", "c", "d", "g"]
  }[digit];
  const t = Math.max(2, Math.round(size * 0.045));
  const color = [89, 231, 245, 0.95];
  const right = left + width;
  const bottom = top + height;
  const mid = top + height / 2;
  const inset = t * 0.7;

  const rects = {
    a: [left + inset, top, right - inset, top + t],
    b: [right - t, top + inset, right, mid - inset],
    c: [right - t, mid + inset, right, bottom - inset],
    d: [left + inset, bottom - t, right - inset, bottom],
    e: [left, mid + inset, left + t, bottom - inset],
    f: [left, top + inset, left + t, mid - inset],
    g: [left + inset, mid - t / 2, right - inset, mid + t / 2]
  };

  for (const segment of segments) {
    const [x1, y1, x2, y2] = rects[segment];
    drawRect(pixels, size, x1, y1, x2, y2, color);
  }
}

function drawRect(pixels, size, x1, y1, x2, y2, color) {
  const [r, g, b, alpha] = color;
  for (let y = Math.max(0, Math.floor(y1)); y < Math.min(size, Math.ceil(y2)); y += 1) {
    for (let x = Math.max(0, Math.floor(x1)); x < Math.min(size, Math.ceil(x2)); x += 1) {
      const idx = (y * size + x) * 4;
      pixels[idx] = Math.round(pixels[idx] * (1 - alpha) + r * alpha);
      pixels[idx + 1] = Math.round(pixels[idx + 1] * (1 - alpha) + g * alpha);
      pixels[idx + 2] = Math.round(pixels[idx + 2] * (1 - alpha) + b * alpha);
    }
  }
}

function makeIcoImage(size, rgba) {
  const xorBytes = size * size * 4;
  const maskStride = Math.ceil(size / 32) * 4;
  const maskBytes = maskStride * size;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(xorBytes + maskBytes, 20);
  header.writeInt32LE(2835, 24);
  header.writeInt32LE(2835, 28);

  const bgra = Buffer.alloc(xorBytes);
  for (let y = 0; y < size; y += 1) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x += 1) {
      const src = (srcY * size + x) * 4;
      const dst = (y * size + x) * 4;
      bgra[dst] = rgba[src + 2];
      bgra[dst + 1] = rgba[src + 1];
      bgra[dst + 2] = rgba[src];
      bgra[dst + 3] = rgba[src + 3];
    }
  }

  return Buffer.concat([header, bgra, Buffer.alloc(maskBytes)]);
}

const images = sizes.map((size) => ({ size, data: makeIcoImage(size, makeRgba(size)) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

const dir = Buffer.alloc(images.length * 16);
let offset = header.length + dir.length;
images.forEach((image, index) => {
  const base = index * 16;
  dir[base] = image.size >= 256 ? 0 : image.size;
  dir[base + 1] = image.size >= 256 ? 0 : image.size;
  dir[base + 2] = 0;
  dir[base + 3] = 0;
  dir.writeUInt16LE(1, base + 4);
  dir.writeUInt16LE(32, base + 6);
  dir.writeUInt32LE(image.data.length, base + 8);
  dir.writeUInt32LE(offset, base + 12);
  offset += image.data.length;
});

writeFileSync(outPath, Buffer.concat([header, dir, ...images.map((image) => image.data)]));
console.log(`Wrote ${outPath}`);
