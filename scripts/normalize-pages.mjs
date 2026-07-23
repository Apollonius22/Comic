import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const width = Math.max(320, Number(args.width ?? 1024));
const height = Math.max(480, Number(args.height ?? 1536));
const background = hexToRgb(args.background ?? '#d8c292');
const borderColor = hexToRgb(args.borderColor ?? '#f5ead2');
const border = Math.max(0, Math.round(Number(args.border ?? 7)));
const textureStrength = Math.min(1, Math.max(0, Number(args.textureStrength ?? 0.55)));
const contentScale = Math.min(1, Math.max(0.6, Number(args.contentScale ?? 1)));
const pageHeightScale = Math.min(1, Math.max(0.6, Number(args.pageHeightScale ?? 1)));
const comics = join(root, 'src/assets/comics');
const chapters = getChapterFolders(comics, args.chapter);
let normalizedPages = 0;

for (const chapter of chapters) {
  normalizedPages += normalizeChapter(chapter);
}

console.log(`Normalized ${normalizedPages} pages to ${width}x${height}`);
console.log(`Paper border: ${border}px`);
console.log(`Paper texture strength: ${Math.round(textureStrength * 100)}%`);
console.log(`Chapter page artwork scale: ${Math.round(contentScale * 100)}%`);
console.log(`Chapter page height scale: ${Math.round(pageHeightScale * 100)}%`);

function getChapterFolders(comicsPath, requestedChapter) {
  if (requestedChapter) {
    const chapterName = String(requestedChapter).startsWith('chapter')
      ? String(requestedChapter)
      : `chapter${requestedChapter}`;

    return [join(comicsPath, chapterName)];
  }

  return readdirSync(comicsPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^chapter\d+$/i.test(entry.name))
    .map(entry => join(comicsPath, entry.name))
    .sort((a, b) => chapterNumber(a) - chapterNumber(b));
}

function normalizeChapter(chapter) {
  const backup = join(chapter, '_original_sizes');
  const fitMode = getChapterFitMode(chapter);
  const pages = readdirSync(chapter)
    .filter(file => /^page_\d+\.png$/i.test(file))
    .sort((a, b) => pageNumber(a) - pageNumber(b));

  if (pages.length === 0) {
    return 0;
  }

  mkdirSync(backup, { recursive: true });

  for (const file of pages) {
    const path = join(chapter, file);
    const backupPath = join(backup, file);
    const image = PNG.sync.read(readFileSync(existsSync(backupPath) ? backupPath : path));

    if (!existsSync(backupPath)) {
      writeFileSync(backupPath, PNG.sync.write(image));
    }

    if (image.width === width && image.height === height) {
      writeFileSync(path, PNG.sync.write(image));
      continue;
    }

    const resized = createPng(width, height, background);
    const pageHeight = Math.round(height * pageHeightScale);
    const pageY = height - pageHeight;
    const safeBorder = Math.min(
      border,
      Math.floor((width - 1) / 2),
      Math.floor((pageHeight - 1) / 2),
    );
    const artworkWidth = width - safeBorder * 2;
    const artworkHeight = pageHeight - safeBorder * 2;
    const seed = chapterNumber(chapter) * 1000 + pageNumber(file);

    fillPaperTexture(resized, 0, pageY, width, pageHeight, borderColor, seed, textureStrength);
    drawArtwork(resized, image, safeBorder, pageY + safeBorder, artworkWidth, artworkHeight, contentScale, fitMode);
    writeFileSync(path, PNG.sync.write(resized));
  }

  console.log(`${basename(chapter)}: normalized ${pages.length} pages (${fitMode})`);

  return pages.length;
}

function getChapterFitMode(chapter) {
  return 'cover';
}

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

