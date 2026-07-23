import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const comicsRoot = join(root, 'src/assets/comics');
const webRoot = join(comicsRoot, 'web');
const manifestPath = join(root, 'src/app/home/comic-manifest.generated.ts');
const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args.dryRun);
const desktop = { width: 1024, height: 1536, quality: 88 };
const mobile = { width: 640, height: 960, quality: 84 };
const outline = 15;
const bookends = ['cover', 'inside_left', 'inside_right', 'end', 'blank'];
const chapters = discoverChapters();
const buildRoot = join(comicsRoot, `.web-build-${process.pid}`);
const previousRoot = join(comicsRoot, `.web-previous-${process.pid}`);
const restorations = [];
let sourceBytes = 0;
let optimizedBytes = 0;
let contentPageCount = 0;

sharp.cache(false);

if (chapters.length === 0) {
  throw new Error('No chapter folders containing comic pages were found.');
}

try {
  for (const chapter of chapters) {
    const pageSources = discoverPageSources(chapter.path);

    validateContinuousPages(chapter.folder, pageSources);
    contentPageCount += pageSources.length;

    if (!dryRun) {
      for (const page of pageSources) {
        const source = await getCanonicalSource(page);
        const desktopPath = join(buildRoot, 'desktop', chapter.folder, `page_${page.number}.webp`);
        const mobilePath = join(buildRoot, 'mobile', chapter.folder, `page_${page.number}.webp`);

        sourceBytes += page.sourceBytes;
        await createResponsiveImages(source, desktopPath, mobilePath);
        await validateImage(desktopPath, desktop, true);
        await validateImage(mobilePath, mobile, true);
        optimizedBytes += statSync(desktopPath).size + statSync(mobilePath).size;
      }
    } else {
      sourceBytes += pageSources.reduce((total, page) => total + page.sourceBytes, 0);
    }

    console.log(`${chapter.folder}: ${pageSources.length} pages (page_0-page_${pageSources.at(-1).number})`);
  }

  for (const name of bookends) {
    const sourcePath = join(comicsRoot, 'bookends', `${name}.png`);

    if (!existsSync(sourcePath)) {
      throw new Error(`Required bookend is missing: ${sourcePath}`);
    }

    sourceBytes += statSync(sourcePath).size;

    if (!dryRun) {
      const desktopPath = join(buildRoot, 'desktop', 'bookends', `${name}-desktop.webp`);
      const mobilePath = join(buildRoot, 'mobile', 'bookends', `${name}-mobile.webp`);

      await createResponsiveImages(sourcePath, desktopPath, mobilePath);
      await validateImage(desktopPath, desktop, false);
      await validateImage(mobilePath, mobile, false);
      optimizedBytes += statSync(desktopPath).size + statSync(mobilePath).size;
    }
  }

  const manifest = createManifest(chapters);

  if (!dryRun) {
    for (const restoration of restorations) {
      writeAtomically(restoration.path, restoration.buffer);
      console.log(`Restored ${restoration.label} from _original_sizes`);
    }

    publishWebAssets();
    writeAtomically(manifestPath, Buffer.from(manifest));
  }

  console.log(`Content pages: ${contentPageCount}`);
  console.log(`Source size: ${formatBytes(sourceBytes)}`);

  if (dryRun) {
    console.log('Dry run complete: no files were changed.');
  } else {
    const savedPercent = sourceBytes === 0
      ? 0
      : Math.max(0, (1 - optimizedBytes / sourceBytes) * 100);

    console.log(`Responsive WebP size: ${formatBytes(optimizedBytes)}`);
    console.log(`Size reduction: ${savedPercent.toFixed(1)}%`);
    console.log(`Generated manifest: ${manifestPath}`);
  }
} catch (error) {
  rmSync(buildRoot, { recursive: true, force: true });
  throw error;
}

function discoverChapters() {
  return readdirSync(comicsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^chapter\d+$/i.test(entry.name))
    .map(entry => ({
      folder: entry.name,
      number: Number(entry.name.match(/\d+/)?.[0] ?? 0),
      path: join(comicsRoot, entry.name),
    }))
    .filter(chapter => discoverPageSources(chapter.path).length > 0)
    .sort((a, b) => a.number - b.number);
}

function discoverPageSources(chapterPath) {
  const active = collectNumberedPages(chapterPath);
  const originalsPath = join(chapterPath, '_original_sizes');
  const originals = existsSync(originalsPath)
    ? collectNumberedPages(originalsPath)
    : new Map();
  const numbers = [...new Set([...active.keys(), ...originals.keys()])].sort((a, b) => a - b);

  return numbers.map(number => {
    const activePath = active.get(number);
    const originalPath = originals.get(number);
    const sourcePath = activePath ?? originalPath;

    return {
      number,
      activePath,
      originalPath,
      sourcePath,
      sourceBytes: statSync(sourcePath).size,
      chapterPath,
    };
  });
}

