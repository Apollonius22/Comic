import { Injectable, OnDestroy } from '@angular/core';
import type { ComicPage } from './reader.models';

@Injectable()
export class ReaderImageLoaderService implements OnDestroy {
  private loadedPageIndexes = new Set<number>();
  private readonly prefetchedPageSources = new Set<string>();
  private readonly activePagePrefetches = new Map<string, HTMLImageElement>();

  ngOnDestroy() {
    for (const image of this.activePagePrefetches.values()) {
      image.onload = null;
      image.onerror = null;
    }

    this.activePagePrefetches.clear();
  }

  isLoaded(index: number) {
    return this.loadedPageIndexes.has(index);
  }

  queue(pages: readonly ComicPage[], centerIndex: number, isPortraitMode: boolean) {
    const nextLoadedPageIndexes = new Set<number>();
    const firstIndex = Math.max(0, centerIndex - 2);
    const lastIndex = Math.min(pages.length - 1, centerIndex + 4);

    for (let index = firstIndex; index <= lastIndex; index += 1) {
      nextLoadedPageIndexes.add(index);
    }

    nextLoadedPageIndexes.add(0);
    nextLoadedPageIndexes.add(1);
    this.loadedPageIndexes = nextLoadedPageIndexes;
    this.prefetch(pages, centerIndex, isPortraitMode);
  }

  prefetch(pages: readonly ComicPage[], centerIndex: number, isPortraitMode: boolean) {
    if (typeof Image === 'undefined') {
      return;
    }

    const pagesToPrefetch = isPortraitMode ? 3 : 4;
    const lastIndex = Math.min(pages.length - 1, centerIndex + pagesToPrefetch - 1);

    for (let index = Math.max(0, centerIndex); index <= lastIndex; index += 1) {
      const source = this.getPreferredPageSource(pages[index]);

      if (!source || this.prefetchedPageSources.has(source)) {
        continue;
      }

      this.prefetchedPageSources.add(source);

      const image = new Image();
      image.decoding = 'async';
      image.fetchPriority = index === centerIndex ? 'high' : 'low';
      image.onload = () => {
        this.activePagePrefetches.delete(source);
      };
      image.onerror = () => {
        this.activePagePrefetches.delete(source);
        this.prefetchedPageSources.delete(source);
      };

      this.activePagePrefetches.set(source, image);
      image.src = source;
    }
  }

  private getPreferredPageSource(page?: ComicPage) {
    if (!page) {
      return undefined;
    }

    const prefersMobileSource = window.matchMedia('(max-width: 900px)').matches;
    return prefersMobileSource
      ? page.mobileSrc ?? page.src ?? page.spreadSrc
      : page.src ?? page.mobileSrc ?? page.spreadSrc;
  }
}
