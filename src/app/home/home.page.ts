import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { PageFlip } from 'page-flip/dist/js/page-flip.module.js';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePage implements AfterViewInit, OnDestroy {

  @ViewChild('bookHost', { static: true }) bookHost!: ElementRef<HTMLElement>;

  private readonly coverPages: string[] = [
    'assets/comics/bookends/cover.png',
    'assets/comics/bookends/inside_left.png',
  ];

  private readonly chapterPages: string[] = [
    'assets/comics/chapter1/page_1.png',
    'assets/comics/chapter1/page_2.png',
    'assets/comics/chapter1/page_3.png',
    'assets/comics/chapter1/page_4.png',
    'assets/comics/chapter1/page_5.png',
    'assets/comics/chapter1/page_6.png',
    'assets/comics/chapter1/page_7.png',
    'assets/comics/chapter1/page_8.png',
    'assets/comics/chapter1/page_9.png',
    'assets/comics/chapter1/page_10.png',
    'assets/comics/chapter1/page_11.png',
    'assets/comics/chapter1/page_12.png',
    'assets/comics/chapter1/page_13.png',
  ];

  private readonly endPages: string[] = [
    'assets/comics/bookends/blank.png',
    'assets/comics/bookends/inside_right.png',
    'assets/comics/bookends/end.png',
  ];

  pages: string[] = [
    ...this.coverPages,
    ...this.chapterPages,
    ...this.endPages,
  ];

  currentIndex = 0;
  showUI = false;
  showMenu = false;

  private pageFlip?: PageFlip;

  ngAfterViewInit() {
    this.pageFlip = new PageFlip(this.bookHost.nativeElement, {
      width: 520,
      height: 780,
      size: 'stretch',
      minWidth: 280,
      maxWidth: 560,
      minHeight: 420,
      maxHeight: 840,
      drawShadow: true,
      flippingTime: 1300,
      usePortrait: true,
      startZIndex: 10,
      autoSize: true,
      maxShadowOpacity: 0.55,
      showCover: true,
      mobileScrollSupport: false,
      swipeDistance: 20,
      disableFlipByClick: true,
    });

    this.pageFlip.on('flip', event => {
      this.currentIndex = Number(event.data);
    });

    this.pageFlip.loadFromHTML(
      Array.from(this.bookHost.nativeElement.querySelectorAll<HTMLElement>('.book-page'))
    );
  }

  ngOnDestroy() {
    this.pageFlip?.destroy();
  }

  get spreadStart() {
    return this.currentIndex + 1;
  }

  get spreadEnd() {
    return Math.min(this.currentIndex + 2, this.pages.length);
  }

  nextPage() {
    this.pageFlip?.flipNext('bottom');
  }

  prevPage() {
    this.pageFlip?.flipPrev('bottom');
  }

  toggleUI() {
    this.showUI = !this.showUI;
  }

  toggleMenu() {
    this.showMenu = !this.showMenu;
  }
}
