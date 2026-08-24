import type { ComicPage } from './reader.models';

export function getVisiblePages(
  pages: readonly ComicPage[],
  index: number,
  isPortraitMode: boolean,
): ComicPage[] {
  const lastIndex = pages.length - 1;

  if (index <= 0) {
    return compactPages(pages[0]);
  }

  if (index >= lastIndex) {
    return compactPages(pages[lastIndex]);
  }

  if (isPortraitMode) {
    return compactPages(pages[index]);
  }

  const spreadStart = index % 2 === 0 ? index - 1 : index;
  return compactPages(pages[spreadStart], pages[spreadStart + 1]);
}

export function getNextPageIndex(
  index: number,
  lastIndex: number,
  isPortraitMode: boolean,
) {
  if (isPortraitMode) {
    return Math.min(index + 1, lastIndex);
  }

  if (index <= 0) {
    return Math.min(1, lastIndex);
  }

  return Math.min(index + 2, lastIndex);
}

export function getPreviousPageIndex(
  index: number,
  lastIndex: number,
  isPortraitMode: boolean,
) {
  if (isPortraitMode) {
    return Math.max(index - 1, 0);
  }

  if (index <= 1) {
    return 0;
  }

  if (index >= lastIndex) {
    return Math.max(lastIndex - 2, 0);
  }

  return Math.max(index - 2, 0);
}

function compactPages(...pages: Array<ComicPage | undefined>) {
  return pages.filter((page): page is ComicPage => Boolean(page));
}
