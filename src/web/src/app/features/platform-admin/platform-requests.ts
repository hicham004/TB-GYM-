import { ChangeDetectionStrategy, Component, inject, LOCALE_ID, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { whatsAppLink } from '../../core/website/website-settings';
import { Button } from '../../ui/button';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill, type StatusPillTone } from '../../ui/status-pill';
import { PlatformAdminApi, type GymRequest } from './platform-admin-api';

export interface GymRequestRow {
  readonly id: string;
  readonly gymName: string;
  readonly name: string;
  readonly message: string | null;
  /** How the gym asked to be reached, as a label: "Email" or "WhatsApp". */
  readonly reachBy: string;
  readonly contact: string;
  /** A mailto: or wa.me address, or null when the number cannot make one. */
  readonly href: string | null;
  readonly opensNewTab: boolean;
  readonly received: string;
  readonly status: string;
  readonly tone: StatusPillTone;
}

/** One request as the admin reads it: who, how to reach them, what they wrote, and where its email stands. */
export function toGymRequestRow(request: GymRequest, locale: string): GymRequestRow {
  const byEmail = request.contactKind === 'Email';
  const received = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(request.receivedAtUtc));
  return {
    id: request.id,
    gymName: request.gymName,
    name: request.name,
    message: request.message,
    reachBy: byEmail ? $localize`Email` : $localize`WhatsApp`,
    contact: request.contact,
    href: byEmail ? `mailto:${request.contact}` : whatsAppLink(request.contact),
    opensNewTab: !byEmail,
    received: $localize`Received ${received}:when:`,
    status: request.deadLettered
      ? $localize`Email failed`
      : request.sending
        ? $localize`Sending`
        : $localize`Waiting for email`,
    tone: request.deadLettered ? 'danger' : request.sending ? 'info' : 'warning',
  };
}

/**
 * Requests from gyms (audit BEB-1): every Talk-to-us request whose email has not reached the admin,
 * so one sent while email is off, or given up after its four tries, is still read. Newest first;
 * read-only, because the admin replies to each gym outside TB Gym. It loads on its own, so the
 * billing above can fail without hiding a gym that is waiting for an answer.
 */
@Component({
  selector: 'app-platform-requests',
  imports: [Button, Skeleton, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" aria-labelledby="requests-heading" data-gym-requests>
      <div>
        <h2 id="requests-heading" i18n>Requests from gyms</h2>
        <p class="quiet" i18n>
          Talk-to-us requests whose email hasn’t reached you: waiting while email is off or no inbox
          is set, or given up after four tries. Reply to each gym yourself.
        </p>
      </div>
      @switch (state()) {
        @case ('loading') {
          <app-skeleton [label]="loadingLabel" [lines]="3" />
        }
        @case ('error') {
          <div class="load-failed">
            <p role="alert" i18n>Requests from gyms couldn’t be loaded.</p>
            <button appButton type="button" variant="outlined" (click)="load()" i18n>
              Try again
            </button>
          </div>
        }
        @default {
          @if (rows().length === 0) {
            <p class="quiet" data-no-requests i18n>
              None waiting. Every request reached your inbox.
            </p>
          } @else {
            <ul class="requests" role="list">
              @for (row of rows(); track row.id) {
                <li class="request" [attr.data-request]="row.id">
                  <div class="head">
                    <p class="gym">
                      <strong dir="auto">{{ row.gymName }}</strong
                      >&ngsp;<span class="name" dir="auto">{{ row.name }}</span>
                    </p>
                    <app-status-pill [label]="row.status" [tone]="row.tone" />
                  </div>
                  <p class="reach">
                    <span class="by">{{ row.reachBy }}</span
                    >&ngsp;
                    @if (row.href; as href) {
                      <a
                        class="contact"
                        [href]="href"
                        [attr.target]="row.opensNewTab ? '_blank' : null"
                        [attr.rel]="row.opensNewTab ? 'noopener noreferrer' : null"
                        dir="ltr"
                        translate="no"
                        >{{ row.contact }}</a
                      >
                    } @else {
                      <span dir="ltr" translate="no">{{ row.contact }}</span>
                    }
                  </p>
                  @if (row.message) {
                    <p class="message" dir="auto">{{ row.message }}</p>
                  }
                  <p class="quiet">{{ row.received }}</p>
                </li>
              }
            </ul>
          }
        }
      }
    </section>
  `,
  styleUrl: './platform-requests.scss',
})
export class PlatformRequests {
  private readonly api = inject(PlatformAdminApi);
  private readonly locale = inject(LOCALE_ID);

  protected readonly loadingLabel = $localize`Loading requests from gyms…`;
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly rows = signal<GymRequestRow[]>([]);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const requests = await firstValueFrom(this.api.getGymRequests());
      this.rows.set(requests.map((request) => toGymRequestRow(request, this.locale)));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }
}
