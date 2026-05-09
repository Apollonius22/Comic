import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

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

const comic = getComicPages();
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

function getComicPages() {
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

function createPageItems({ cover, insideLeft, chapterPages, blank, insideRight, end }) {
  const contentPages = chapterPages.map((path, index) => createPage(
    path,
    'content',
    `Comic page ${index + 1}`,
    index % 2 === 0 ? 'right' : 'left'
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

function rgbaToRgb(rgba) {
  const rgb = Buffer.alloc((rgba.length / 4) * 3);

  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    rgb[target] = rgba[source];
    rgb[target + 1] = rgba[source + 1];
    rgb[target + 2] = rgba[source + 2];
  }

  return rgb;
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

function blend(foreground, backgroundValue, alpha) {
  return Math.round(foreground * alpha + backgroundValue * (1 - alpha));
}

function scaledCss(value) {
  return Math.max(0, Math.round(value * cssScale));
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
