import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const width = Math.max(320, Number(args.width ?? 1024));
const height = Math.max(480, Number(args.height ?? 1536));
const background = hexToRgb(args.background ?? '#d8c292');
const contentScale = Math.min(1, Math.max(0.6, Number(args.contentScale ?? 1)));
const pageHeightScale = Math.min(1, Math.max(0.6, Number(args.pageHeightScale ?? 1)));
const chapter = join(root, 'src/assets/comics/chapter1');
const backup = join(chapter, '_original_sizes');
const pages = readdirSync(chapter)
  .filter(file => /^page_\d+\.png$/i.test(file))
  .sort((a, b) => pageNumber(a) - pageNumber(b));

mkdirSync(backup, { recursive: true });

for (const file of pages) {
  const path = join(chapter, file);
  const backupPath = join(backup, file);
  const image = PNG.sync.read(readFileSync(existsSync(backupPath) ? backupPath : path));

  if (!existsSync(backupPath)) {
    writeFileSync(backupPath, PNG.sync.write(image));
  }

  const resized = createPng(width, height, background);
  const pageHeight = Math.round(height * pageHeightScale);
  drawContain(resized, image, 0, height - pageHeight, width, pageHeight, contentScale);
  writeFileSync(path, PNG.sync.write(resized));
}

console.log(`Normalized ${pages.length} pages to ${width}x${height}`);
console.log(`Chapter page artwork scale: ${Math.round(contentScale * 100)}%`);
console.log(`Chapter page height scale: ${Math.round(pageHeightScale * 100)}%`);
console.log(`Originals are backed up in ${backup}`);

function createPng(targetWidth, targetHeight, color) {
  const png = new PNG({ width: targetWidth, height: targetHeight });

  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = color.r;
    png.data[index + 1] = color.g;
    png.data[index + 2] = color.b;
    png.data[index + 3] = 255;
  }

  return png;
}

function drawContain(target, image, x, y, targetWidth, targetHeight, scaleMultiplier = 1) {
  const scale = Math.min(targetWidth / image.width, targetHeight / image.height) * scaleMultiplier;
  const drawWidth = Math.max(1, Math.round(image.width * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  const offsetX = x + Math.floor((targetWidth - drawWidth) / 2);
  const offsetY = y + Math.floor((targetHeight - drawHeight) / 2);

  for (let row = 0; row < drawHeight; row += 1) {
    const srcY = Math.min(image.height - 1, Math.floor(row / scale));

    for (let col = 0; col < drawWidth; col += 1) {
      const srcX = Math.min(image.width - 1, Math.floor(col / scale));
      const srcIndex = (srcY * image.width + srcX) * 4;
      const dstIndex = ((offsetY + row) * target.width + offsetX + col) * 4;
      const alpha = image.data[srcIndex + 3] / 255;

      target.data[dstIndex] = blend(image.data[srcIndex], target.data[dstIndex], alpha);
      target.data[dstIndex + 1] = blend(image.data[srcIndex + 1], target.data[dstIndex + 1], alpha);
      target.data[dstIndex + 2] = blend(image.data[srcIndex + 2], target.data[dstIndex + 2], alpha);
      target.data[dstIndex + 3] = 255;
    }
  }
}

function blend(foreground, backgroundValue, alpha) {
  return Math.round(foreground * alpha + backgroundValue * (1 - alpha));
}

function pageNumber(file) {
  return Number(file.match(/\d+/)?.[0] ?? 0);
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');

  if (!/^[a-f\d]{6}$/i.test(value)) {
    throw new Error(`Invalid color: ${hex}`);
  }

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];

    if (!item.startsWith('--')) {
      continue;
    }

    const [key, inlineValue] = item.slice(2).split('=');
    parsed[key] = inlineValue ?? values[index + 1] ?? true;

    if (!inlineValue) {
      index += 1;
    }
  }

  return parsed;
}
