import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { PageFlip, type PageFlipEvent } from 'page-flip/dist/js/page-flip.module.js';
import { COMIC_CHAPTERS } from './comic-manifest.generated';

type ComicPageRole =
  | 'front-cover'
  | 'inside-cover'
  | 'content'
  | 'blank'
  | 'back-cover';

type ComicPageDensity = 'hard' | 'soft';
type ComicPageSide = 'left' | 'right';
type ReaderFlipState = 'user_fold' | 'fold_corner' | 'flipping' | 'read';
type ReaderVisualState = 'front-closed' | 'reading' | 'back-closed';
type ReaderOrientation = 'portrait' | 'landscape';

interface ComicPage {
  src?: string;
  mobileSrc?: string;
  spreadSrc?: string;
  role: ComicPageRole;
  density: ComicPageDensity;
  alt: string;
  side?: ComicPageSide;
  spreadId?: string;
}

interface ChapterMarker {
  title: string;
  pageIndex: number;
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePage implements AfterViewInit, OnDestroy {

  @ViewChild('bookHost', { static: true }) bookHost!: ElementRef<HTMLElement>;

  private readonly chapters = COMIC_CHAPTERS;
  readonly chapterMarkers = this.createChapterMarkers();
  private readonly contentPages = this.createContentPages();

  pages: ComicPage[] = [
    {
      src: 'assets/comics/web/desktop/bookends/cover-desktop.webp',
      mobileSrc: 'assets/comics/web/mobile/bookends/cover-mobile.webp',
      role: 'front-cover',
      density: 'hard',
      alt: 'Front cover',
    },
    {
      src: 'assets/comics/web/desktop/bookends/inside_left-desktop.webp',
      mobileSrc: 'assets/comics/web/mobile/bookends/inside_left-mobile.webp',
      role: 'inside-cover',
      density: 'hard',
      alt: 'Inside front cover',
    },
    ...this.contentPages,
    ...this.createBlankPageIfNeeded(this.contentPages.length),
    {
      src: 'assets/comics/web/desktop/bookends/inside_right-desktop.webp',
      mobileSrc: 'assets/comics/web/mobile/bookends/inside_right-mobile.webp',
      role: 'inside-cover',
      density: 'hard',
      alt: 'Inside back cover',
    },
    {
      src: 'assets/comics/web/desktop/bookends/end-desktop.webp',
      mobileSrc: 'assets/comics/web/mobile/bookends/end-mobile.webp',
      role: 'back-cover',
      density: 'hard',
      alt: 'Back cover',
    },
  ];

  currentIndex = 0;
  flipState: ReaderFlipState = 'read';
  readerOrientation: ReaderOrientation = 'landscape';
  showUI = false;
  showMenu = false;
  isOpeningCover = false;
  isCoverTransitioning = false;
  loadedPageIndexes = new Set<number>();

  private pageFlip?: PageFlip;
  private coverTransitionTimer?: number;
  private layoutUpdateFrame?: number;
  private layoutUpdateTimer?: number;
  private showUnderlayAfterCoverTransition = false;
  private underlayTargetIndex?: number;
  private readonly updateBookLayout = () => {
    this.requestBookLayoutUpdate();
  };

  constructor() {
    this.queuePageImages(0);
  }

  private createChapterMarkers(): ChapterMarker[] {
    let pageIndex = 2;

    return this.chapters.map(chapter => {
      const marker = {
        title: chapter.title,
        pageIndex,
      };

      pageIndex += chapter.pageCount;
      return marker;
    });
  }

  private createContentPages(): ComicPage[] {
    let contentOffset = 0;
    const pages: ComicPage[] = [];

    for (const chapter of this.chapters) {
      const chapterPages = this.createChapterPages(
        chapter.folder,
        chapter.firstPage,
        chapter.lastPage,
        contentOffset,
      );

      pages.push(...chapterPages);
      contentOffset += chapterPages.length;
    }

    return pages;
  }

  private createChapterPages(
    chapter: string,
    firstPage: number,
    lastPage: number,
    contentOffset: number
  ): ComicPage[] {
    const chapterNumber = Number(chapter.match(/\d+/)?.[0] ?? 0);
    const count = lastPage - firstPage + 1;

    return Array.from({ length: count }, (_, index) => {
      const contentIndex = contentOffset + index;
      const pageNumber = firstPage + index;

      return {
        src: `assets/comics/web/desktop/${chapter}/page_${pageNumber}.webp`,
        mobileSrc: `assets/comics/web/mobile/${chapter}/page_${pageNumber}.webp`,
        role: 'content' as const,
        density: 'soft' as const,
        alt: pageNumber === 0
          ? `Chapter ${chapterNumber} cover page`
          : `Chapter ${chapterNumber} comic page ${pageNumber}`,
        side: contentIndex % 2 === 0 ? 'right' as const : 'left' as const,
        spreadId: `chapter-${chapterNumber}-spread-${Math.floor(index / 2) + 1}`,
      };
    });
  }

  private createBlankPageIfNeeded(contentPageCount: number): ComicPage[] {
    if (contentPageCount % 2 === 0) {
      return [];
    }

    return [
      {
        src: 'assets/comics/web/desktop/bookends/blank-desktop.webp',
        mobileSrc: 'assets/comics/web/mobile/bookends/blank-mobile.webp',
        role: 'blank',
        density: 'soft',
        alt: 'Blank page',
        side: 'left',
      },
    ];
  }

  ngAfterViewInit() {
    this.pageFlip = new PageFlip(this.bookHost.nativeElement, {
      width: 520,
      height: 780,
      size: 'stretch',
      minWidth: 180,
      maxWidth: 520,
      minHeight: 220,
      maxHeight: 780,
      drawShadow: true,
      flippingTime: 1300,
      usePortrait: true,
      startZIndex: 10,
      autoSize: true,
      maxShadowOpacity: 0.65,
      showCover: true,
      mobileScrollSupport: false,
      swipeDistance: 20,
      disableFlipByClick: true,
    });

    this.pageFlip.on('flip', event => {
      this.currentIndex = Number(event.data);
      this.queuePageImages(this.currentIndex);
      this.finishCoverTransitionIfReady(true);
    });

    this.pageFlip.on('changeState', event => {
      this.flipState = event.data as ReaderFlipState;
      this.finishCoverTransitionIfReady(false);
    });

    this.pageFlip.on('init', event => {
      this.setReaderOrientation(event.data);
    });

    this.pageFlip.on('changeOrientation', event => {
      this.setReaderOrientation(event.data);
      this.requestBookLayoutUpdate();
    });

    this.pageFlip.loadFromHTML(
      Array.from(this.bookHost.nativeElement.querySelectorAll<HTMLElement>('.book-page'))
    );

    window.addEventListener('resize', this.updateBookLayout);
    window.addEventListener('orientationchange', this.updateBookLayout);
    window.visualViewport?.addEventListener('resize', this.updateBookLayout);
    this.requestBookLayoutUpdate();
  }

  ngOnDestroy() {
    if (this.coverTransitionTimer) {
      window.clearTimeout(this.coverTransitionTimer);
    }

    if (this.layoutUpdateFrame) {
      window.cancelAnimationFrame(this.layoutUpdateFrame);
    }

    if (this.layoutUpdateTimer) {
      window.clearTimeout(this.layoutUpdateTimer);
    }

    window.removeEventListener('resize', this.updateBookLayout);
    window.removeEventListener('orientationchange', this.updateBookLayout);
    window.visualViewport?.removeEventListener('resize', this.updateBookLayout);
    this.pageFlip?.destroy();
  }

  get spreadStart() {
    return this.currentIndex + 1;
  }

  get spreadEnd() {
    return Math.min(this.currentIndex + (this.isPortraitMode ? 1 : 2), this.pages.length);
  }

  get pageCount() {
    return this.pageFlip?.getPageCount?.() ?? this.pages.length;
  }

  get lastIndex() {
    return this.pageCount - 1;
  }

  get visualState(): ReaderVisualState {
    if (this.currentIndex <= 0) {
      return 'front-closed';
    }

    if (this.currentIndex >= this.lastIndex) {
      return 'back-closed';
    }

    return 'reading';
  }

  get showReadingUnderlay() {
    return this.showLeftUnderlay || this.showRightUnderlay;
  }

  get showLeftUnderlay() {
    if (this.isPortraitMode) {
      return this.activeUnderlayPages.some(page => this.shouldShowUnderlayBehind(page));
    }

    return this.shouldShowUnderlayBehind(this.activeUnderlayPages[0]);
  }

  get showRightUnderlay() {
    if (this.isPortraitMode) {
      return this.activeUnderlayPages.some(page => this.shouldShowUnderlayBehind(page));
    }

    return this.shouldShowUnderlayBehind(this.activeUnderlayPages[1]);
  }

  private get activeUnderlayPages() {
    const index = this.isCoverTransitioning && this.underlayTargetIndex !== undefined
      ? this.underlayTargetIndex
      : this.currentIndex;

    return this.getVisiblePages(index);
  }

  isContentPage(page: ComicPage) {
    return page.role === 'content';
  }

  isCoverLikePage(page: ComicPage) {
    return page.role === 'front-cover'
      || page.role === 'inside-cover'
      || page.role === 'back-cover';
  }

  getPageSrc(page: ComicPage, index: number) {
    return this.loadedPageIndexes.has(index) ? page.src : undefined;
  }

  getMobilePageSrc(page: ComicPage, index: number) {
    return this.loadedPageIndexes.has(index) ? page.mobileSrc : undefined;
  }

  jumpToChapter(marker: ChapterMarker) {
    this.queuePageImages(marker.pageIndex);
    this.currentIndex = marker.pageIndex;
    this.showMenu = false;
    this.pageFlip?.turnToPage(marker.pageIndex);
    this.requestBookLayoutUpdate();
  }

  nextPage() {
    this.syncReaderOrientation();
    const index = this.pageFlip?.getCurrentPageIndex?.() ?? this.currentIndex;
    const targetIndex = this.getNextSpreadIndex(index);

    this.queuePageImages(targetIndex);

    if (this.shouldSuppressUnderlayDuringFlip(index, targetIndex)) {
      this.startCoverTransition(targetIndex);
    }

    this.pageFlip?.flipNext('bottom');
    this.ensureNavigationCompletes(index, targetIndex);
  }

  prevPage() {
    this.syncReaderOrientation();
    const index = this.pageFlip?.getCurrentPageIndex?.() ?? this.currentIndex;
    const targetIndex = this.getPrevSpreadIndex(index);

    this.queuePageImages(targetIndex);

    if (this.shouldSuppressUnderlayDuringFlip(index, targetIndex)) {
      this.startCoverTransition(targetIndex);
    }

    this.pageFlip?.flipPrev('bottom');
    this.ensureNavigationCompletes(index, targetIndex);
  }

  private startCoverTransition(targetIndex: number) {
    this.isOpeningCover = true;
    this.isCoverTransitioning = true;
    this.underlayTargetIndex = targetIndex;
    this.showUnderlayAfterCoverTransition = this.spreadShowsUnderlay(targetIndex);

    if (this.coverTransitionTimer) {
      window.clearTimeout(this.coverTransitionTimer);
    }

    this.coverTransitionTimer = window.setTimeout(() => {
      this.finishCoverTransition();
    }, 2200);
  }

  private finishCoverTransitionIfReady(fromFlipEvent: boolean) {
    if (!this.isCoverTransitioning) {
      return;
    }

    if (this.spreadShowsUnderlay(this.currentIndex) !== this.showUnderlayAfterCoverTransition) {
      return;
    }

    if (!fromFlipEvent && this.flipState !== 'read') {
      return;
    }

    this.finishCoverTransition();
  }

  private finishCoverTransition() {
    if (this.coverTransitionTimer) {
      window.clearTimeout(this.coverTransitionTimer);
      this.coverTransitionTimer = undefined;
    }

    window.setTimeout(() => {
      this.isOpeningCover = false;
      this.isCoverTransitioning = false;
      this.showUnderlayAfterCoverTransition = false;
      this.underlayTargetIndex = undefined;
    }, 140);
  }

  private shouldSuppressUnderlayDuringFlip(currentIndex: number, targetIndex: number) {
    return this.spreadShowsUnderlay(currentIndex) !== this.spreadShowsUnderlay(targetIndex);
  }

  private shouldShowUnderlayBehind(page?: ComicPage) {
    return page?.role === 'content' || page?.role === 'blank';
  }

  private get isPortraitMode() {
    return this.readerOrientation === 'portrait';
  }

  private setReaderOrientation(data: PageFlipEvent['data']) {
    const mode = typeof data === 'object' && data !== null && 'mode' in data
      ? data.mode
      : data;

    if (mode === 'portrait' || mode === 'landscape') {
      this.readerOrientation = mode;
    }
  }

  private syncReaderOrientation() {
    const mode = this.pageFlip?.getOrientation?.();

    if (mode === 'portrait' || mode === 'landscape') {
      this.readerOrientation = mode;
    }
  }

  private ensureNavigationCompletes(startIndex: number, targetIndex: number) {
    if (startIndex === targetIndex) {
      return;
    }

    window.setTimeout(() => {
      const currentIndex = this.pageFlip?.getCurrentPageIndex?.() ?? this.currentIndex;

      // PageFlip can reject programmatic flips if its corner point falls outside
      // the current responsive geometry. In that case, jump to the intended page
      // instead of leaving the arrow feeling broken.
      if (this.flipState === 'flipping' || currentIndex !== startIndex) {
        return;
      }

      this.pageFlip?.turnToPage(targetIndex);
    }, 120);
  }

  private requestBookLayoutUpdate() {
    if (this.layoutUpdateFrame) {
      window.cancelAnimationFrame(this.layoutUpdateFrame);
    }

    this.layoutUpdateFrame = window.requestAnimationFrame(() => {
      this.pageFlip?.update();
      this.layoutUpdateFrame = undefined;
    });

    if (this.layoutUpdateTimer) {
      window.clearTimeout(this.layoutUpdateTimer);
    }

    this.layoutUpdateTimer = window.setTimeout(() => {
      this.pageFlip?.update();
      this.layoutUpdateTimer = undefined;
    }, 220);
  }

  private queuePageImages(centerIndex: number) {
    const nextLoadedPageIndexes = new Set(this.loadedPageIndexes);
    const firstIndex = Math.max(0, centerIndex - 2);
    const lastIndex = Math.min(this.pages.length - 1, centerIndex + 4);

    for (let index = firstIndex; index <= lastIndex; index += 1) {
      nextLoadedPageIndexes.add(index);
    }

    nextLoadedPageIndexes.add(0);
    nextLoadedPageIndexes.add(1);

    this.loadedPageIndexes = nextLoadedPageIndexes;
  }

  private spreadShowsUnderlay(index: number) {
    return this.getVisiblePages(index).some(page => this.shouldShowUnderlayBehind(page));
  }

  private getVisiblePages(index: number) {
    if (index <= 0) {
      return [this.pages[0]].filter((page): page is ComicPage => Boolean(page));
    }

    if (index >= this.lastIndex) {
      return [this.pages[this.lastIndex]].filter((page): page is ComicPage => Boolean(page));
    }

    if (this.isPortraitMode) {
      return [this.pages[index]].filter((page): page is ComicPage => Boolean(page));
    }

    const spreadStart = index % 2 === 0 ? index - 1 : index;
    const firstPage = this.pages[spreadStart];
    const secondPage = this.pages[spreadStart + 1];

    return [firstPage, secondPage].filter((page): page is ComicPage => Boolean(page));
  }

  private getNextSpreadIndex(index: number) {
    if (this.isPortraitMode) {
      return Math.min(index + 1, this.lastIndex);
    }

    if (index <= 0) {
      return Math.min(1, this.lastIndex);
    }

    return Math.min(index + 2, this.lastIndex);
  }

  private getPrevSpreadIndex(index: number) {
    if (this.isPortraitMode) {
      return Math.max(index - 1, 0);
    }

    if (index <= 1) {
      return 0;
    }

    if (index >= this.lastIndex) {
      return Math.max(this.lastIndex - 2, 0);
    }

    return Math.max(index - 2, 0);
  }

  toggleUI() {
    this.showUI = !this.showUI;
  }

  toggleMenu() {
    this.showMenu = !this.showMenu;
  }
}
