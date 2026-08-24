import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PNG } from 'pngjs';

export function getComicPages(root) {
  const base = join(root, 'src/assets/comics');
  const bookends = join(base, 'bookends');

  return {
    cover: existingPath(join(bookends, 'cover.png')),
    insideLeft: existingPath(join(bookends, 'inside_left.png')),
    insideRight: existingPath(join(bookends, 'inside_right.png')),
    blank: existingPath(join(bookends, 'blank.png')),
    end: existingPath(join(bookends, 'end.png')),
    chapterPages: getChapterPages(base),
  };
}

export function createPageItems({ cover, insideLeft, chapterPages, blank, insideRight, end }) {
  const contentPages = chapterPages.map((path, index) => createPage(
    path,
    'content',
    `Comic page ${index + 1}`,
    index % 2 === 0 ? 'right' : 'left',
  ));
  const needsBlankPage = contentPages.length % 2 === 1;

  return [
    cover && createPage(cover, 'front-cover', 'Front cover'),
    insideLeft && createPage(insideLeft, 'inside-cover', 'Inside front cover', 'left'),
    ...contentPages,
    needsBlankPage && blank && createPage(blank, 'blank', 'Blank page', 'left'),
    insideRight && createPage(insideRight, 'inside-cover', 'Inside back cover', 'right'),
    end && createPage(end, 'back-cover', 'Back cover'),
  ].filter(Boolean);
}

export function createBookFrames(items) {
  const [cover, ...rest] = items;
  const frames = [];

  if (cover?.role === 'front-cover') {
    frames.push({ left: null, right: cover });
  }

  const body = cover?.role === 'front-cover' ? rest : items;
  const end = body.at(-1)?.role === 'back-cover' ? body.at(-1) : null;
  const bodyWithoutEnd = end ? body.slice(0, -1) : body;

  for (let index = 0; index < bodyWithoutEnd.length; index += 2) {
    frames.push({
      left: bodyWithoutEnd[index] ?? null,
      right: bodyWithoutEnd[index + 1] ?? null,
    });
  }

  if (end) {
    frames.push({ left: end, right: null });
  }

  return frames;
}

export function createCanvas(width, height, color) {
  const rgba = new Uint8Array(width * height * 4);

  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = color.r;
    rgba[index + 1] = color.g;
    rgba[index + 2] = color.b;
    rgba[index + 3] = 255;
  }

  return rgba;
}

export function readPng(path) {
  const png = PNG.sync.read(readFileSync(path));
  return {
    path,
    width: png.width,
    height: png.height,
    data: png.data,
  };
}

export function drawContain(
  target,
  targetWidth,
  targetHeight,
  image,
  x,
  y,
  width,
  height,
  contentScale = 1,
) {
  const scale = Math.min(width / image.width, height / image.height) * contentScale;
  const drawWidth = Math.max(1, Math.round(image.width * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  const drawX = x + Math.floor((width - drawWidth) / 2);
  const drawY = y + Math.floor((height - drawHeight) / 2);
  drawImageScaled(target, targetWidth, targetHeight, image, drawX, drawY, drawWidth, drawHeight);
}

export function drawImageStretch(target, targetWidth, targetHeight, image, x, y, width, height) {
  drawImageScaled(target, targetWidth, targetHeight, image, x, y, width, height);
}

export function drawImageScaled(target, targetWidth, targetHeight, image, x, y, width, height) {
  if (!image) {
    return;
  }

  for (let row = 0; row < height; row += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((row / height) * image.height));
    const targetY = y + row;

    if (targetY < 0 || targetY >= targetHeight) {
      continue;
    }

    for (let col = 0; col < width; col += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((col / width) * image.width));
      const targetX = x + col;

      if (targetX < 0 || targetX >= targetWidth) {
        continue;
      }

      const sourceIndex = (sourceY * image.width + sourceX) * 4;
      const targetIndex = (targetY * targetWidth + targetX) * 4;
      const alpha = image.data[sourceIndex + 3] / 255;

      target[targetIndex] = blend(image.data[sourceIndex], target[targetIndex], alpha);
      target[targetIndex + 1] = blend(image.data[sourceIndex + 1], target[targetIndex + 1], alpha);
      target[targetIndex + 2] = blend(image.data[sourceIndex + 2], target[targetIndex + 2], alpha);
      target[targetIndex + 3] = 255;
    }
  }
}

export function blend(foreground, backgroundValue, alpha) {
  return Math.round(foreground * alpha + backgroundValue * (1 - alpha));
}

export function hexToRgb(hex) {
  const normalized = hex.replace('#', '');

  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (!value.startsWith('--')) {
      continue;
    }

    const [rawKey, inlineValue] = value.slice(2).split('=');
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
    } else if (values[index + 1] && !values[index + 1].startsWith('--')) {
      parsed[key] = values[index + 1];
      index += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

function getChapterPages(base) {
  return readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^chapter\d+$/i.test(entry.name))
    .map(entry => join(base, entry.name))
    .sort((a, b) => chapterNumber(a) - chapterNumber(b))
    .flatMap(chapter => readdirSync(chapter)
      .filter(file => /^page_\d+\.png$/i.test(file))
      .sort((a, b) => pageNumber(a) - pageNumber(b))
      .map(file => join(chapter, file)));
}

function createPage(path, role, alt, side = null) {
  return {
    path,
    role,
    alt,
    side,
    image: readPng(path),
  };
}

function pageNumber(file) {
  return Number(file.match(/\d+/)?.[0] ?? 0);
}

function chapterNumber(folder) {
  return Number(basename(folder).match(/\d+/)?.[0] ?? 0);
}

function existingPath(path) {
  return existsSync(path) ? path : null;
}
