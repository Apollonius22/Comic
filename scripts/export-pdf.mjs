import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const outputWidth = Math.max(640, Number(args.width ?? 1100));
const output = join(root, args.out ?? 'src/assets/exports/comic.pdf');
const background = hexToRgb(args.background ?? '#11100f');
const pageRatio = Number(args.pageRatio ?? 1.5);
const canvasWidth = outputWidth;
const slotWidth = Math.floor(canvasWidth / 2);
const canvasHeight = Math.round(slotWidth * pageRatio);
const cssScale = slotWidth / 520;
const contentTopBottomInset = scaledCss(28);
const contentOuterInset = scaledCss(22);
const contentInnerInset = scaledCss(4);
const blankSideInset = scaledCss(14);
const coverLikeRoles = new Set(['front-cover', 'inside-cover', 'back-cover']);

const comic = getComicPages(root);
comic.insideLeftImage = comic.insideLeft ? readPng(comic.insideLeft) : null;
comic.insideRightImage = comic.insideRight ? readPng(comic.insideRight) : null;

const pageItems = createPageItems(comic);
const frames = createBookFrames(pageItems);
const pdfPages = frames.map(renderFrame);

if (pdfPages.length === 0) {
  throw new Error('No comic pages found in src/assets/comics.');
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, createPdf(pdfPages));

console.log(`Exported ${pdfPages.length} flipbook PDF pages to ${output}`);
console.log(`Content pages: ${comic.chapterPages.length}`);
console.log(`Conditional blank page: ${comic.chapterPages.length % 2 === 1 ? 'yes' : 'no'}`);

function renderFrame(frame) {
  if (!frame.left && frame.right?.role === 'front-cover') {
    const rgba = createCanvas(slotWidth, canvasHeight, background);
    drawPage(rgba, slotWidth, canvasHeight, frame.right, 0, 0, slotWidth, canvasHeight, 'right');

    return { width: slotWidth, height: canvasHeight, rgb: rgbaToRgb(rgba) };
  }

  if (frame.left?.role === 'back-cover' && !frame.right) {
    const rgba = createCanvas(slotWidth, canvasHeight, background);
    drawPage(rgba, slotWidth, canvasHeight, frame.left, 0, 0, slotWidth, canvasHeight, 'left');

    return { width: slotWidth, height: canvasHeight, rgb: rgbaToRgb(rgba) };
  }

  const rgba = createCanvas(canvasWidth, canvasHeight, background);
  drawSpread(rgba, frame);

  return { width: canvasWidth, height: canvasHeight, rgb: rgbaToRgb(rgba) };
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
    drawImageStretch(target, canvasWidth, canvasHeight, comic.insideRightImage, slotWidth, 0, slotWidth, canvasHeight);
  }
}

function drawSpreadPages(target, frame) {
  if (frame.left) {
    drawPage(target, canvasWidth, canvasHeight, frame.left, 0, 0, slotWidth, canvasHeight, 'left');
  }

  if (frame.right) {
    drawPage(target, canvasWidth, canvasHeight, frame.right, slotWidth, 0, slotWidth, canvasHeight, 'right');
  }
}

function drawPage(target, targetWidth, targetHeight, page, x, y, width, height, slotSide) {
  if (!page) {
    return;
  }

  if (coverLikeRoles.has(page.role)) {
    drawContain(target, targetWidth, targetHeight, page.image, x, y, width, height);
    return;
  }

  const visual = getPageVisualRect(page, x, y, width, height, slotSide);
  drawContain(target, targetWidth, targetHeight, page.image, visual.x, visual.y, visual.width, visual.height);
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

function createPdf(pages) {
  const objects = [];
  const catalogId = reserveObject(objects);
  const pagesId = reserveObject(objects);
  const pageIds = [];

  for (const page of pages) {
    const imageId = addObject(objects, createImageObject(page));
    const content = Buffer.from(`q\n${page.width} 0 0 ${page.height} 0 0 cm\n/Im0 Do\nQ\n`);
    const contentId = addObject(objects, createStreamObject('', content));
    const pageId = addObject(objects, Buffer.from([
      '<<',
      '/Type /Page',
      `/Parent ${pagesId} 0 R`,
      `/MediaBox [0 0 ${page.width} ${page.height}]`,
      `/Resources << /XObject << /Im0 ${imageId} 0 R >> >>`,
      `/Contents ${contentId} 0 R`,
      '>>',
    ].join('\n')));

    pageIds.push(pageId);
  }

  setObject(objects, pagesId, Buffer.from([
    '<<',
    '/Type /Pages',
    `/Count ${pageIds.length}`,
    `/Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}]`,
    '>>',
  ].join('\n')));
  setObject(objects, catalogId, Buffer.from([
    '<<',
    '/Type /Catalog',
    `/Pages ${pagesId} 0 R`,
    '/PageMode /UseNone',
    '>>',
  ].join('\n')));

  return writePdfObjects(objects, catalogId);
}

function createImageObject(page) {
  const compressed = deflateSync(page.rgb);
  const dictionary = [
    '/Type /XObject',
    '/Subtype /Image',
    `/Width ${page.width}`,
    `/Height ${page.height}`,
    '/ColorSpace /DeviceRGB',
    '/BitsPerComponent 8',
    '/Filter /FlateDecode',
  ].join('\n');

  return createStreamObject(dictionary, compressed);
}

function createStreamObject(dictionary, stream) {
  return Buffer.concat([
    Buffer.from(`<<\n${dictionary}${dictionary ? '\n' : ''}/Length ${stream.length}\n>>\nstream\n`),
    stream,
    Buffer.from('\nendstream'),
  ]);
}

function writePdfObjects(objects, catalogId) {
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let size = chunks[0].length;

  objects.forEach((object, index) => {
    const id = index + 1;
    const header = Buffer.from(`${id} 0 obj\n`);
    const footer = Buffer.from('\nendobj\n');

    offsets[id] = size;
    chunks.push(header, object, footer);
    size += header.length + object.length + footer.length;
  });

  const xrefOffset = size;
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...objects.map((_, index) => `${String(offsets[index + 1]).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');

  chunks.push(Buffer.from(xref));

  return Buffer.concat(chunks);
}

function reserveObject(objects) {
  objects.push(Buffer.alloc(0));

  return objects.length;
}

function addObject(objects, object) {
  objects.push(object);

  return objects.length;
}

function setObject(objects, id, object) {
  objects[id - 1] = object;
}

function rgbaToRgb(rgba) {
  const rgb = Buffer.alloc((rgba.length / 4) * 3);

  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    rgb[target] = rgba[source];
    rgb[target + 1] = rgba[source + 1];
    rgb[target + 2] = rgba[source + 2];
  }

  return rgb;
}

function scaledCss(value) {
  return Math.max(0, Math.round(value * cssScale));
}
