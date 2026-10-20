import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';

import { HomePage } from './home.page';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    localStorage.removeItem('comic-reader:last-content-page');
    window.history.replaceState(window.history.state, '', window.location.pathname);
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  function readerBox(width: number, height: number) {
    const reader = fixture.nativeElement.querySelector('.reader') as HTMLElement;
    Object.assign(reader.style, {
      width: `${width}px`, height: `${height}px`, minHeight: '0', transition: 'none',
    });
    fixture.detectChanges();
    return reader;
  }

  function expectBookInside(reader: HTMLElement) {
    const area = reader.getBoundingClientRect();
    const style = getComputedStyle(reader);
    for (const selector of ['.book-shell', '.book']) {
      const rect = (reader.querySelector(selector) as HTMLElement).getBoundingClientRect();
      expect(rect.width).withContext(selector).toBeGreaterThan(0);
      expect(rect.height).withContext(selector).toBeGreaterThan(0);
      expect(rect.left).withContext(selector).toBeGreaterThanOrEqual(area.left + parseFloat(style.paddingLeft) - 1);
      expect(rect.right).withContext(selector).toBeLessThanOrEqual(area.right - parseFloat(style.paddingRight) + 1);
      expect(rect.top).withContext(selector).toBeGreaterThanOrEqual(area.top + parseFloat(style.paddingTop) - 1);
      expect(rect.bottom).withContext(selector).toBeLessThanOrEqual(area.bottom - parseFloat(style.paddingBottom) + 1);
    }
  }

  it('fits the whole spread into a short desktop content box', () => {
    expectBookInside(readerBox(1280, 720));
  });

  it('fits very short windows without the page-flip minimum height overflowing', () => {
    expectBookInside(readerBox(1280, 200));
  });

  it('reserves space for visible navigation instead of clipping the book', () => {
    const reader = readerBox(1280, 720);
    const shell = reader.querySelector('.book-shell') as HTMLElement;
    const originalHeight = shell.getBoundingClientRect().height;
    component.showPageNavigation = true;
    fixture.detectChanges();
    expectBookInside(reader);
    expect(shell.getBoundingClientRect().height).toBeLessThan(originalHeight);
  });

  it('preserves a single-page shell aspect ratio in portrait mode', () => {
    component.readerOrientation = 'portrait';
    const reader = readerBox(390, 844);
    const rect = (reader.querySelector('.book-shell') as HTMLElement).getBoundingClientRect();
    expect(rect.width / rect.height).toBeCloseTo(2 / 3, 3);
    expectBookInside(reader);
  });

  it('reserves fullscreen control space while still fitting the full book', () => {
    component.isFullscreen = true;
    component.showPageNavigation = true;
    expectBookInside(readerBox(1280, 720));
  });

  it('contains content images without stretching or horizontally zooming them', () => {
    const image = fixture.nativeElement.querySelector('.content-page .page-image') as HTMLImageElement;
    expect(image).not.toBeNull();
    expect(getComputedStyle(image).objectFit).toBe('contain');
    expect(getComputedStyle(image.closest('.page-picture') as HTMLElement).transform).toBe('none');
  });

  it('updates actual page bounds when controls resize the book without a window resize', async () => {
    const reader = readerBox(1280, 720);
    const settleLayout = () => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await settleLayout();
    component.showPageNavigation = true;
    fixture.detectChanges();
    await settleLayout();
    expectBookInside(reader);
    const shell = (reader.querySelector('.book-shell') as HTMLElement).getBoundingClientRect();
    for (const page of Array.from(reader.querySelectorAll<HTMLElement>('.book-page'))) {
      const rect = page.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      expect(rect.top).toBeGreaterThanOrEqual(shell.top - 1);
      expect(rect.bottom).toBeLessThanOrEqual(shell.bottom + 1);
    }
  });

  it('does not reveal fullscreen controls when the center of the book is clicked', () => {
    component.isFullscreen = true;
    component.showPageNavigation = false;

    const bookShell = fixture.nativeElement.querySelector('.book-shell') as HTMLElement;
    const bounds = bookShell.getBoundingClientRect();
    bookShell.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: bounds.left + bounds.width / 2,
    }));

    expect(component.showPageNavigation).toBeFalse();
  });

  it('reveals controls only when the background outside the book is clicked', () => {
    component.showPageNavigation = false;

    const bookShell = fixture.nativeElement.querySelector('.book-shell') as HTMLElement;
    bookShell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(component.showPageNavigation).toBeFalse();

    const reader = fixture.nativeElement.querySelector('.reader') as HTMLElement;
    reader.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(component.showPageNavigation).toBeTrue();
  });

  it('keeps fullscreen controls visible while focus remains inside them', fakeAsync(() => {
    component.isFullscreen = true;
    component.showPageNavigation = true;

    component.pauseFullscreenControls('focus');
    component.pauseFullscreenControls('pointer');
    component.resumeFullscreenControls('pointer');
    tick(3100);

    expect(component.showPageNavigation).toBeTrue();

    component.resumeFullscreenControls('focus');
    tick(3100);

    expect(component.showPageNavigation).toBeFalse();
  }));

  it('closes the chapter menu when scrubbing to another page', () => {
    component.showMenu = true;

    component.commitPageScrub(8);

    expect(component.showMenu).toBeFalse();
    expect(component.currentIndex).toBeGreaterThanOrEqual(7);
    expect(component.currentIndex).toBeLessThanOrEqual(8);
    expect(component.scrubTargetIndex).toBe(component.currentIndex);
  });

  it('uses the animated previous-page method for a managed mobile swipe', () => {
    const flipPrev = jasmine.createSpy('flipPrev');
    const pageFlip = {
      destroy: jasmine.createSpy('destroy'),
      getCurrentPageIndex: () => 8,
      getOrientation: () => 'portrait' as const,
      flipPrev,
    };
    const startTouch = {
      identifier: 1,
      clientX: 100,
      clientY: 300,
    } as Touch;
    const endTouch = {
      identifier: 1,
      clientX: 220,
      clientY: 302,
    } as Touch;
    const stopPropagation = jasmine.createSpy('stopPropagation');

    component.currentIndex = 8;
    component.readerOrientation = 'portrait';
    (component as unknown as { managesTouchSwipeNavigation: boolean })
      .managesTouchSwipeNavigation = true;
    (component as unknown as { pageFlip: typeof pageFlip }).pageFlip = pageFlip;

    component.onBookTouchStart({
      touches: { length: 1, item: () => startTouch },
    } as unknown as TouchEvent);
    component.onBookTouchEnd({
      changedTouches: { length: 1, item: () => endTouch },
      cancelable: true,
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation,
    } as unknown as TouchEvent);

    expect(stopPropagation).toHaveBeenCalled();
    expect(flipPrev).toHaveBeenCalledOnceWith('bottom');
  });
});
