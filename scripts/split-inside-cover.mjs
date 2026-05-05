import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bookends = join(root, 'src/assets/comics/bookends');
const source = PNG.sync.read(readFileSync(join(bookends, 'inside.png')));
const targetWidth = 1024;
const targetHeight = 1536;
const pageBackground = { r: 216, g: 194, b: 146 };
const halfWidth = Math.floor(source.width / 2);

mkdirSync(bookends, { recursive: true });
writePage('inside_left.png', crop(source, 0, halfWidth));
writePage('inside_right.png', crop(source, halfWidth, source.width - halfWidth));
writeFileSync(join(bookends, 'blank.png'), PNG.sync.write(createPage()));

console.log('Created inside_left.png, inside_right.png, and blank.png');

function crop(image, startX, width) {
  const cropped = new PNG({ width, height: image.height });

  for (let row = 0; row < image.height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const srcIndex = (row * image.width + startX + col) * 4;
      const dstIndex = (row * width + col) * 4;

      cropped.data[dstIndex] = image.data[srcIndex];
      cropped.data[dstIndex + 1] = image.data[srcIndex + 1];
      cropped.data[dstIndex + 2] = image.data[srcIndex + 2];
      cropped.data[dstIndex + 3] = image.data[srcIndex + 3] ?? 255;
    }
  }

  return cropped;
}

function writePage(fileName, image) {
  const page = createPage();
  drawContain(page, image);
  writeFileSync(join(bookends, fileName), PNG.sync.write(page));
}

function createPage() {
  const png = new PNG({ width: targetWidth, height: targetHeight });

  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = pageBackground.r;
    png.data[index + 1] = pageBackground.g;
    png.data[index + 2] = pageBackground.b;
    png.data[index + 3] = 255;
  }

  return png;
}

function drawContain(target, image) {
  const scale = Math.min(target.width / image.width, target.height / image.height);
  const drawWidth = Math.max(1, Math.round(image.width * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  const offsetX = Math.floor((target.width - drawWidth) / 2);
  const offsetY = Math.floor((target.height - drawHeight) / 2);

  for (let row = 0; row < drawHeight; row += 1) {
    const srcY = Math.min(image.height - 1, Math.floor(row / scale));

    for (let col = 0; col < drawWidth; col += 1) {
      const srcX = Math.min(image.width - 1, Math.floor(col / scale));
      const srcIndex = (srcY * image.width + srcX) * 4;
      const dstIndex = ((offsetY + row) * target.width + offsetX + col) * 4;
      const alpha = (image.data[srcIndex + 3] ?? 255) / 255;

      target.data[dstIndex] = blend(image.data[srcIndex], target.data[dstIndex], alpha);
      target.data[dstIndex + 1] = blend(image.data[srcIndex + 1], target.data[dstIndex + 1], alpha);
      target.data[dstIndex + 2] = blend(image.data[srcIndex + 2], target.data[dstIndex + 2], alpha);
      target.data[dstIndex + 3] = 255;
    }
  }
}

function blend(foreground, background, alpha) {
  return Math.round(foreground * alpha + background * (1 - alpha));
}
