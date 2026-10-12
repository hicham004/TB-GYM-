import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { WEEK_STAGES } from './home-content';
import { HomeMotion, type HomeMotionTargets } from './home-motion';
import { HomePhone } from './home-phone';
import { HomeWindow } from './home-window';

/**
 * The week (UI plan R6.2f): four stages told from both sides, with the Mon–Sun strip as the
 * chapter label and the real screens of the sample demo. On a wide screen the panel of two
 * screens stays beside the stages while they scroll past, and `HomeMotion` changes its
 * composition as each stage reaches the line; on a phone every stage carries one asset of its
 * own, and a reader who asked for less motion gets each stage with both of its screens, still.
 */
@Component({
  selector: 'app-home-week',
  imports: [HomePhone, HomeWindow],
  templateUrl: './home-week.html',
  styleUrls: ['./home-week.scss', './home-week-panel.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeWeek {
  protected readonly days = [
    $localize`Mon`,
    $localize`Tue`,
    $localize`Wed`,
    $localize`Thu`,
    $localize`Fri`,
    $localize`Sat`,
    $localize`Sun`,
  ];
  protected readonly stages = WEEK_STAGES;
  protected readonly active = signal(0);
  protected readonly stage = computed(() => this.stages[this.active()]);
  protected readonly motionState = inject(HomeMotion).state;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly slots = viewChildren<ElementRef<HTMLElement>>('slot');
  private readonly stageElements = viewChildren<ElementRef<HTMLElement>>('stageCopy');
  private readonly stageTitles = viewChildren<ElementRef<HTMLElement>>('stageTitle');
  private readonly marker = viewChild<ElementRef<HTMLElement>>('marker');
  private readonly dayElements = viewChildren<ElementRef<HTMLElement>>('day');

  /** The headlines the page reveals line by line. */
  titles(): HTMLElement[] {
    return this.stageTitles().map((title) => title.nativeElement);
  }

  /** What the page's motion needs from this section. */
  motionTargets(): Omit<HomeMotionTargets, 'titles'> {
    return {
      week: this.host.querySelector('.week') ?? this.host,
      panel: this.panel().nativeElement,
      stages: this.stageElements().map((stage) => stage.nativeElement),
      slots: this.slots().map((slot) => slot.nativeElement),
      marker: this.marker()?.nativeElement ?? null,
      dayOf: (index) => this.dayElements()[this.stages[index].day]?.nativeElement ?? null,
      onStage: (index) => this.show(index),
    };
  }

  /**
   * Shows a stage. The panel's composition is a `data-stage` attribute the stylesheet keys on,
   * written to the element at once so Flip measures the new layout right after; the copy column's
   * marks follow through the signal.
   */
  private show(index: number): void {
    this.panel().nativeElement.setAttribute('data-stage', this.stages[index].id);
    this.active.set(index);
  }
}
