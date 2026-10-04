import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, press, query, settle } from '../../../testing/dom';
import { SavedRepliesSheet } from './saved-replies';
import { SavedRepliesApi } from './saved-replies-api';
import type { SavedReplies, SavedReply } from './saved-replies.models';

const reply = (id: string, title: string, body: string, version = 1): SavedReply => ({
  id,
  title,
  body,
  version,
});

const CHECK_IN = reply('r1', 'Check-in reminder', 'Your check-in is due today.');
const DELOAD = reply('r2', 'Deload week', 'Lighter this week, same sessions.');

function conflict(code: string): HttpErrorResponse {
  return new HttpErrorResponse({ status: 409, error: { code, title: 'Conflict' } });
}

interface Harness {
  fixture: ComponentFixture<SavedRepliesSheet>;
  host: HTMLElement;
  api: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    edit: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  used: string[];
}

async function render(
  replies: SavedReplies = { items: [CHECK_IN, DELOAD], maximum: 100 },
  draft = '',
): Promise<Harness> {
  const api = {
    list: vi.fn(() => of(replies)),
    create: vi.fn(),
    edit: vi.fn(),
    delete: vi.fn(),
  };
  await TestBed.configureTestingModule({
    imports: [SavedRepliesSheet],
    providers: [
      { provide: SavedRepliesApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(SavedRepliesSheet);
  fixture.componentRef.setInput('draft', draft);
  const used: string[] = [];
  fixture.componentInstance.use.subscribe((body) => used.push(body));
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, used };
}

function titles(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('.reply-title')).map((node) =>
    (node.textContent ?? '').trim(),
  );
}

async function type(harness: Harness, selector: string, value: string): Promise<void> {
  const control = query<HTMLInputElement | HTMLTextAreaElement>(harness.host, selector);
  control.value = value;
  control.dispatchEvent(new Event('input'));
  await settle(harness.fixture);
}

describe('SavedRepliesSheet', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('lists the coach’s replies and drops the chosen one into the composer without sending it', async () => {
    const harness = await render();

    expect(titles(harness.host)).toEqual(['Check-in reminder', 'Deload week']);
    query<HTMLButtonElement>(harness.host, '.use').click();
    expect(harness.used).toEqual(['Your check-in is due today.']);
    // Each reply's text describes its button, so it is heard, not only its title.
    const use = query(harness.host, '.use');
    expect(query(harness.host, `#${use.getAttribute('aria-describedby')}`).textContent).toContain(
      'Your check-in is due today.',
    );
  });

  it('finds a reply by its title or its text', async () => {
    const harness = await render();

    await type(harness, '#saved-reply-search', 'lighter');
    expect(titles(harness.host)).toEqual(['Deload week']);
    await type(harness, '#saved-reply-search', 'zz');
    expect(harness.host.textContent).toContain('No saved reply matches “zz”');
  });

  it('invites a first reply, starting from what the coach has written', async () => {
    const harness = await render({ items: [], maximum: 100 }, 'See you Friday at 7.');
    expect(harness.host.textContent).toContain('No saved replies yet');

    press(harness.host, 'New saved reply');
    await settle(harness.fixture);

    expect(query<HTMLTextAreaElement>(harness.host, 'textarea').value).toBe('See you Friday at 7.');
    expect(document.activeElement).toBe(query(harness.host, 'input[name="title"]'));
  });

  it('keeps a new reply and shows it in title order', async () => {
    const harness = await render();
    harness.api.create.mockReturnValue(of(reply('r3', 'Am I on track?', 'Yes, keep going.')));

    press(harness.host, 'New saved reply');
    await settle(harness.fixture);
    await type(harness, 'input[name="title"]', '  Am I on track?  ');
    await type(harness, 'textarea', ' Yes, keep going. ');
    press(harness.host, 'Save reply');
    await settle(harness.fixture);

    expect(harness.api.create).toHaveBeenCalledWith('Am I on track?', 'Yes, keep going.');
    expect(titles(harness.host)).toEqual(['Am I on track?', 'Check-in reminder', 'Deload week']);
  });

  it('refuses a reply with no title out loud, and asks the server nothing', async () => {
    const harness = await render();
    press(harness.host, 'New saved reply');
    await settle(harness.fixture);
    await type(harness, 'textarea', 'Text without a title');

    press(harness.host, 'Save reply');
    await settle(harness.fixture);

    expect(harness.api.create).not.toHaveBeenCalled();
    expect(query(harness.host, '.summary').textContent).toContain('Give the reply a short title.');
    expect(document.activeElement).toBe(query(harness.host, '.summary'));
  });

  it('changes a reply from the version read, and says so when another window changed it first', async () => {
    const harness = await render();
    harness.api.edit.mockReturnValue(throwError(() => conflict('saved_reply_stale_version')));

    query<HTMLButtonElement>(harness.host, 'button[aria-label="Edit Check-in reminder"]').click();
    await settle(harness.fixture);
    await type(harness, 'input[name="title"]', 'Check-in due');
    press(harness.host, 'Save reply');
    await settle(harness.fixture);

    expect(harness.api.edit).toHaveBeenCalledWith(
      'r1',
      'Check-in due',
      'Your check-in is due today.',
      1,
    );
    expect(query(harness.host, '.summary').textContent).toContain('changed in another window');
    // The list is read again so the next attempt starts from the latest version.
    expect(harness.api.list).toHaveBeenCalledTimes(2);
  });

  it('deletes only after asking, and treats a reply already gone as gone', async () => {
    const harness = await render();
    harness.api.delete.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    query<HTMLButtonElement>(harness.host, 'button[aria-label="Edit Deload week"]').click();
    await settle(harness.fixture);
    press(harness.host, 'Delete');
    await settle(harness.fixture);
    expect(harness.host.textContent).toContain('Delete “Deload week”? This can’t be undone.');
    expect(harness.api.delete).not.toHaveBeenCalled();

    press(harness.host, 'Delete reply');
    await settle(harness.fixture);

    expect(harness.api.delete).toHaveBeenCalledWith('r2', 1);
    expect(titles(harness.host)).toEqual(['Check-in reminder']);
  });

  it('stops offering new replies at the limit, and explains a refusal at it', async () => {
    const full = await render({ items: [CHECK_IN, DELOAD], maximum: 2 });
    expect(full.host.textContent).toContain('You keep 2 of 2. Delete one to add another.');
    expect(full.host.textContent).not.toContain('New saved reply');
    TestBed.resetTestingModule();

    const racing = await render({ items: [CHECK_IN], maximum: 2 });
    racing.api.create.mockReturnValue(throwError(() => conflict('saved_reply_limit_reached')));
    press(racing.host, 'New saved reply');
    await settle(racing.fixture);
    await type(racing, 'input[name="title"]', 'One more');
    await type(racing, 'textarea', 'Text');
    press(racing.host, 'Save reply');
    await settle(racing.fixture);
    expect(query(racing.host, '.summary').textContent).toContain(
      'You can keep up to 2 saved replies.',
    );
  });

  it('offers to keep what the coach wrote when there is something', async () => {
    const harness = await render(undefined, 'Great session today!');

    expect(button(harness.host, 'Save what you wrote')).toBeTruthy();
  });
});
