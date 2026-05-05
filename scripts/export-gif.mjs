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
const pageBackground = hexToRgb(args.pageBackground ?? '#d8c292');
const flipFrames = Math.max(0, Number(args.flipFrames ?? 14));
const flipFrameDelay = Math.max(20, Number(args.flipDelay ?? 55));
const pageRatio = Number(args.pageRatio ?? 1.5);

const { cover, insideLeft, chapterPages, blank, insideRight, end } = getComicPages();
const pages = [
  cover,
  insideLeft,
  ...chapterPages,
  blank,
  insideRight,
  end,
].filter(Boolean).map(readPng);

if (pages.length === 0) {
  throw new Error('No comic pages found in src/assets/comics.');
}

const frames = mode === 'single' ? pages.map(page => [page]) : createBookFrames({
  cover: cover ? readPng(cover) : null,
  insideLeft: insideLeft ? readPng(insideLeft) : null,
  chapterPages: chapterPages.map(readPng),
  blank: blank ? readPng(blank) : null,
  insideRight: insideRight ? readPng(insideRight) : null,
  end: end ? readPng(end) : null,
});
const canvasWidth = outputWidth;
const pageGap = mode === 'spread' ? Math.max(10, Math.round(outputWidth * 0.018)) : 0;
const slotWidth = mode === 'spread' ? Math.floor((canvasWidth - pageGap) / 2) : canvasWidth;
const canvasHeight = Math.round(slotWidth * pageRatio);
const gif = GIFEncoder();

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

function getComicPages() {
  const base = join(root, 'src/assets/comics');
  const bookends = join(base, 'bookends');
  const chapter = join(base, 'chapter1');
  const cover = join(bookends, 'cover.png');
  const insideLeft = join(bookends, 'inside_left.png');
  const blank = join(bookends, 'blank.png');
  const insideRight = join(bookends, 'inside_right.png');
  const end = join(bookends, 'end.png');

  return {
    cover: existsSync(cover) ? cover : null,
    insideLeft: existsSync(insideLeft) ? insideLeft : null,
    chapterPages: readdirSync(chapter)
      .filter(file => /^page_\d+\.png$/i.test(file))
      .sort((a, b) => pageNumber(a) - pageNumber(b))
      .map(file => join(chapter, file)),
    blank: existsSync(blank) ? blank : null,
    insideRight: existsSync(insideRight) ? insideRight : null,
    end: existsSync(end) ? end : null,
  };
}

