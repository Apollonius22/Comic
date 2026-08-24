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
});