function fillPaperTexture(target, x, y, targetWidth, targetHeight, color, seed, strength) {
  for (let row = 0; row < targetHeight; row += 1) {
    for (let col = 0; col < targetWidth; col += 1) {
      const fineGrain = (noise2d(col, row, seed) - 0.5) * 28 * strength;
      const fiber = (noise2d(Math.floor(col / 4), Math.floor(row / 28), seed + 71) - 0.5) * 18 * strength;
      const stainNoise = noise2d(Math.floor(col / 64), Math.floor(row / 64), seed + 139);
      const stain = Math.max(0, stainNoise - 0.7) * 62 * strength;
      const edgeDistance = Math.min(col, row, targetWidth - 1 - col, targetHeight - 1 - row);
      const edgeAge = Math.max(0, 1 - edgeDistance / 58) * 18 * strength;
      const dstIndex = ((y + row) * target.width + x + col) * 4;

      target.data[dstIndex] = clamp(color.r + fineGrain + stain - edgeAge * 0.7);
      target.data[dstIndex + 1] = clamp(color.g + fineGrain * 0.72 + stain * 0.58 - edgeAge);
      target.data[dstIndex + 2] = clamp(color.b + fineGrain * 0.36 - stain * 0.38 - edgeAge * 1.25);
      target.data[dstIndex + 3] = 255;
    }
  }
}

function drawArtwork(target, image, x, y, targetWidth, targetHeight, scaleMultiplier = 1, fitMode = 'cover') {
  if (fitMode === 'contain') {
    drawContainedArtwork(target, image, x, y, targetWidth, targetHeight, scaleMultiplier);
    return;
  }

  drawCoverArtwork(target, image, x, y, targetWidth, targetHeight, scaleMultiplier);
}

function drawCoverArtwork(target, image, x, y, targetWidth, targetHeight, scaleMultiplier = 1) {
  const scale = Math.max(targetWidth / image.width, targetHeight / image.height) * scaleMultiplier;
  const drawWidth = Math.max(1, Math.round(image.width * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  const offsetX = x + Math.floor((targetWidth - drawWidth) / 2);
  const offsetY = y + Math.floor((targetHeight - drawHeight) / 2);

  for (let row = 0; row < targetHeight; row += 1) {
    const srcY = Math.min(image.height - 1, Math.max(0, Math.floor((row - offsetY + y) / scale)));

    for (let col = 0; col < targetWidth; col += 1) {
      const srcX = Math.min(image.width - 1, Math.max(0, Math.floor((col - offsetX + x) / scale)));
      const srcIndex = (srcY * image.width + srcX) * 4;
      const dstIndex = ((y + row) * target.width + x + col) * 4;
      const alpha = image.data[srcIndex + 3] / 255;

      target.data[dstIndex] = blend(image.data[srcIndex], target.data[dstIndex], alpha);
      target.data[dstIndex + 1] = blend(image.data[srcIndex + 1], target.data[dstIndex + 1], alpha);
      target.data[dstIndex + 2] = blend(image.data[srcIndex + 2], target.data[dstIndex + 2], alpha);
      target.data[dstIndex + 3] = 255;
    }
  }
}

function drawContainedArtwork(target, image, x, y, targetWidth, targetHeight, scaleMultiplier = 1) {
  const scale = Math.min(targetWidth / image.width, targetHeight / image.height) * scaleMultiplier;
  const drawWidth = Math.max(1, Math.round(image.width * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  const offsetX = x + Math.floor((targetWidth - drawWidth) / 2);
  const offsetY = y + Math.floor((targetHeight - drawHeight) / 2);

  for (let row = 0; row < drawHeight; row += 1) {
    const srcY = Math.min(image.height - 1, Math.max(0, Math.floor(row / scale)));

    for (let col = 0; col < drawWidth; col += 1) {
      const srcX = Math.min(image.width - 1, Math.max(0, Math.floor(col / scale)));
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

function noise2d(x, y, seed) {
  let value = x * 374761393 + y * 668265263 + seed * 2147483647;
  value = (value ^ (value >>> 13)) * 1274126177;
  value = value ^ (value >>> 16);

  return (value >>> 0) / 4294967295;
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function pageNumber(file) {
  return Number(file.match(/\d+/)?.[0] ?? 0);
}

function chapterNumber(folder) {
  return Number(basename(folder).match(/\d+/)?.[0] ?? 0);
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
