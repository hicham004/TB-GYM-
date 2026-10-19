import { signal, type Provider } from '@angular/core';
import { EmailDelivery } from '../app/core/system/email-delivery';

/**
 * EmailDelivery without a server: email on, as most deployments have it, or off, as a deployment
 * with no email provider (the Render test copy) has it (audit LOST-1).
 */
export function provideEmailDelivery(off = false): Provider {
  return { provide: EmailDelivery, useValue: { off: signal(off).asReadonly() } };
}
