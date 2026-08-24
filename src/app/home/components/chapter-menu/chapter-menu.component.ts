import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import type { ChapterMarker, ReaderProgress } from '../../reader.models';

export type ReaderControlInteraction = 'focus' | 'pointer';

@Component({
  selector: 'app-chapter-menu',
  templateUrl: './chapter-menu.component.html',
  styleUrls: ['./chapter-menu.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChapterMenuComponent {
  @Input() markers: readonly ChapterMarker[] = [];
  @Input() currentPageIndex = 0;
  @Input() open = false;
  @Input() controlsHidden = false;
  @Input() resumePageIndex?: number;
  @Input() resumeProgress?: ReaderProgress;

  @Output() toggleRequested = new EventEmitter<void>();
  @Output() chapterSelected = new EventEmitter<ChapterMarker>();
  @Output() resumeRequested = new EventEmitter<void>();
  @Output() interactionStarted = new EventEmitter<ReaderControlInteraction>();
  @Output() interactionEnded = new EventEmitter<ReaderControlInteraction>();

  isCurrentChapter(marker: ChapterMarker) {
    return this.currentPageIndex >= marker.pageIndex
      && this.currentPageIndex <= marker.lastPageIndex;
  }
}
