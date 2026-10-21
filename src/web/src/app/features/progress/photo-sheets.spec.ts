import { HttpErrorResponse } from '@angular/common/http';
import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { formSummary, press, settle } from '../../../testing/dom';
import { mayaPhotos, photo, TODAY } from '../../../testing/progress-fixtures';
import { AddPhotos, PhotoView } from './photo-sheets';
import { ProgressEntriesApi } from './progress-entries-api';
import { photoLists, type Audience } from './progress-entries.models';

const client: Audience = { coach: false, firstName: null, locale: 'en' };
const coach: Audience = { coach: true, firstName: 'Maya', locale: 'en' };

type Api = Partial<Record<keyof ProgressEntriesApi, ReturnType<typeof vi.fn>>>;

async function render<T>(component: Type<T>, inputs: Record<string, unknown>, api: Api = {}) {
  await TestBed.configureTestingModule({
    imports: [component],
    providers: [
      { provide: ProgressEntriesApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal('tenant-1'),
          selectedMembership: signal({ tenantName: 'Atlas Performance' }),
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries({ audience: client, today: TODAY, ...inputs })) {
    fixture.componentRef.setInput(name, value);
  }
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const refusal = (status: number, code: string, title = 'Refused') =>
  new HttpErrorResponse({ status, error: { code, title } });

/** A file as the picker hands it over: its name, its kind and, when it matters, its size. */
function file(name: string, type = 'image/jpeg', size?: number): File {
  const made = new File(['pixels'], name, { type });
  if (size !== undefined) Object.defineProperty(made, 'size', { value: size });
  return made;
}

async function choose(
  fixture: Parameters<typeof settle>[0],
  host: HTMLElement,
  pose: string,
  chosen: File,
) {
  const input = host.querySelector<HTMLInputElement>(`input[data-file="${pose}"]`)!;
  Object.defineProperty(input, 'files', { configurable: true, value: [chosen] });
  input.dispatchEvent(new Event('change'));
  await settle(fixture);
}

const tile = (id = 'photo-Front-2026-10-03') => {
  const lists = photoLists(mayaPhotos(), client);
  return [...lists.days.flatMap((day) => day.tiles), ...lists.removed].find(
    (item) => item.photo.id === id,
  )!;
};

describe('Add photos', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('has a place for the front, side and back, and says who will see them', async () => {
    const { host } = await render(AddPhotos, {});

    expect(Array.from(host.querySelectorAll('.slot strong')).map(textOf)).toEqual([
      'Front',
      'Side',
      'Back',
    ]);
    // The owner sees them too (CLI-013, audit LOST-3), named as the intake names them.
    expect(textOf(host.querySelector('p.muted'))).toBe(
      'Your coach and the owner of Atlas Performance can see these photos. If you remove one later, it disappears from their view.',
    );
  });

  it('tells a coach the client can see them too', async () => {
    const { host } = await render(AddPhotos, { audience: coach, clientId: 'client-9' });

    expect(textOf(host.querySelector('p.muted'))).toBe(
      'Maya can see these photos too. Removing one takes it out of your view, and they keep it.',
    );
  });

  it('shows what was chosen, saves it for today and closes with the count', async () => {
    const addPhoto = vi.fn(() => of(photo()));
    const { fixture, host } = await render(AddPhotos, {}, { addPhoto });
    const closed = vi.fn();
    const changed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.componentInstance.changed.subscribe(changed);

    const front = file('front.jpg');
    const back = file('back.png', 'image/png');
    await choose(fixture, host, 'Front', front);
    await choose(fixture, host, 'Back', back);
    expect(textOf(host.querySelector('[data-slot="Front"] .file'))).toBe('front.jpg · 1 KB');
    press(host, 'Save photos');
    await settle(fixture);

    expect(addPhoto.mock.calls).toEqual([
      [null, 'Front', null, front],
      [null, 'Back', null, back],
    ]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith(2);
  });

  it('adds for a client, on the day chosen, when a coach is the one adding', async () => {
    const addPhoto = vi.fn(() => of(photo()));
    const { fixture, host } = await render(
      AddPhotos,
      { audience: coach, clientId: 'client-9' },
      { addPhoto },
    );

    await choose(fixture, host, 'Side', file('side.jpg'));
    await chooseDay(fixture, host, 'Day the photos were taken', '2026-10-06');
    press(host, 'Save photos');
    await settle(fixture);
    expect(addPhoto).toHaveBeenCalledWith('client-9', 'Side', '2026-10-06', expect.any(File));
  });

  it('says why a file cannot be a progress photo, and keeps the place empty', async () => {
    const addPhoto = vi.fn(() => of(photo()));
    const { fixture, host } = await render(AddPhotos, {}, { addPhoto });

    await choose(fixture, host, 'Front', file('front.heic', 'image/heic'));
    expect(textOf(host.querySelector('[data-slot="Front"] .slot-problem'))).toBe(
      'Choose a JPEG or PNG photo.',
    );
    await choose(fixture, host, 'Side', file('big.jpg', 'image/jpeg', 16 * 1024 * 1024));
    expect(textOf(host.querySelector('[data-slot="Side"] .slot-problem'))).toBe(
      'That photo is larger than 15 MB. Choose a smaller one.',
    );
    press(host, 'Save photos');
    await settle(fixture);
    expect(textOf(host)).toContain('Choose at least one photo.');
    expect(addPhoto).not.toHaveBeenCalled();
  });

  it('clears a place so the file can be chosen again', async () => {
    const { fixture, host } = await render(AddPhotos, {}, {});
    const dirty = vi.fn();
    fixture.componentInstance.dirtyChange.subscribe(dirty);

    await choose(fixture, host, 'Front', file('front.jpg'));
    expect(dirty).toHaveBeenLastCalledWith(true);
    press(host, 'Clear Front');
    await settle(fixture);
    expect(host.querySelector('[data-slot="Front"] .file')).toBeNull();
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it('keeps a refused photo marked with its reason while the others are saved, and sends only it again', async () => {
    const addPhoto = vi
      .fn()
      .mockReturnValueOnce(throwError(() => refusal(409, 'ProgressPhotoAlreadyExists')))
      .mockReturnValue(of(photo()));
    const { fixture, host } = await render(AddPhotos, {}, { addPhoto });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    await choose(fixture, host, 'Front', file('front.jpg'));
    await choose(fixture, host, 'Side', file('side.jpg'));
    press(host, 'Save photos');
    await settle(fixture);

    expect(closed).not.toHaveBeenCalled();
    expect(textOf(host.querySelector('[data-slot="Front"] .slot-problem'))).toBe(
      'A front photo is already saved for Sat 10 Oct. Remove it first, or choose another day.',
    );
    expect(textOf(host.querySelector('[data-slot="Side"]'))).toContain('Saved');
    expect(textOf(formSummary(host))).toBe(
      'Some photos were saved. The ones marked above were not.',
    );
    expect(document.activeElement).toBe(formSummary(host));

    press(host, 'Save photos');
    await settle(fixture);
    expect(addPhoto).toHaveBeenCalledTimes(3);
    expect(addPhoto.mock.calls[2][1]).toBe('Front');
    expect(closed).toHaveBeenCalledWith(2);
  });

  it('closes with nothing saved on Not now', async () => {
    const { fixture, host } = await render(AddPhotos, {}, {});
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toHaveBeenCalledWith(0);
  });
});

describe('A photo', () => {
  afterEach(() => TestBed.resetTestingModule());

  const access = (thumbnailUrl: string | null) =>
    of({ photoId: 'photo-Front-2026-10-03', fullUrl: '/api/media/a/content', thumbnailUrl });

  it('opens small first and loads the full size only when asked, with one grant', async () => {
    const openPhoto = vi.fn(() => access('/api/media/a/content/thumbnail'));
    const { fixture, host } = await render(PhotoView, { tile: tile() }, { openPhoto });

    expect(textOf(host.querySelector('.about'))).toBe('Front · Sat 3 Oct Added by you');
    expect(host.querySelector('img')!.getAttribute('src')).toBe('/api/media/a/content/thumbnail');
    expect(host.querySelector('img')!.getAttribute('alt')).toBe('Front · Sat 3 Oct progress photo');
    press(host, 'Load full size');
    await settle(fixture);
    expect(host.querySelector('img')!.getAttribute('src')).toBe('/api/media/a/content');
    expect(textOf(host)).not.toContain('Load full size');
    expect(openPhoto).toHaveBeenCalledTimes(1);
  });

  it('shows the full image straight away when nothing smaller exists', async () => {
    const { host } = await render(
      PhotoView,
      { tile: tile() },
      { openPhoto: vi.fn(() => access(null)) },
    );

    expect(host.querySelector('img')!.getAttribute('src')).toBe('/api/media/a/content');
    expect(textOf(host)).not.toContain('Load full size');
  });

  it('offers to try again when the photo could not be opened', async () => {
    const openPhoto = vi
      .fn()
      .mockReturnValueOnce(throwError(() => refusal(403, 'x', 'Not allowed')))
      .mockReturnValue(access('/api/media/a/content/thumbnail'));
    const { fixture, host } = await render(PhotoView, { tile: tile() }, { openPhoto });

    expect(textOf(host.querySelector('[role="alert"]'))).toBe('Not allowed');
    press(host, 'Try again');
    await settle(fixture);
    expect(host.querySelector('img')).not.toBeNull();
  });

  it('removes it with a reason, and tells the page', async () => {
    const removed = photo({ status: 'Removed', version: 2 });
    const removePhoto = vi.fn(() => of(removed));
    const { fixture, host } = await render(
      PhotoView,
      { tile: tile() },
      { openPhoto: vi.fn(() => access(null)), removePhoto },
    );
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    press(host, 'Remove photo');
    await settle(fixture);
    expect(textOf(host)).toContain('It leaves your coach’s view. You keep it in your own history.');
    press(host, 'Remove photo');
    await settle(fixture);
    expect(textOf(host)).toContain('Choose what was wrong.');
    expect(removePhoto).not.toHaveBeenCalled();

    const label = Array.from(host.querySelectorAll('label')).find(
      (item) => textOf(item) === 'Wrong pose',
    )!;
    label.querySelector<HTMLInputElement>('input')!.click();
    await settle(fixture);
    press(host, 'Remove photo');
    await settle(fixture);

    expect(removePhoto).toHaveBeenCalledWith(null, 'photo-Front-2026-10-03', {
      reason: 'Wrong pose',
      version: 1,
    });
    expect(closed).toHaveBeenCalledWith(removed);
  });

  it('says why a removal was refused in the summary, which takes focus, keeping the reason', async () => {
    const removePhoto = vi.fn(() => throwError(() => refusal(409, 'ProgressPhotoAlreadyRemoved')));
    const { fixture, host } = await render(
      PhotoView,
      { tile: tile() },
      { openPhoto: vi.fn(() => access(null)), removePhoto },
    );
    const stale = vi.fn();
    fixture.componentInstance.stale.subscribe(stale);

    press(host, 'Remove photo');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe('');
    const label = Array.from(host.querySelectorAll('label')).find(
      (item) => textOf(item) === 'Wrong pose',
    )!;
    label.querySelector<HTMLInputElement>('input')!.click();
    await settle(fixture);
    press(host, 'Remove photo');
    await settle(fixture);

    expect(textOf(formSummary(host))).toBe(
      'This entry changed while it was open. The list has been read again, so try once more.',
    );
    expect(document.activeElement).toBe(formSummary(host));
    expect(stale).toHaveBeenCalled();
    expect(label.querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  });

  it('goes back to looking at the photo on Keep it', async () => {
    const { fixture, host } = await render(
      PhotoView,
      { tile: tile() },
      { openPhoto: vi.fn(() => access(null)) },
    );
    const dirty = vi.fn();
    fixture.componentInstance.dirtyChange.subscribe(dirty);

    press(host, 'Remove photo');
    await settle(fixture);
    press(host, 'Keep it');
    await settle(fixture);
    expect(host.querySelector('form.remove')).toBeNull();
    expect(textOf(host)).toContain('Remove photo');
  });

  it('tells a coach the client keeps it', async () => {
    const { fixture, host } = await render(
      PhotoView,
      { tile: tile(), audience: coach, clientId: 'client-9' },
      { openPhoto: vi.fn(() => access(null)) },
    );

    press(host, 'Remove photo');
    await settle(fixture);
    expect(textOf(host)).toContain(
      'It leaves your view. The client keeps it in their own history.',
    );
    expect(textOf(host)).toContain('The client asked for it to be removed');
  });

  it('can be looked at once removed, but not removed again', async () => {
    const { host } = await render(
      PhotoView,
      { tile: tile('photo-Side-2026-09-05') },
      { openPhoto: vi.fn(() => access(null)) },
    );

    expect(textOf(host)).toContain('You removed this photo.');
    expect(Array.from(host.querySelectorAll('button')).map(textOf)).toEqual(['Close']);
  });
});

/** Opens the calendar of the date field named `label` and chooses a day, turning pages as a person would. */
async function chooseDay(
  fixture: Parameters<typeof settle>[0],
  scope: ParentNode,
  label: string,
  iso: string,
) {
  const dateField = Array.from(scope.querySelectorAll('app-date-field')).find(
    (candidate) => textOf(candidate.querySelector('label')) === label,
  )!;
  dateField.querySelector<HTMLButtonElement>('button.trigger')!.click();
  await settle(fixture);
  for (let turn = 0; turn < 36; turn++) {
    const target = dateField.querySelector<HTMLButtonElement>(`button.day[data-date="${iso}"]`);
    if (target) {
      target.click();
      await settle(fixture);
      return;
    }
    const first = dateField.querySelector<HTMLElement>('button.day')!.dataset['date']!;
    dateField
      .querySelector<HTMLButtonElement>(
        `button[aria-label="${iso < first ? 'Previous month' : 'Next month'}"]`,
      )!
      .click();
    await settle(fixture);
  }
  throw new Error(`The calendar never showed ${iso}.`);
}
