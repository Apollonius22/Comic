declare module 'page-flip/dist/js/page-flip.module.js' {
  export type FlipCorner = 'top' | 'bottom';
  export type PageFlipEvent = {
    data: number | string | { page: number; mode: 'portrait' | 'landscape' };
  };

  export class PageFlip {
    constructor(element: HTMLElement, settings: Record<string, unknown>);
    destroy(): void;
    update(): void;
    getSettings(): { usePortrait: boolean };
    getOrientation(): 'portrait' | 'landscape';
    getCurrentPageIndex(): number;
    getPageCount(): number;
    loadFromHTML(items: HTMLElement[]): void;
    turnToPage(page: number): void;
    flipNext(corner?: FlipCorner): void;
    flipPrev(corner?: FlipCorner): void;
    on(eventName: string, callback: (event: PageFlipEvent) => void): PageFlip;
  }
}
