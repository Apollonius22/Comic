import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const width = Math.max(1, Math.round(Number(args.width ?? 1024)));
const height = Math.max(1, Math.round(Number(args.height ?? 1536)));
const thickness = Math.max(0, Math.round(Number(args.thickness ?? 10)));
const color = hexToRgb(args.color ?? '#ffffff');
const chapters = resolveChapters(args.chapter ?? 3);
let outlinedPages = 0;

for (const chapterPath of chapters) {
  const pages = parsePages(args.pages, chapterPath);
  const backupPath = join(chapterPath, '_original_sizes');

  if (pages.length === 0) {
    console.log(`${basename(chapterPath)}: skipped, no page images found`);
    continue;
  }

  for (const pageNumber of pages) {
    const pagePath = join(chapterPath, `page_${pageNumber}.png`);
    const sourcePath = join(backupPath, `page_${pageNumber}.png`);

    applyOutlineFromSource(pagePath, sourcePath);
    outlinedPages += 1;
  }

  console.log(`${basename(chapterPath)}: applied outline to ${pages.length} pages`);
}

if (outlinedPages === 0) {
  throw new Error('No pages provided. Example: npm run outline:pages -- --chapter 3 --pages 7,8');
}

console.log(`Applied ${thickness}px ${args.color ?? '#ffffff'} outline to ${outlinedPages} pages at ${width}x${height}`);

function applyOutlineFromSource(pagePath, sourcePath) {
  if (!existsSync(pagePath)) {
    throw new Error(`Missing image: ${pagePath}`);
  }

  if (!existsSync(sourcePath)) {
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, readFileSync(pagePath));
  }

  const source = PNG.sync.read(readFileSync(sourcePath));
  const image = source.width === width && source.height === height
    ? source
    : stretchImage(source, width, height);
  const edge = Math.min(thickness, Math.floor(image.width / 2), Math.floor(image.height / 2));

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const isOutline =
        x < edge ||
        y < edge ||
        x >= image.width - edge ||
        y >= image.height - edge;

      if (!isOutline) {
        continue;
      }

      const index = (y * image.width + x) * 4;
      image.data[index] = color.r;
      image.data[index + 1] = color.g;
      image.data[index + 2] = color.b;
      image.data[index + 3] = 255;
    }
  }

  writeFileSync(pagePath, PNG.sync.write(image));
}

function stretchImage(source, targetWidth, targetHeight) {
  const target = new PNG({ width: targetWidth, height: targetHeight });
  const scaleX = source.width / targetWidth;
  const scaleY = source.height / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(source.height - 1, Math.floor((y + 0.5) * scaleY));

    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(source.width - 1, Math.floor((x + 0.5) * scaleX));
      const srcIndex = (srcY * source.width + srcX) * 4;
      const dstIndex = (y * targetWidth + x) * 4;

      target.data[dstIndex] = source.data[srcIndex];
      target.data[dstIndex + 1] = source.data[srcIndex + 1];
      target.data[dstIndex + 2] = source.data[srcIndex + 2];
      target.data[dstIndex + 3] = source.data[srcIndex + 3];
    }
  }

  return target;
}

function normalizeChapterName(value) {
  return String(value).startsWith('chapter') ? String(value) : `chapter${value}`;
}

function resolveChapters(value) {
  const comicsPath = join(root, 'src/assets/comics');

  if (String(value).toLowerCase() !== 'all') {
    return [join(comicsPath, normalizeChapterName(value))];
  }

  return readdirSync(comicsPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^chapter\d+$/i.test(entry.name))
    .map(entry => join(comicsPath, entry.name))
    .sort((a, b) => chapterNumber(a) - chapterNumber(b));
}

function parsePages(value, chapterPath) {
  if (!value) {
    return [];
  }

  if (String(value).toLowerCase() === 'all') {
    return readdirSync(chapterPath)
      .filter(file => /^page_\d+\.png$/i.test(file))
      .map(pageNumber)
      .sort((a, b) => a - b);
  }

  return String(value)
    .split(',')
    .flatMap(part => {
      const range = part.trim().match(/^(\d+)-(\d+)$/);

      if (!range) {
        return [Number(part)];
      }

      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = start <= end ? 1 : -1;
      const values = [];

      for (let page = start; page !== end + step; page += step) {
        values.push(page);
      }

      return values;
    })
    .filter(Number.isFinite);
}

function pageNumber(file) {
  return Number(file.match(/\d+/)?.[0] ?? 0);
}

function chapterNumber(folder) {
  return Number(basename(folder).match(/\d+/)?.[0] ?? 0);
}

function hexToRgb(hex) {
  const value = String(hex).replace('#', '');

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
