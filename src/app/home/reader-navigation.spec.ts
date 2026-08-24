import {
  getNextPageIndex,
  getPreviousPageIndex,
  getVisiblePages,
} from './reader-navigation';
import type { ComicPage } from './reader.models';

describe('reader navigation', () => {
  const pages: ComicPage[] = Array.from({ length: 8 }, (_, index) => ({
    role: 'content',
    density: 'soft',
    alt: `Page ${index + 1}`,
  }));

  it('moves one page at a time in portrait mode', () => {
    expect(getNextPageIndex(2, 7, true)).toBe(3);
    expect(getPreviousPageIndex(2, 7, true)).toBe(1);
  });

  it('moves through cover-aware spreads in landscape mode', () => {
    expect(getNextPageIndex(0, 7, false)).toBe(1);
    expect(getNextPageIndex(1, 7, false)).toBe(3);
    expect(getPreviousPageIndex(3, 7, false)).toBe(1);
    expect(getPreviousPageIndex(1, 7, false)).toBe(0);
  });

  it('returns the two pages in the current landscape spread', () => {
    expect(getVisiblePages(pages, 4, false).map(page => page.alt)).toEqual([
      'Page 4',
      'Page 5',
    ]);
  });

  it('returns only one visible page in portrait and at either cover', () => {
    expect(getVisiblePages(pages, 4, true)).toEqual([pages[4]]);
    expect(getVisiblePages(pages, 0, false)).toEqual([pages[0]]);
    expect(getVisiblePages(pages, 7, false)).toEqual([pages[7]]);
  });
});
