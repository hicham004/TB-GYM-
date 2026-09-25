import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { injectAutoplay } from './home-autoplay';

type LoopStepId = 'plan' | 'train' | 'checkin' | 'reply' | 'progress';

interface LoopStep {
  readonly id: LoopStepId;
  readonly label: string;
  readonly caption: string;
}

/**
 * The hero's live example: one week of coaching told from both sides, the coach's screen and the
 * client's phone. The picture is decorative and hidden from assistive technology; the visible step
 * buttons and caption carry the same story as text. All names and numbers are sample data.
 */
@Component({
  selector: 'app-home-loop',
  templateUrl: './home-loop.html',
  styleUrls: [
    './home-loop.scss',
    './home-loop-coach.scss',
    './home-loop-coach-steps.scss',
    './home-loop-phone.scss',
    './home-loop-phone-steps.scss',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeLoop {
  protected readonly steps: readonly LoopStep[] = [
    {
      id: 'plan',
      label: $localize`Plan`,
      caption: $localize`Build the session once and assign it. It is waiting in Maya's day when she opens TB Gym.`,
    },
    {
      id: 'train',
      label: $localize`Train`,
      caption: $localize`Maya logs every set against your prescription. What she lifted never overwrites what you planned.`,
    },
    {
      id: 'checkin',
      label: $localize`Check in`,
      caption: $localize`She answers your weekly check-in, and every answer lands in one timeline for you.`,
    },
    {
      id: 'reply',
      label: $localize`Reply`,
      caption: $localize`You reply in the same place, with her plan and history beside the conversation.`,
    },
    {
      id: 'progress',
      label: $localize`Progress`,
      caption: $localize`Her bodyweight trend and measurements build week by week, so you both see the change.`,
    },
  ];

  protected readonly autoplay = injectAutoplay(this.steps.length);
  protected readonly step = computed(() => this.steps[this.autoplay.active()]);
}
