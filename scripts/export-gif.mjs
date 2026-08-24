import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import gifenc from 'gifenc';
import {
  blend,
  createBookFrames,
  createCanvas,
  createPageItems,
  drawContain,
  drawImageScaled,
  drawImageStretch,
  getComicPages,
  hexToRgb,
  parseArgs,
  readPng,
} from './lib/comic-export.mjs';

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

const comic = getComicPages(root);
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
console.log(`Content pages: ${comic.chapterPages.length}`);
console.log(`Conditional blank page: ${comic.chapterPages.length % 2 === 1 ? 'yes' : 'no'}`);
console.log(`Delay per frame: ${delayMs / 1000}s`);
console.log(`Flip frames between spreads: ${mode === 'spread' ? flipFrames : 0}`);
console.log(`Output size: ${canvasWidth}x${canvasHeight}`);

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
  const outgoingPage = current.right ?? current.left;
  const incomingPage = next.left ?? next.right;

  drawUnderlays(rgba, underlayFrame);
  drawSpreadPages(rgba, baseFrame);

  if (eased < 0.5) {
    const fold = eased / 0.5;
    const width = Math.max(2, Math.round(slotWidth * (1 - fold)));
    drawTurningPage(rgba, outgoingPage, slotWidth + pageGap, 0, width, canvasHeight, 'right');
  } else {
    const fold = (eased - 0.5) / 0.5;
    const width = Math.max(2, Math.round(slotWidth * fold));
    drawTurningPage(rgba, incomingPage, slotWidth - width, 0, width, canvasHeight, 'left');
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

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function scaledCss(value) {
  return Math.max(0, Math.round(value * cssScale));
}
