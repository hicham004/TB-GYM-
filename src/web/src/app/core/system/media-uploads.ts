import { computed, inject, Injectable } from '@angular/core';
import { SystemStatus } from './system-status';

/**
 * Whether this deployment takes uploaded pictures and videos at all (critique T25). One with no
 * media storage or scanner, such as the Render test copy, refuses every upload, so the screens that
 * offer one say so before the coach tries, rather than after. Until the answer arrives, and if it
 * cannot be read, uploads count as set up: a refused upload still says why.
 */
@Injectable({ providedIn: 'root' })
export class MediaUploads {
  private readonly status = inject(SystemStatus);

  /** True only once the server has said that it takes no uploads. */
  readonly off = computed(() => this.status.current()?.mediaUploadsAvailable === false);

  constructor() {
    void this.load();
  }

  load(): Promise<void> {
    return this.status.load();
  }
}
