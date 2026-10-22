import { computed } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { FormAttempt } from './form-attempt';

const EMAIL = ['Enter an email.'];
const NAME = ['Enter a name.'];

describe('FormAttempt', () => {
  it('never shows a field with nothing wrong, however the form was used', () => {
    const attempt = new FormAttempt();
    attempt.touch('email');
    attempt.attempt();

    expect(attempt.shows('email', [])).toBe(false);
    expect(attempt.shows('name', [])).toBe(false);
  });

  it('keeps a message off a pristine form: nobody has left the field or tried to submit', () => {
    const attempt = new FormAttempt();

    expect(attempt.shows('email', EMAIL)).toBe(false);
    expect(attempt.wasTried()).toBe(false);
  });

  it('shows a field’s message once the person leaves that field, and only that field’s', () => {
    const attempt = new FormAttempt();
    attempt.touch('email');

    expect(attempt.shows('email', EMAIL)).toBe(true);
    expect(attempt.shows('name', NAME)).toBe(false);
    // Leaving a field is not a refused submit: the summary still says nothing.
    expect(attempt.wasTried()).toBe(false);
  });

  it('shows every outstanding message at once after a refused submit, live for a template', () => {
    const attempt = new FormAttempt();
    // What a template binds: it re-renders when the attempt changes.
    const nameShown = computed(() => attempt.shows('name', NAME));
    const tried = computed(() => attempt.wasTried());
    expect(nameShown()).toBe(false);
    expect(tried()).toBe(false);

    attempt.attempt();

    expect(nameShown()).toBe(true);
    expect(attempt.shows('email', EMAIL)).toBe(true);
    expect(tried()).toBe(true);
  });

  it('keeps a shown message while it is still true, drops it once fixed, and brings it back if broken again', () => {
    const attempt = new FormAttempt();
    attempt.touch('email');

    expect(attempt.shows('email', EMAIL)).toBe(true);
    expect(attempt.shows('email', [])).toBe(false);
    // Still left, so the field's next mistake shows at once instead of waiting for another blur.
    expect(attempt.shows('email', ['Use 254 characters or fewer.'])).toBe(true);
  });

  it('goes back to pristine on reset: after a save, or when the form is replaced', () => {
    const attempt = new FormAttempt();
    attempt.touch('email');
    attempt.attempt();
    const emailShown = computed(() => attempt.shows('email', EMAIL));
    expect(emailShown()).toBe(true);

    attempt.reset();

    expect(emailShown()).toBe(false);
    expect(attempt.shows('name', NAME)).toBe(false);
    expect(attempt.wasTried()).toBe(false);
  });

  it('leaving a field already left changes nothing its readers depend on', () => {
    const attempt = new FormAttempt();
    let evaluations = 0;
    const emailShown = computed(() => {
      evaluations += 1;
      return attempt.shows('email', EMAIL);
    });
    expect(emailShown()).toBe(false);

    attempt.touch('email');
    expect(emailShown()).toBe(true);
    expect(evaluations).toBe(2);

    // The second blur of the same field is not news: nothing bound to the form recomputes.
    attempt.touch('email');
    expect(emailShown()).toBe(true);
    expect(evaluations).toBe(2);
  });
});