function collectNumberedPages(folder) {
  return new Map(
    readdirSync(folder)
      .map(file => {
        const match = file.match(/^page_(\d+)\.png$/i);
        return match ? [Number(match[1]), join(folder, file)] : undefined;
      })
      .filter(Boolean),
  );
}

function validateContinuousPages(folder, pages) {
  if (pages.length === 0 || pages[0].number !== 0) {
    throw new Error(`${folder} must start with page_0.png.`);
  }

  for (let index = 0; index < pages.length; index += 1) {
    if (pages[index].number !== index) {
      throw new Error(`${folder} is missing page_${index}.png.`);
    }
  }
}

async function getCanonicalSource(page) {
  if (page.activePath) {
    return page.activePath;
  }

  if (!page.originalPath) {
    throw new Error(`No source found for page_${page.number}.png in ${page.chapterPath}`);
  }

  const restored = await addCanonicalOutline(page.originalPath);
  const activePath = join(page.chapterPath, `page_${page.number}.png`);

  restorations.push({
    path: activePath,
    buffer: restored,
    label: `${basename(page.chapterPath)}/page_${page.number}.png`,
  });

  return restored;
}

async function addCanonicalOutline(source) {
  const white = { r: 255, g: 255, b: 255, alpha: 1 };

  return sharp(source)
    .resize(desktop.width, desktop.height, { fit: 'fill' })
    .composite([
      { input: { create: { width: desktop.width, height: outline, channels: 4, background: white } }, top: 0, left: 0 },
      { input: { create: { width: desktop.width, height: outline, channels: 4, background: white } }, top: desktop.height - outline, left: 0 },
      { input: { create: { width: outline, height: desktop.height, channels: 4, background: white } }, top: 0, left: 0 },
      { input: { create: { width: outline, height: desktop.height, channels: 4, background: white } }, top: 0, left: desktop.width - outline },
    ])
    .png()
    .toBuffer();
}

async function createResponsiveImages(source, desktopPath, mobilePath) {
  mkdirSync(dirname(desktopPath), { recursive: true });
  mkdirSync(dirname(mobilePath), { recursive: true });

  await Promise.all([
    sharp(source)
      .resize(desktop.width, desktop.height, { fit: 'fill' })
      .webp({ quality: desktop.quality, effort: 6, smartSubsample: true })
      .toFile(desktopPath),
    sharp(source)
      .resize(mobile.width, mobile.height, { fit: 'fill' })
      .webp({ quality: mobile.quality, effort: 6, smartSubsample: true })
      .toFile(mobilePath),
  ]);
}

async function validateImage(path, expected, requireWhiteOutline) {
  const metadata = await sharp(path).metadata();

  if (metadata.width !== expected.width || metadata.height !== expected.height) {
    throw new Error(
      `${path} is ${metadata.width}x${metadata.height}; expected ${expected.width}x${expected.height}.`,
    );
  }

  if (!requireWhiteOutline) {
    return;
  }

  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const points = [
    [0, 0],
    [Math.floor(info.width / 2), 0],
    [info.width - 1, 0],
    [0, Math.floor(info.height / 2)],
    [info.width - 1, Math.floor(info.height / 2)],
    [0, info.height - 1],
    [Math.floor(info.width / 2), info.height - 1],
    [info.width - 1, info.height - 1],
  ];

  for (const [x, y] of points) {
    const offset = (y * info.width + x) * info.channels;
    const channels = [data[offset], data[offset + 1], data[offset + 2]];

    if (channels.some(channel => channel < 240)) {
      throw new Error(`${path} does not retain a white outer page edge.`);
    }
  }
}

function publishWebAssets() {
  rmSync(previousRoot, { recursive: true, force: true });

  if (existsSync(webRoot)) {
    renameSync(webRoot, previousRoot);
  }

  try {
    renameSync(buildRoot, webRoot);
    rmSync(previousRoot, { recursive: true, force: true });
  } catch (error) {
    if (existsSync(previousRoot) && !existsSync(webRoot)) {
      renameSync(previousRoot, webRoot);
    }

    throw error;
  }
}

function createManifest(chapterEntries) {
  const definitions = chapterEntries.map(chapter => {
    const pages = discoverPageSources(chapter.path);

    return [
      '  {',
      `    folder: '${chapter.folder}',`,
      `    title: 'Chapter ${chapter.number}',`,
      '    firstPage: 0,',
      `    lastPage: ${pages.at(-1).number},`,
      `    pageCount: ${pages.length},`,
      '  },',
    ].join('\n');
  });

  return `// Generated by scripts/optimize-comic-pages.mjs. Do not edit manually.
export interface ComicChapterDefinition {
  folder: string;
  title: string;
  firstPage: number;
  lastPage: number;
  pageCount: number;
}

export const COMIC_CHAPTERS: readonly ComicChapterDefinition[] = [
${definitions.join('\n')}
];
`;
}

function writeAtomically(path, contents) {
  const temporaryPath = `${path}.tmp-${process.pid}`;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporaryPath, contents);
  renameSync(temporaryPath, path);
}

function formatBytes(bytes) {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes.toFixed(1)} MB`;
}

function parseArgs(values) {
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
