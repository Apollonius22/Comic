import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import type { ReaderControlInteraction } from '../chapter-menu/chapter-menu.component';
import type { ReaderFlipState, ReaderProgress } from '../../reader.models';

@Component({
  selector: 'app-reader-controls',
  templateUrl: './reader-controls.component.html',
  styleUrls: ['./reader-controls.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReaderControlsComponent {
  @Input() visible = true;
  @Input() currentIndex = 0;
  @Input() lastIndex = 0;
  @Input() canGoPrevious = false;
  @Input() canGoNext = false;
  @Input() isFullscreen = false;
  @Input() flipState: ReaderFlipState = 'read';
  @Input() progress: ReaderProgress = {
    primary: 'Comic',
    secondary: '1 of 1',
    ariaValueText: 'Comic, item 1 of 1',
  };

  @Output() previousRequested = new EventEmitter<void>();
  @Output() nextRequested = new EventEmitter<void>();
  @Output() fullscreenRequested = new EventEmitter<void>();
  @Output() scrubPreviewed = new EventEmitter<number>();
  @Output() scrubCommitted = new EventEmitter<number>();
  @Output() activity = new EventEmitter<void>();
  @Output() interactionStarted = new EventEmitter<ReaderControlInteraction>();
  @Output() interactionEnded = new EventEmitter<ReaderControlInteraction>();

  emitScrub(event: Event, output: EventEmitter<number>) {
    const input = event.target;

    if (input instanceof HTMLInputElement) {
      output.emit(Number(input.value));
    }
  }
}
