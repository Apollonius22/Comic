import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';

const { GIFEncoder, applyPalette, quantize } = gifenc;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const delayMs = Math.max(100, Number(args.delay ?? 2) * 1000);
const outputWidth = Math.max(320, Number(args.width ?? 900));
const output = join(root, args.out ?? 'src/assets/exports/comic.gif');
const mode = args.mode === 'single' ? 'single' : 'spread';
const background = hexToRgb(args.background ?? '#11100f');
const flipFrames = Math.max(0, Number(args.flipFrames ?? 14));
const flipFrameDelay = Math.max(20, Number(args.flipDelay ?? 55));
const pageRatio = Number(args.pageRatio ?? 1.5);
const pageGap = mode === 'spread' ? Math.max(0, Number(args.pageGap ?? 0)) : 0;
const canvasWidth = outputWidth;
const slotWidth = mode === 'spread' ? Math.floor((canvasWidth - pageGap) / 2) : canvasWidth;
const canvasHeight = Math.round(slotWidth * pageRatio);
const cssScale = slotWidth / 520;
const contentTopBottomInset = scaledCss(28);
const contentOuterInset = scaledCss(22);
const contentInnerInset = scaledCss(4);
const blankSideInset = scaledCss(14);
const coverLikeRoles = new Set(['front-cover', 'inside-cover', 'back-cover']);
const underlayRoles = new Set(['content', 'blank']);

const comic = getComicPages();
comic.insideLeftImage = comic.insideLeft ? readPng(comic.insideLeft) : null;
comic.insideRightImage = comic.insideRight ? readPng(comic.insideRight) : null;
const pageItems = createPageItems(comic);
const frames = mode === 'single'
  ? pageItems.map(page => ({ left: null, right: page }))
  : createBookFrames(pageItems);
const gif = GIFEncoder();

if (pageItems.length === 0) {
  throw new Error('No comic pages found in src/assets/comics.');
}

for (let index = 0; index < frames.length; index += 1) {
  writeGifFrame(drawFrame(frames[index]), delayMs);

  if (mode === 'spread' && flipFrames > 0 && frames[index + 1]) {
    for (let step = 1; step <= flipFrames; step += 1) {
      writeGifFrame(drawFlipFrame(frames[index], frames[index + 1], step / (flipFrames + 1)), flipFrameDelay);
    }
  }
}

gif.finish();
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, gif.bytes());

console.log(`Exported ${frames.length} ${mode} frames to ${output}`);
console.log(`Delay per frame: ${delayMs / 1000}s`);
console.log(`Flip frames between spreads: ${mode === 'spread' ? flipFrames : 0}`);
console.log(`Output size: ${canvasWidth}x${canvasHeight}`);

function getComicPages() {
  const base = join(root, 'src/assets/comics');
  const bookends = join(base, 'bookends');
  const chapter = join(base, 'chapter1');

  return {
    cover: existingPath(join(bookends, 'cover.png')),
    insideLeft: existingPath(join(bookends, 'inside_left.png')),
    insideRight: existingPath(join(bookends, 'inside_right.png')),
    blank: existingPath(join(bookends, 'blank.png')),
    end: existingPath(join(bookends, 'end.png')),
    chapterPages: readdirSync(chapter)
      .filter(file => /^page_\d+\.png$/i.test(file))
      .sort((a, b) => pageNumber(a) - pageNumber(b))
      .map(file => join(chapter, file)),
  };
}

