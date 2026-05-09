import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'src/assets/exports/comic.gif');
const target = join(root, 'www/assets/exports/comic.gif');

if (!existsSync(source)) {
  throw new Error(`GIF export not found: ${source}`);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);

console.log(`Copied GIF export to ${target}`);
