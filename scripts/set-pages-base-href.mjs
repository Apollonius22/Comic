import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const indexPath = join(root, 'www/index.html');
const requestedBase = process.argv[2] ?? '/Comic/';
const baseHref = requestedBase.startsWith('/') ? requestedBase : `/${requestedBase}`;
const normalizedBaseHref = baseHref.endsWith('/') ? baseHref : `${baseHref}/`;
const index = readFileSync(indexPath, 'utf8');
const matches = index.match(/<base\s+href="[^"]*"\s*\/?>/gi) ?? [];

if (matches.length !== 1) {
  throw new Error(`Expected one <base href> in ${indexPath}, found ${matches.length}.`);
}

const updatedIndex = index.replace(
  matches[0],
  `<base href="${normalizedBaseHref}">`,
);

writeFileSync(indexPath, updatedIndex);
console.log(`Set GitHub Pages base href to ${normalizedBaseHref}`);
