import { AfterViewInit, Component, ElementRef, inject, OnDestroy, ViewChild } from '@angular/core';
import { PageFlip, type PageFlipEvent } from 'page-flip/dist/js/page-flip.module.js';
import { ChapterMenuComponent, type ReaderControlInteraction } from './components/chapter-menu/chapter-menu.component';
import { MagicBackdropComponent } from './components/magic-backdrop/magic-backdrop.component';
import { ReaderControlsComponent } from './components/reader-controls/reader-controls.component';
import { COMIC_CHAPTERS } from './comic-manifest.generated';
import { getNextPageIndex, getPreviousPageIndex, getVisiblePages } from './reader-navigation';
import { ReaderImageLoaderService } from './reader-image-loader.service';
import {
  clampPageIndex,
  createChapterMarkers,
  createComicPages,
  createReaderProgress,
  type ChapterMarker,
  type ComicPage,
  type ReaderFlipState,
  type ReaderOrientation,
} from './reader.models';
import { ReadingPositionService } from './reading-position.service';

interface WebkitFullscreenDocument extends Document {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebkitFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface PortraitSwipeStart {
  touchId: number;
  x: number;
  y: number;
  pageIndex: number;
}

interface BookPointerStart {
  pointerId: number;
  x: number;
  y: number;
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [ChapterMenuComponent, MagicBackdropComponent, ReaderControlsComponent],
  providers: [ReaderImageLoaderService, ReadingPositionService],
})
export class HomePage implements AfterViewInit, OnDestroy {

  @ViewChild('readerHost', { static: true }) readerHost!: ElementRef<HTMLElement>;
  @ViewChild('bookHost', { static: true }) bookHost!: ElementRef<HTMLElement>;

  readonly chapterMarkers = createChapterMarkers(COMIC_CHAPTERS);
  readonly pages = createComicPages(COMIC_CHAPTERS);
  private readonly pageImages = inject(ReaderImageLoaderService);
  private readonly readingPosition = inject(ReadingPositionService);
  private readonly requestedPageIndex = this.readingPosition.readRequestedPageIndex(this.pages.length);
  private readonly storedPageIndex = this.readingPosition.readStoredPageIndex(this.pages.length);

  currentIndex = this.requestedPageIndex ?? 0;
  scrubTargetIndex = this.currentIndex;
  resumePageIndex = this.requestedPageIndex === undefined
    ? this.storedPageIndex
    : undefined;
  flipState: ReaderFlipState = 'read';
  readerOrientation: ReaderOrientation = this.getInitialReaderOrientation();
  showPageNavigation = false;
  isFullscreen = false;
  showMenu = false;
  isOpeningCover = false;
  isCoverTransitioning = false;

  private pageFlip?: PageFlip;
  private coverTransitionTimer?: number;
  private coverTransitionCleanupTimer?: number;
  private layoutUpdateFrame?: number;
  private layoutUpdateTimer?: number;
  private swipeFallbackTimer?: number;
  private fullscreenControlsTimer?: number;
  private portraitSwipeStart?: PortraitSwipeStart;
  private bookPointerStart?: BookPointerStart;
  private nativeFullscreenActive = false;
  private readonly fullscreenControlInteractions = new Set<ReaderControlInteraction>();
  private suppressBookClickUntil = 0;
  private readonly fullscreenControlsDelay = 3000;
  private showUnderlayAfterCoverTransition = false;
  private underlayTargetIndex?: number;
  private readonly updateBookLayout = () => {
    this.applyResponsivePageFlipMode();
    this.pageImages.prefetch(this.pages, this.currentIndex, this.isPortraitMode);
    this.requestBookLayoutUpdate();
  };
  private readonly syncFullscreenState = () => {
    const fullscreenElement = this.getFullscreenElement();

    if (fullscreenElement) {
      this.nativeFullscreenActive = true;
      this.isFullscreen = true;
    } else if (this.nativeFullscreenActive) {
      this.nativeFullscreenActive = false;
      this.isFullscreen = false;
      this.showPageNavigation = true;
      this.showMenu = false;
      this.fullscreenControlInteractions.clear();
      this.clearFullscreenControlsTimer();
    }

    this.requestBookLayoutUpdate();
  };
  private readonly handleReaderKeyboard = (event: KeyboardEvent) => {
    if (event.key === 'Tab' && this.isFullscreen) {
      this.showFullscreenControls();
      return;
    }

    if (event.key === 'Escape') {
      if (this.showMenu) {
        event.preventDefault();
        this.closeMenu();
      } else if (this.isFullscreen && !this.getFullscreenElement()) {
        event.preventDefault();
        void this.toggleFullscreen();
      }

      return;
    }

    if (this.isInteractiveElement(event.target)) {
      return;
    }

    if (event.key === 'ArrowLeft' && this.canGoPrevious) {
      event.preventDefault();
      this.prevPage();
    } else if (event.key === 'ArrowRight' && this.canGoNext) {
      event.preventDefault();
      this.nextPage();
    }
  };

