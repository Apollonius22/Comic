import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-magic-backdrop',
  templateUrl: './magic-backdrop.component.html',
  styleUrls: ['./magic-backdrop.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MagicBackdropComponent {}
