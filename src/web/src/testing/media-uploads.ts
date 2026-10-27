import { signal, type Provider } from '@angular/core';
import { MediaUploads } from '../app/core/system/media-uploads';

/**
 * MediaUploads without a server: uploads set up, as most deployments have them, or off, as a
 * deployment with no media storage (the Render test copy) has them (critique T25).
 */
export function provideMediaUploads(off = false): Provider {
  return { provide: MediaUploads, useValue: { off: signal(off).asReadonly() } };
}
