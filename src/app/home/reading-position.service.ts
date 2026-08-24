import { Injectable } from '@angular/core';
import type { ComicPage } from './reader.models';

const LAST_PAGE_STORAGE_KEY = 'comic-reader:last-content-page';

@Injectable()
export class ReadingPositionService {
  readRequestedPageIndex(pageCount: number) {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const rawPage = new URL(window.location.href).searchParams.get('page');

    if (rawPage === null || rawPage.trim() === '') {
      return undefined;
    }

    const requestedIndex = Number(rawPage) - 1;
    return Number.isInteger(requestedIndex)
      && requestedIndex >= 0
      && requestedIndex < pageCount
      ? requestedIndex
      : undefined;
  }

  readStoredPageIndex(pageCount: number) {
    if (typeof localStorage === 'undefined') {
      return undefined;
    }

    try {
      const rawPageIndex = localStorage.getItem(LAST_PAGE_STORAGE_KEY);

      if (rawPageIndex === null) {
        return undefined;
      }

      const pageIndex = Number(rawPageIndex);
      return Number.isInteger(pageIndex)
        && pageIndex > 0
        && pageIndex < pageCount - 1
        ? pageIndex
        : undefined;
    } catch {
      return undefined;
    }
  }

  persist(pageIndex: number, page?: ComicPage) {
    if (page?.role === 'content') {
      try {
        localStorage.setItem(LAST_PAGE_STORAGE_KEY, String(pageIndex));
      } catch {
        // Reading progress is an enhancement; private browsing may reject it.
      }
    }

    this.updatePageUrl(pageIndex);
  }

  private updatePageUrl(pageIndex: number) {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const url = new URL(window.location.href);

      if (pageIndex <= 0) {
        url.searchParams.delete('page');
      } else {
        url.searchParams.set('page', String(pageIndex + 1));
      }

      window.history.replaceState(window.history.state, '', url);
    } catch {
      // Some embedded web views restrict History API updates.
    }
  }
}