  constructor() {
    this.queuePageImages(this.currentIndex);
  }

  ngAfterViewInit() {
    this.pageFlip = new PageFlip(this.bookHost.nativeElement, {
      width: 520,
      height: 780,
      size: 'stretch',
      // Keep modern phones in portrait mode while allowing the page to use
      // their full width. Landscape phones still have enough room for a spread.
      minWidth: 230,
      maxWidth: 700,
      minHeight: 220,
      maxHeight: 1050,
      drawShadow: true,
      flippingTime: 1300,
      startPage: this.currentIndex,
      usePortrait: !this.shouldForceLandscapeSpread(),
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
      this.scrubTargetIndex = this.currentIndex;
      this.closeMenu();
      this.queuePageImages(this.currentIndex);
      this.persistReadingPosition(this.currentIndex);
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
    document.addEventListener('fullscreenchange', this.syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', this.syncFullscreenState);
    document.addEventListener('keydown', this.handleReaderKeyboard);
    this.requestBookLayoutUpdate();
  }

  ngOnDestroy() {
    if (this.coverTransitionTimer) {
      window.clearTimeout(this.coverTransitionTimer);
    }

    if (this.coverTransitionCleanupTimer) {
      window.clearTimeout(this.coverTransitionCleanupTimer);
    }

    if (this.layoutUpdateFrame) {
      window.cancelAnimationFrame(this.layoutUpdateFrame);
    }

    if (this.layoutUpdateTimer) {
      window.clearTimeout(this.layoutUpdateTimer);
    }

    if (this.swipeFallbackTimer) {
      window.clearTimeout(this.swipeFallbackTimer);
    }

    this.clearFullscreenControlsTimer();
    window.removeEventListener('resize', this.updateBookLayout);
    window.removeEventListener('orientationchange', this.updateBookLayout);
    window.visualViewport?.removeEventListener('resize', this.updateBookLayout);
    document.removeEventListener('fullscreenchange', this.syncFullscreenState);
    document.removeEventListener('webkitfullscreenchange', this.syncFullscreenState);
    document.removeEventListener('keydown', this.handleReaderKeyboard);
    this.pageFlip?.destroy();
  }

  get pageCount() {
    return this.pageFlip?.getPageCount?.() ?? this.pages.length;
  }

  get lastIndex() {
    return this.pageCount - 1;
  }

  get isSinglePageView() {
    return this.readerOrientation === 'portrait';
  }

  get canGoPrevious() {
    return this.currentIndex > 0 && this.flipState !== 'flipping';
  }

  get canGoNext() {
    return this.currentIndex < this.lastIndex && this.flipState !== 'flipping';
  }

  get readerProgress() {
    return createReaderProgress(this.scrubTargetIndex, this.pages, this.chapterMarkers);
  }

  get resumeProgress() {
    return this.resumePageIndex === undefined
      ? undefined
      : createReaderProgress(this.resumePageIndex, this.pages, this.chapterMarkers);
  }

  get showReadingUnderlay() {
    return this.showLeftUnderlay || this.showRightUnderlay;
  }

  get showLeftUnderlay() {
    if (this.isPortraitMode) {
      const page = this.activeUnderlayPages[0];
      return this.shouldShowUnderlayBehind(page) && page?.side === 'left';
    }

    return this.shouldShowUnderlayBehind(this.activeUnderlayPages[0]);
  }

  get showRightUnderlay() {
    if (this.isPortraitMode) {
      const page = this.activeUnderlayPages[0];
      return this.shouldShowUnderlayBehind(page) && page?.side !== 'left';
    }

    return this.shouldShowUnderlayBehind(this.activeUnderlayPages[1]);
  }

  private get activeUnderlayPages() {
    const index = this.isCoverTransitioning && this.underlayTargetIndex !== undefined
      ? this.underlayTargetIndex
      : this.currentIndex;

    return getVisiblePages(this.pages, index, this.isPortraitMode);
  }

  getPageSrc(page: ComicPage, index: number) {
    return this.pageImages.isLoaded(index) ? page.src : undefined;
  }

  getMobilePageSrc(page: ComicPage, index: number) {
    return this.pageImages.isLoaded(index) ? page.mobileSrc : undefined;
  }

  jumpToChapter(marker: ChapterMarker) {
    this.turnToPage(marker.pageIndex);
  }

  resumeReading() {
    if (this.resumePageIndex === undefined) {
      return;
    }

    const targetIndex = this.resumePageIndex;
    this.resumePageIndex = undefined;
    this.turnToPage(targetIndex);
  }

  previewPageScrub(pageIndex: number) {
    this.scrubTargetIndex = clampPageIndex(pageIndex, this.pages.length);
    this.onFullscreenControlsActivity();
  }

  commitPageScrub(pageIndex: number) {
    this.turnToPage(pageIndex);
    this.onFullscreenControlsActivity();
  }

  async toggleFullscreen() {
    const fullscreenElement = this.getFullscreenElement();
    const webkitDocument = document as WebkitFullscreenDocument;

    if (fullscreenElement) {
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        } else {
          await Promise.resolve(webkitDocument.webkitExitFullscreen?.());
        }
      } finally {
        this.nativeFullscreenActive = false;
        this.isFullscreen = false;
        this.showPageNavigation = true;
        this.showMenu = false;
        this.fullscreenControlInteractions.clear();
        this.clearFullscreenControlsTimer();
        this.requestBookLayoutUpdate();
      }

      return;
    }

    if (this.isFullscreen) {
      this.isFullscreen = false;
      this.showPageNavigation = true;
      this.showMenu = false;
      this.fullscreenControlInteractions.clear();
      this.clearFullscreenControlsTimer();
      this.requestBookLayoutUpdate();
      return;
    }

    this.isFullscreen = true;
    this.showPageNavigation = false;
    this.showMenu = false;
    this.fullscreenControlInteractions.clear();
    this.clearFullscreenControlsTimer();
    this.requestBookLayoutUpdate();

    const reader = this.readerHost.nativeElement as WebkitFullscreenElement;

    try {
      if (reader.requestFullscreen) {
        await reader.requestFullscreen({ navigationUI: 'hide' });
      } else if (reader.webkitRequestFullscreen) {
        await Promise.resolve(reader.webkitRequestFullscreen());
      }

      this.nativeFullscreenActive = Boolean(this.getFullscreenElement());
    } catch {
      // Keep the CSS immersive mode as a fallback on browsers without
      // element fullscreen support, including some iPhone Safari versions.
      this.nativeFullscreenActive = false;
    }
  }

  onBookTouchStart(event: TouchEvent) {
    if ((!this.isSinglePageView && !this.isFullscreen) || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches.item(0);

    if (!touch) {
      return;
    }

    this.portraitSwipeStart = {
      touchId: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      pageIndex: this.pageFlip?.getCurrentPageIndex?.() ?? this.currentIndex,
    };
  }

  onBookTouchEnd(event: TouchEvent) {
    const start = this.portraitSwipeStart;
    this.portraitSwipeStart = undefined;

    if (!start || (!this.isSinglePageView && !this.isFullscreen)) {
      return;
    }

    let touch: Touch | null = null;

    for (let index = 0; index < event.changedTouches.length; index += 1) {
      const changedTouch = event.changedTouches.item(index);

      if (changedTouch?.identifier === start.touchId) {
        touch = changedTouch;
        break;
      }
    }

    if (!touch) {
      return;
    }

    const horizontalDistance = touch.clientX - start.x;
    const verticalDistance = touch.clientY - start.y;

    if (
      Math.abs(horizontalDistance) < 48
      || Math.abs(horizontalDistance) <= Math.abs(verticalDistance) * 1.2
    ) {
      return;
    }

    // Mobile browsers can emit a click after a swipe. Ignore that click so a
    // page gesture never unexpectedly toggles the navigation controls.
    this.suppressBookClickUntil = Date.now() + 650;

    if (!this.isSinglePageView) {
      return;
    }

    if (this.swipeFallbackTimer) {
      window.clearTimeout(this.swipeFallbackTimer);
    }

    this.swipeFallbackTimer = window.setTimeout(() => {
      this.swipeFallbackTimer = undefined;

      const currentIndex = this.pageFlip?.getCurrentPageIndex?.() ?? this.currentIndex;

      // PageFlip handles most swipes itself. Only navigate when it ignored the
      // gesture, preventing one swipe from advancing two pages.
      if (currentIndex !== start.pageIndex || this.flipState === 'flipping') {
        return;
      }

      if (horizontalDistance < 0 && this.canGoNext) {
        this.nextPage();
      } else if (horizontalDistance > 0 && this.canGoPrevious) {
        this.prevPage();
      }
    }, 100);
  }

  cancelBookSwipe() {
    this.portraitSwipeStart = undefined;
  }

  onBookPointerDown(event: PointerEvent) {
    if (!this.isFullscreen || event.pointerType !== 'mouse') {
      return;
    }

    this.bookPointerStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  onBookPointerUp(event: PointerEvent) {
    const start = this.bookPointerStart;
    this.bookPointerStart = undefined;

    if (!start || start.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);

    if (distance >= 12) {
      this.suppressBookClickUntil = Date.now() + 300;
    }
  }

  cancelBookPointer() {
    this.bookPointerStart = undefined;
  }

  nextPage() {
    this.closeMenu();
    this.syncReaderOrientation();
    const index = this.pageFlip?.getCurrentPageIndex?.() ?? this.currentIndex;
    const targetIndex = getNextPageIndex(index, this.lastIndex, this.isPortraitMode);

    this.queuePageImages(targetIndex);

    if (this.shouldSuppressUnderlayDuringFlip(index, targetIndex)) {
      this.startCoverTransition(targetIndex);
    }

    this.pageFlip?.flipNext('bottom');
    this.ensureNavigationCompletes(index, targetIndex);
  }

  prevPage() {
    this.closeMenu();
    this.syncReaderOrientation();
    const index = this.pageFlip?.getCurrentPageIndex?.() ?? this.currentIndex;
    const targetIndex = getPreviousPageIndex(index, this.lastIndex, this.isPortraitMode);

    this.queuePageImages(targetIndex);

    if (this.shouldSuppressUnderlayDuringFlip(index, targetIndex)) {
      this.startCoverTransition(targetIndex);
    }

    this.pageFlip?.flipPrev('bottom');
    this.ensureNavigationCompletes(index, targetIndex);
  }

  private turnToPage(pageIndex: number) {
    const targetIndex = clampPageIndex(pageIndex, this.pages.length);
    this.queuePageImages(targetIndex);
    this.currentIndex = targetIndex;
    this.scrubTargetIndex = targetIndex;
    this.closeMenu();
    this.pageFlip?.turnToPage(targetIndex);
    this.persistReadingPosition(targetIndex);
    this.requestBookLayoutUpdate();
    this.scheduleFullscreenControlsHide();
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

    if (this.coverTransitionCleanupTimer) {
      window.clearTimeout(this.coverTransitionCleanupTimer);
    }

    this.coverTransitionCleanupTimer = window.setTimeout(() => {
      this.coverTransitionCleanupTimer = undefined;
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

      // Do not interrupt an active fold with an immediate page jump.
      if (this.flipState !== 'read' || currentIndex !== startIndex) {
        return;
      }

      if (targetIndex < startIndex) {
        this.pageFlip?.flipPrev('bottom');
      } else {
        this.pageFlip?.flipNext('bottom');
      }

      window.setTimeout(() => {
        const retryIndex = this.pageFlip?.getCurrentPageIndex?.() ?? this.currentIndex;

        if (this.flipState === 'read' && retryIndex === startIndex) {
          this.pageFlip?.turnToPage(targetIndex);
        }
      }, 180);
    }, 120);
  }

  private requestBookLayoutUpdate() {
    this.applyResponsivePageFlipMode();

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

  private applyResponsivePageFlipMode() {
    const settings = this.pageFlip?.getSettings?.();

    if (!settings) {
      return;
    }

    // PageFlip normally falls back to one page when its measured container is
    // narrow. Mobile Safari's browser bars can trigger that fallback in
    // landscape, so viewport orientation takes precedence on phone widths.
    settings.usePortrait = !this.shouldForceLandscapeSpread();
  }

  private shouldForceLandscapeSpread() {
    if (typeof window === 'undefined') {
      return false;
    }

    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;

    return viewportWidth <= 980 && viewportWidth > viewportHeight;
  }

  private getFullscreenElement() {
    const webkitDocument = document as WebkitFullscreenDocument;
    return document.fullscreenElement ?? webkitDocument.webkitFullscreenElement ?? null;
  }

  private queuePageImages(centerIndex: number) {
    this.pageImages.queue(this.pages, centerIndex, this.isPortraitMode);
  }

  private getInitialReaderOrientation(): ReaderOrientation {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 459px)').matches) {
      return 'portrait';
    }

    return 'landscape';
  }

  private spreadShowsUnderlay(index: number) {
    return getVisiblePages(this.pages, index, this.isPortraitMode)
      .some(page => this.shouldShowUnderlayBehind(page));
  }

  onReaderBackgroundClick() {
    this.closeMenu();

    if (this.isFullscreen) {
      this.showFullscreenControls();
      return;
    }

    this.showPageNavigation = !this.showPageNavigation;
    this.requestBookLayoutUpdate();
  }

  onBookClick(event: MouseEvent) {
    if (Date.now() < this.suppressBookClickUntil) {
      this.suppressBookClickUntil = 0;
      return;
    }

    if (this.isFullscreen) {
      const bookShell = event.currentTarget;

      if (!(bookShell instanceof HTMLElement)) {
        return;
      }

      const bounds = bookShell.getBoundingClientRect();
      const horizontalPosition = bounds.width > 0
        ? (event.clientX - bounds.left) / bounds.width
        : 0.5;

      if (horizontalPosition <= 0.3 && this.canGoPrevious) {
        this.prevPage();
      } else if (horizontalPosition >= 0.7 && this.canGoNext) {
        this.nextPage();
      }

      return;
    }

    this.closeMenu();
  }

  onFullscreenControlsActivity() {
    if (!this.isFullscreen) {
      return;
    }

    this.showPageNavigation = true;
    this.scheduleFullscreenControlsHide();
  }

  pauseFullscreenControls(interaction: ReaderControlInteraction) {
    if (!this.isFullscreen) {
      return;
    }

    this.fullscreenControlInteractions.add(interaction);
    this.clearFullscreenControlsTimer();
  }

  resumeFullscreenControls(interaction: ReaderControlInteraction) {
    if (!this.isFullscreen) {
      return;
    }

    this.fullscreenControlInteractions.delete(interaction);
    this.scheduleFullscreenControlsHide();
  }

  toggleMenu() {
    this.showMenu = !this.showMenu;

    if (!this.isFullscreen) {
      return;
    }

    this.showPageNavigation = true;

    if (this.showMenu) {
      this.clearFullscreenControlsTimer();
    } else {
      this.scheduleFullscreenControlsHide();
    }
  }

  private closeMenu() {
    if (!this.showMenu) {
      return;
    }

    this.showMenu = false;
    this.scheduleFullscreenControlsHide();
  }

  private showFullscreenControls() {
    if (!this.isFullscreen) {
      return;
    }

    this.showPageNavigation = true;
    this.scheduleFullscreenControlsHide();
  }

  private scheduleFullscreenControlsHide() {
    this.clearFullscreenControlsTimer();

    if (
      !this.isFullscreen
      || !this.showPageNavigation
      || this.fullscreenControlInteractions.size > 0
      || this.showMenu
    ) {
      return;
    }

    this.fullscreenControlsTimer = window.setTimeout(() => {
      this.fullscreenControlsTimer = undefined;
      this.showPageNavigation = false;
      this.showMenu = false;
    }, this.fullscreenControlsDelay);
  }

  private clearFullscreenControlsTimer() {
    if (!this.fullscreenControlsTimer) {
      return;
    }

    window.clearTimeout(this.fullscreenControlsTimer);
    this.fullscreenControlsTimer = undefined;
  }

  private persistReadingPosition(pageIndex: number) {
    this.readingPosition.persist(pageIndex, this.pages[pageIndex]);

    if (this.resumePageIndex === pageIndex) {
      this.resumePageIndex = undefined;
    }
  }

  private isInteractiveElement(target: EventTarget | null) {
    return target instanceof HTMLElement
      && Boolean(target.closest('button, input, select, textarea, [contenteditable="true"]'));
  }
}
