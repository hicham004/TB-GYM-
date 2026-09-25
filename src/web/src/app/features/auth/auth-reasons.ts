import type { AbstractControl } from '@angular/forms';

/**
 * Field messages shared by the signed-out forms. Each names what to do rather than what went wrong,
 * and restates the rule, because a field's error replaces its help text (docs/FRONTEND-DESIGN-SYSTEM.md).
 * They describe only what the browser can check; the server's own answers are shown as it words them.
 */
export function requiredReason(control: AbstractControl, message: string): string[] {
  return control.hasError('required') ? [message] : [];
}

export function emailReasons(control: AbstractControl): string[] {
  if (control.hasError('required')) return [$localize`Enter your email address.`];
  if (control.hasError('email')) {
    return [$localize`Enter an email address in the format name@example.com.`];
  }
  return [];
}

/** Matches the help under a new password: the server also checks the character mix. */
export function newPasswordReasons(control: AbstractControl): string[] {
  if (control.hasError('required') || control.hasError('minlength')) {
    return [$localize`Use at least 12 characters with upper, lower, number, and symbol.`];
  }
  return [];
}