function createPageItems({ cover, insideLeft, chapterPages, blank, insideRight, end }) {
  return [
    cover && createPage(cover, 'front-cover', 'Front cover'),
    insideLeft && createPage(insideLeft, 'inside-cover', 'Inside front cover', 'left'),
    ...chapterPages.map((path, index) => createPage(
      path,
      'content',
      `Comic page ${index + 1}`,
      index % 2 === 0 ? 'right' : 'left'
    )),
    blank && createPage(blank, 'blank', 'Blank page', 'left'),
    insideRight && createPage(insideRight, 'inside-cover', 'Inside back cover', 'right'),
    end && createPage(end, 'back-cover', 'Back cover'),
  ].filter(Boolean);
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

function createBookFrames(items) {
  const [cover, ...rest] = items;
  const frames = [];

  if (cover?.role === 'front-cover') {
    frames.push({ left: null, right: cover });
  }

  const body = cover?.role === 'front-cover' ? rest : items;
  const end = body.at(-1)?.role === 'back-cover' ? body.at(-1) : null;
  const bodyWithoutEnd = end ? body.slice(0, -1) : body;

  for (let index = 0; index < bodyWithoutEnd.length; index += 2) {
    frames.push({ left: bodyWithoutEnd[index] ?? null, right: bodyWithoutEnd[index + 1] ?? null });
  }

  if (end) {
    frames.push({ left: end, right: null });
  }

  return frames;
}

function drawFrame(frame) {
  const rgba = createCanvas(canvasWidth, canvasHeight, background);

  if (mode === 'single') {
    drawPage(rgba, frame.right, 0, 0, canvasWidth, canvasHeight, 'right');
  } else {
    drawSpread(rgba, frame);
  }

  return rgba;
}

function drawFlipFrame(current, next, progress) {
  const rgba = createCanvas(canvasWidth, canvasHeight, background);
  const eased = easeInOutCubic(progress);
  const underlayFrame = underlaySignature(current) === underlaySignature(next) ? current : next;
  const baseFrame = eased < 0.5 ? current : next;

  drawUnderlays(rgba, underlayFrame);
  drawSpreadPages(rgba, baseFrame);

  if (eased < 0.5) {
    const fold = eased / 0.5;
    const width = Math.max(2, Math.round(slotWidth * (1 - fold)));
    drawTurningPage(rgba, current.right ?? current.left, slotWidth + pageGap, 0, width, canvasHeight, 'right');
  } else {
    const fold = (eased - 0.5) / 0.5;
    const width = Math.max(2, Math.round(slotWidth * fold));
    drawTurningPaperBack(rgba, slotWidth - width, 0, width, canvasHeight);
  }

  return rgba;
}

function drawSpread(target, frame) {
  drawUnderlays(target, frame);
  drawSpreadPages(target, frame);
}

function drawUnderlays(target, frame) {
  if (shouldShowUnderlayBehind(frame.left)) {
    drawImageStretch(target, canvasWidth, canvasHeight, comic.insideLeftImage, 0, 0, slotWidth, canvasHeight);
  }

  if (shouldShowUnderlayBehind(frame.right)) {
    drawImageStretch(target, canvasWidth, canvasHeight, comic.insideRightImage, slotWidth + pageGap, 0, slotWidth, canvasHeight);
  }
}

function drawSpreadPages(target, frame) {
  if (frame.left) {
    drawPage(target, frame.left, 0, 0, slotWidth, canvasHeight, 'left');
  }

  if (frame.right) {
    drawPage(target, frame.right, slotWidth + pageGap, 0, slotWidth, canvasHeight, 'right');
  }
}

function drawPage(target, page, x, y, width, height, slotSide) {
  if (!page) {
    return;
  }

  if (coverLikeRoles.has(page.role)) {
    drawContain(target, canvasWidth, canvasHeight, page.image, x, y, width, height);
    return;
  }

  const visual = getPageVisualRect(page, x, y, width, height, slotSide);

  if (page.role === 'content') {
    drawPaperWindowShadow(target, visual.x, visual.y, visual.width, visual.height);
    fillRect(target, canvasWidth, canvasHeight, visual.x, visual.y, visual.width, visual.height, background);
  }

  drawContain(target, canvasWidth, canvasHeight, page.image, visual.x, visual.y, visual.width, visual.height);
}

function drawTurningPage(target, page, x, y, width, height, side) {
  if (!page) {
    drawTurningPaperBack(target, x, y, width, height);
    return;
  }

  if (coverLikeRoles.has(page.role)) {
    drawImageStretch(target, canvasWidth, canvasHeight, page.image, x, y, width, height);
  } else {
    fillRect(target, canvasWidth, canvasHeight, x, y, width, height, background);
    drawImageStretch(target, canvasWidth, canvasHeight, page.image, x, y, width, height);
  }

  drawFoldShade(target, x, y, width, height, side);
}

function drawTurningPaperBack(target, x, y, width, height) {
  fillRect(target, canvasWidth, canvasHeight, x, y, width, height, background);
  drawFoldShade(target, x, y, width, height, 'left');
}

function getPageVisualRect(page, x, y, width, height, slotSide) {
  if (page.role === 'blank') {
    return {
      x: x + blankSideInset,
      y: y + contentTopBottomInset,
      width: width - 2 * blankSideInset,
      height: height - 2 * contentTopBottomInset,
    };
  }

  if (page.role !== 'content') {
    return { x, y, width, height };
  }

  const side = page.side ?? slotSide;
  const leftInset = side === 'left' ? contentOuterInset : contentInnerInset;
  const rightInset = side === 'left' ? contentInnerInset : contentOuterInset;

  return {
    x: x + leftInset,
    y: y + contentTopBottomInset,
    width: width - leftInset - rightInset,
    height: height - 2 * contentTopBottomInset,
  };
}

function shouldShowUnderlayBehind(page) {
  return page?.role === 'content' || page?.role === 'blank';
}

function underlaySignature(frame) {
  return `${shouldShowUnderlayBehind(frame.left) ? 'L' : '-'}${shouldShowUnderlayBehind(frame.right) ? 'R' : '-'}`;
}

function drawPaperWindowShadow(target, x, y, width, height) {
  const shadow = Math.max(2, scaledCss(8));

  for (let offset = shadow; offset > 0; offset -= 1) {
    const alpha = 0.02 * (offset / shadow);
    drawRectAlpha(target, canvasWidth, canvasHeight, x, y + offset, width, height, { r: 0, g: 0, b: 0 }, alpha);
  }
}

function drawFoldShade(target, x, y, width, height, side) {
  const maxAlpha = 0.28;
  const safeWidth = Math.max(1, width);

  for (let col = 0; col < safeWidth; col += 1) {
    const progress = col / safeWidth;
    const alpha = side === 'right'
      ? maxAlpha * (1 - progress)
      : maxAlpha * progress;

    for (let row = y; row < y + height && row < canvasHeight; row += 1) {
      const dstX = x + col;

      if (dstX < 0 || dstX >= canvasWidth) {
        continue;
      }

      const index = (row * canvasWidth + dstX) * 4;
      target[index] = blend(0, target[index], alpha);
      target[index + 1] = blend(0, target[index + 1], alpha);
      target[index + 2] = blend(0, target[index + 2], alpha);
    }
  }
}

function writeGifFrame(rgba, delay) {
  const palette = quantize(rgba, 256);
  const index = applyPalette(rgba, palette);
  gif.writeFrame(index, canvasWidth, canvasHeight, {
    palette,
    delay,
    repeat: 0,
  });
}

function createCanvas(width, height, color) {
  const rgba = new Uint8Array(width * height * 4);

  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = color.r;
    rgba[index + 1] = color.g;
    rgba[index + 2] = color.b;
    rgba[index + 3] = 255;
  }

  return rgba;
}

