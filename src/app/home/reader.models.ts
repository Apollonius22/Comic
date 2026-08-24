import type { ComicChapterDefinition } from './comic-manifest.generated';

export type ComicPageRole =
  | 'front-cover'
  | 'inside-cover'
  | 'content'
  | 'blank'
  | 'back-cover';

export type ComicPageDensity = 'hard' | 'soft';
export type ComicPageSide = 'left' | 'right';
export type ReaderFlipState = 'user_fold' | 'fold_corner' | 'flipping' | 'read';
export type ReaderVisualState = 'front-closed' | 'reading' | 'back-closed';
export type ReaderOrientation = 'portrait' | 'landscape';

export interface ComicPage {
  src?: string;
  mobileSrc?: string;
  spreadSrc?: string;
  role: ComicPageRole;
  density: ComicPageDensity;
  alt: string;
  side?: ComicPageSide;
  spreadId?: string;
}

export interface ChapterMarker {
  title: string;
  pageIndex: number;
  pageCount: number;
  lastPageIndex: number;
}

export interface ReaderProgress {
  primary: string;
  secondary: string;
  ariaValueText: string;
}

const DESKTOP_BOOKENDS = 'assets/comics/web/desktop/bookends';
const MOBILE_BOOKENDS = 'assets/comics/web/mobile/bookends';

export function createChapterMarkers(
  chapters: readonly ComicChapterDefinition[],
  firstContentPageIndex = 2,
): ChapterMarker[] {
  let pageIndex = firstContentPageIndex;

  return chapters.map(chapter => {
    const marker = {
      title: chapter.title,
      pageIndex,
      pageCount: chapter.pageCount,
      lastPageIndex: pageIndex + chapter.pageCount - 1,
    };

    pageIndex += chapter.pageCount;
    return marker;
  });
}

export function createComicPages(
  chapters: readonly ComicChapterDefinition[],
): ComicPage[] {
  const contentPages = createContentPages(chapters);

  return [
    createBookendPage('cover', 'front-cover', 'hard', 'Front cover'),
    createBookendPage('inside_left', 'inside-cover', 'hard', 'Inside front cover'),
    ...contentPages,
    ...createBlankPageIfNeeded(contentPages.length),
    createBookendPage('inside_right', 'inside-cover', 'hard', 'Inside back cover'),
    createBookendPage('end', 'back-cover', 'hard', 'Back cover'),
  ];
}

export function getChapterForPage(
  pageIndex: number,
  markers: readonly ChapterMarker[],
): ChapterMarker | undefined {
  return markers.find(marker => (
    pageIndex >= marker.pageIndex && pageIndex <= marker.lastPageIndex
  ));
}

export function createReaderProgress(
  pageIndex: number,
  pages: readonly ComicPage[],
  markers: readonly ChapterMarker[],
): ReaderProgress {
  const clampedIndex = clampPageIndex(pageIndex, pages.length);
  const chapter = getChapterForPage(clampedIndex, markers);

  if (chapter) {
    const chapterPage = clampedIndex - chapter.pageIndex + 1;
    return {
      primary: chapter.title,
      secondary: `${chapterPage} of ${chapter.pageCount}`,
      ariaValueText: `${chapter.title}, page ${chapterPage} of ${chapter.pageCount}`,
    };
  }

  const label = pages[clampedIndex]?.alt ?? 'Comic page';
  return {
    primary: label,
    secondary: `${clampedIndex + 1} of ${pages.length}`,
    ariaValueText: `${label}, item ${clampedIndex + 1} of ${pages.length}`,
  };
}

export function clampPageIndex(pageIndex: number, pageCount: number) {
  if (!Number.isFinite(pageIndex) || pageCount <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(Math.trunc(pageIndex), pageCount - 1));
}

function createContentPages(
  chapters: readonly ComicChapterDefinition[],
): ComicPage[] {
  let contentOffset = 0;
  const pages: ComicPage[] = [];

  for (const chapter of chapters) {
    const chapterPages = createChapterPages(chapter, contentOffset);
    pages.push(...chapterPages);
    contentOffset += chapterPages.length;
  }

  return pages;
}

function createChapterPages(
  chapter: ComicChapterDefinition,
  contentOffset: number,
): ComicPage[] {
  const chapterNumber = Number(chapter.folder.match(/\d+/)?.[0] ?? 0);

  return Array.from({ length: chapter.pageCount }, (_, index) => {
    const contentIndex = contentOffset + index;
    const pageNumber = chapter.firstPage + index;

    return {
      src: `assets/comics/web/desktop/${chapter.folder}/page_${pageNumber}.webp`,
      mobileSrc: `assets/comics/web/mobile/${chapter.folder}/page_${pageNumber}.webp`,
      role: 'content' as const,
      density: 'soft' as const,
      alt: pageNumber === chapter.firstPage
        ? `Chapter ${chapterNumber} cover page`
        : `Chapter ${chapterNumber} comic page ${pageNumber}`,
      side: contentIndex % 2 === 0 ? 'right' as const : 'left' as const,
      spreadId: `chapter-${chapterNumber}-spread-${Math.floor(index / 2) + 1}`,
    };
  });
}

function createBlankPageIfNeeded(contentPageCount: number): ComicPage[] {
  if (contentPageCount % 2 === 0) {
    return [];
  }

  return [{
    ...createBookendPage('blank', 'blank', 'soft', 'Blank page'),
    side: 'left',
  }];
}

function createBookendPage(
  name: string,
  role: ComicPageRole,
  density: ComicPageDensity,
  alt: string,
): ComicPage {
  return {
    src: `${DESKTOP_BOOKENDS}/${name}-desktop.webp`,
    mobileSrc: `${MOBILE_BOOKENDS}/${name}-mobile.webp`,
    role,
    density,
    alt,
  };
}