function pageNumber(file) {
  return Number(file.match(/\d+/)?.[0] ?? 0);
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

function pairPages(items) {
  const pairs = [];

  for (let index = 0; index < items.length; index += 2) {
    pairs.push([items[index], items[index + 1]]);
  }

  return pairs;
}

function createBookFrames({ cover, insideLeft, chapterPages, blank, insideRight, end }) {
  const bookFrames = [];

  if (cover) {
    bookFrames.push([null, cover]);
  }

  const bodyPages = [
    insideLeft,
    ...chapterPages,
    blank,
    insideRight,
  ].filter(Boolean);

  if (end) {
    if (bodyPages.length % 2 === 1) {
      bodyPages.push(null);
    }

    for (let index = 0; index < bodyPages.length; index += 2) {
      bookFrames.push([bodyPages[index], bodyPages[index + 1]]);
    }

    bookFrames.push([end, null]);
  } else {
    for (let index = 0; index < bodyPages.length; index += 2) {
      bookFrames.push([bodyPages[index], bodyPages[index + 1] ?? null]);
    }
  }

  return bookFrames;
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

function drawFrame(frame) {
  const rgba = createCanvas(canvasWidth, canvasHeight, background);

  if (mode === 'single') {
    drawContain(rgba, canvasWidth, canvasHeight, frame[0], 0, 0, canvasWidth, canvasHeight);
  } else {
    drawSpread(rgba, frame, { fillEmpty: false });
  }

  return rgba;
}

function drawFlipFrame(current, next, progress) {
  const rgba = createCanvas(canvasWidth, canvasHeight, background);
  const eased = easeInOutCubic(progress);
  const rightX = slotWidth + pageGap;

  if (eased < 0.5) {
    drawSpread(rgba, current, { fillEmpty: false });
  } else {
    drawSpread(rgba, next, { fillEmpty: false });
  }

  if (eased < 0.5) {
    const fold = eased / 0.5;
    const width = Math.max(2, Math.round(slotWidth * (1 - fold)));
    drawPaper(rgba, rightX, 0, width, canvasHeight);
    if (current[1] ?? current[0]) {
      drawImageStretch(rgba, canvasWidth, canvasHeight, current[1] ?? current[0], rightX, 0, width, canvasHeight);
    }
  } else {
    const fold = (eased - 0.5) / 0.5;
    const width = Math.max(2, Math.round(slotWidth * fold));
    const x = slotWidth - width;
    drawPaper(rgba, x, 0, width, canvasHeight);
  }

  return rgba;
}

function drawSpread(target, frame, options = { fillEmpty: false }) {
  if (frame[0]) {
    drawPageSlot(target, canvasWidth, canvasHeight, frame[0], 0, 0, slotWidth, canvasHeight);
  } else if (options.fillEmpty) {
    drawPaper(target, 0, 0, slotWidth, canvasHeight);
  }

  if (frame[1]) {
    drawPageSlot(target, canvasWidth, canvasHeight, frame[1], slotWidth + pageGap, 0, slotWidth, canvasHeight);
  } else if (options.fillEmpty) {
    drawPaper(target, slotWidth + pageGap, 0, slotWidth, canvasHeight);
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

function drawPageSlot(target, targetWidth, targetHeight, image, x, y, width, height) {
  fillRect(target, targetWidth, targetHeight, x, y, width, height, pageBackground);
  drawContain(target, targetWidth, targetHeight, image, x, y, width, height);
}

function drawPaper(target, x, y, width, height) {
  fillRect(target, canvasWidth, canvasHeight, x, y, width, height, pageBackground);
}

function drawContain(target, targetWidth, targetHeight, image, x, y, width, height, contentScale = 1) {
  const scale = Math.min(width / image.width, height / image.height) * contentScale;
  const drawWidth = Math.max(1, Math.round(image.width * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  const offsetX = x + Math.floor((width - drawWidth) / 2);
  const offsetY = y + Math.floor((height - drawHeight) / 2);

  for (let row = 0; row < drawHeight; row += 1) {
    const srcY = Math.min(image.height - 1, Math.floor(row / scale));

    for (let col = 0; col < drawWidth; col += 1) {
      const srcX = Math.min(image.width - 1, Math.floor(col / scale));
      const srcIndex = (srcY * image.width + srcX) * 4;
      const dstIndex = ((offsetY + row) * targetWidth + offsetX + col) * 4;
      const alpha = image.data[srcIndex + 3] / 255;

      target[dstIndex] = blend(image.data[srcIndex], target[dstIndex], alpha);
      target[dstIndex + 1] = blend(image.data[srcIndex + 1], target[dstIndex + 1], alpha);
      target[dstIndex + 2] = blend(image.data[srcIndex + 2], target[dstIndex + 2], alpha);
      target[dstIndex + 3] = 255;
    }
  }
}

function drawImageStretch(target, targetWidth, targetHeight, image, x, y, width, height) {
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

function drawBookGutter(target) {
  const center = slotWidth;
  const width = Math.max(8, pageGap);
  drawShadow(target, center, Math.floor(width / 2), 0.22, 'right');
  drawShadow(target, center + Math.floor(width / 2), Math.ceil(width / 2), 0.22, 'left');
}

function drawShadow(target, x, width, opacity, direction) {
  const safeWidth = Math.max(1, width);

  for (let col = 0; col < safeWidth; col += 1) {
    const distance = direction === 'left' ? col / safeWidth : 1 - col / safeWidth;
    const alpha = Math.max(0, Math.min(0.55, opacity * distance));

    for (let row = 0; row < canvasHeight; row += 1) {
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

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
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

function blend(foreground, backgroundValue, alpha) {
  return Math.round(foreground * alpha + backgroundValue * (1 - alpha));
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