function readPng(path) {
  const png = PNG.sync.read(readFileSync(path));
  return {
    path,
    width: png.width,
    height: png.height,
    data: png.data,
  };
}

function drawContain(target, targetWidth, targetHeight, image, x, y, width, height, contentScale = 1) {
  const scale = Math.min(width / image.width, height / image.height) * contentScale;
  const drawWidth = Math.max(1, Math.round(image.width * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  const offsetX = x + Math.floor((width - drawWidth) / 2);
  const offsetY = y + Math.floor((height - drawHeight) / 2);

  drawImageScaled(target, targetWidth, targetHeight, image, offsetX, offsetY, drawWidth, drawHeight);
}

function drawImageStretch(target, targetWidth, targetHeight, image, x, y, width, height) {
  drawImageScaled(target, targetWidth, targetHeight, image, x, y, width, height);
}

function drawImageScaled(target, targetWidth, targetHeight, image, x, y, width, height) {
  if (!image) {
    return;
  }

  for (let row = 0; row < height; row += 1) {
    const srcY = Math.min(image.height - 1, Math.floor((row / height) * image.height));

    for (let col = 0; col < width; col += 1) {
      const srcX = Math.min(image.width - 1, Math.floor((col / width) * image.width));
      const srcIndex = (srcY * image.width + srcX) * 4;
      const dstX = x + col;
      const dstY = y + row;

      if (dstX < 0 || dstX >= targetWidth || dstY < 0 || dstY >= targetHeight) {
        continue;
      }

      const dstIndex = (dstY * targetWidth + dstX) * 4;
      const alpha = image.data[srcIndex + 3] / 255;

      target[dstIndex] = blend(image.data[srcIndex], target[dstIndex], alpha);
      target[dstIndex + 1] = blend(image.data[srcIndex + 1], target[dstIndex + 1], alpha);
      target[dstIndex + 2] = blend(image.data[srcIndex + 2], target[dstIndex + 2], alpha);
      target[dstIndex + 3] = 255;
    }
  }
}

function fillRect(target, targetWidth, targetHeight, x, y, width, height, color) {
  for (let row = y; row < y + height && row < targetHeight; row += 1) {
    for (let col = x; col < x + width && col < targetWidth; col += 1) {
      const index = (row * targetWidth + col) * 4;
      target[index] = color.r;
      target[index + 1] = color.g;
      target[index + 2] = color.b;
      target[index + 3] = 255;
    }
  }
}

function drawRectAlpha(target, targetWidth, targetHeight, x, y, width, height, color, alpha) {
  for (let row = y; row < y + height && row < targetHeight; row += 1) {
    for (let col = x; col < x + width && col < targetWidth; col += 1) {
      if (col < 0 || row < 0) {
        continue;
      }

      const index = (row * targetWidth + col) * 4;
      target[index] = blend(color.r, target[index], alpha);
      target[index + 1] = blend(color.g, target[index + 1], alpha);
      target[index + 2] = blend(color.b, target[index + 2], alpha);
      target[index + 3] = 255;
    }
  }
}

function blend(foreground, backgroundValue, alpha) {
  return Math.round(foreground * alpha + backgroundValue * (1 - alpha));
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function scaledCss(value) {
  return Math.max(0, Math.round(value * cssScale));
}

function pageNumber(file) {
  return Number(file.match(/\d+/)?.[0] ?? 0);
}

function existingPath(path) {
  return existsSync(path) ? path : null;
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
