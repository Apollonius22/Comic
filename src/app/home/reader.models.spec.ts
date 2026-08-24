import type { ComicChapterDefinition } from './comic-manifest.generated';
import {
  clampPageIndex,
  createChapterMarkers,
  createComicPages,
  createReaderProgress,
} from './reader.models';

describe('reader models', () => {
  const chapters: readonly ComicChapterDefinition[] = [
    {
      folder: 'chapter1',
      title: 'Chapter 1',
      firstPage: 0,
      lastPage: 1,
      pageCount: 2,
    },
    {
      folder: 'chapter2',
      title: 'Chapter 2',
      firstPage: 0,
      lastPage: 2,
      pageCount: 3,
    },
  ];

  it('creates chapter offsets after the two opening book pages', () => {
    expect(createChapterMarkers(chapters)).toEqual([
      { title: 'Chapter 1', pageIndex: 2, pageCount: 2, lastPageIndex: 3 },
      { title: 'Chapter 2', pageIndex: 4, pageCount: 3, lastPageIndex: 6 },
    ]);
  });

  it('adds a blank page when the content count is odd', () => {
    const pages = createComicPages(chapters);

    expect(pages.map(page => page.role)).toEqual([
      'front-cover',
      'inside-cover',
      'content',
      'content',
      'content',
      'content',
      'content',
      'blank',
      'inside-cover',
      'back-cover',
    ]);
  });

  it('reports progress inside the active chapter', () => {
    const pages = createComicPages(chapters);
    const markers = createChapterMarkers(chapters);

    expect(createReaderProgress(5, pages, markers)).toEqual({
      primary: 'Chapter 2',
      secondary: '2 of 3',
      ariaValueText: 'Chapter 2, page 2 of 3',
    });
  });

  it('clamps invalid page indexes', () => {
    expect(clampPageIndex(-4, 10)).toBe(0);
    expect(clampPageIndex(12, 10)).toBe(9);
    expect(clampPageIndex(Number.NaN, 10)).toBe(0);
  });
});
