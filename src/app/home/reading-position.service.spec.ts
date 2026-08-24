import { ReadingPositionService } from './reading-position.service';
import type { ComicPage } from './reader.models';

describe('ReadingPositionService', () => {
  const service = new ReadingPositionService();
  const contentPage: ComicPage = {
    role: 'content',
    density: 'soft',
    alt: 'Comic page',
  };

  beforeEach(() => {
    localStorage.removeItem('comic-reader:last-content-page');
    window.history.replaceState(window.history.state, '', window.location.pathname);
  });

  it('reads one-based page links as zero-based indexes', () => {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?page=9`);

    expect(service.readRequestedPageIndex(20)).toBe(8);
  });

  it('ignores invalid linked and stored positions', () => {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?page=999`);
    localStorage.setItem('comic-reader:last-content-page', '-1');

    expect(service.readRequestedPageIndex(20)).toBeUndefined();
    expect(service.readStoredPageIndex(20)).toBeUndefined();
  });

  it('persists content progress and updates the shareable URL', () => {
    service.persist(8, contentPage);

    expect(localStorage.getItem('comic-reader:last-content-page')).toBe('8');
    expect(new URL(window.location.href).searchParams.get('page')).toBe('9');
  });
});
