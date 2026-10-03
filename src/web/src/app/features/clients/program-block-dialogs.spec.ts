import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { programBlock, programWeek } from '../../../testing/client-program-fixtures';
import { press, settle } from '../../../testing/dom';
import { blockCard, type ProgramContext } from './client-program.models';
import { ProgramComplete } from './program-block-dialogs';

const context: ProgramContext = { locale: 'en-US', today: '2026-10-01', firstName: 'Maya' };

async function render(sessions: Parameters<typeof programWeek>[3]) {
  const api = { completeTrainingMesocycle: vi.fn(() => of({})) };
  TestBed.configureTestingModule({
    imports: [ProgramComplete],
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
    ],
  });
  const block = programBlock([programWeek('b', '2026-09-14', 1, sessions)], {
    id: 'b',
    status: 'Active',
    currentWeekNumber: 1,
    version: 7,
    name: 'Foundations',
  });
  const fixture = TestBed.createComponent(ProgramComplete);
  fixture.componentRef.setInput('block', blockCard(block, context));
  fixture.componentRef.setInput('firstName', 'Maya');
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api, closed };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Mark complete', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('closes the program once every session is done', async () => {
    const { fixture, host, api, closed } = await render(['Completed', 'Completed']);
    expect(textOf(host)).toContain('Mark Foundations complete? Every session is done');

    press(host, 'Mark complete');
    await settle(fixture);

    expect(api.completeTrainingMesocycle).toHaveBeenCalledWith('b', { version: 7 });
    expect(closed).toHaveBeenCalledWith(true);
  });

  it('says what is left instead of offering to close a program with sessions still to do', async () => {
    const { host, api } = await render(['Completed', 'Upcoming', 'Upcoming']);

    expect(textOf(host)).toContain(
      'Foundations can be marked complete once every session is finished. 2 sessions are still to go.',
    );
    expect(Array.from(host.querySelectorAll('button')).map(textOf)).toEqual(['Not now']);
    expect(api.completeTrainingMesocycle).not.toHaveBeenCalled();
  });

  it('says one session in the singular', async () => {
    const { host } = await render(['Completed', 'Today']);

    expect(textOf(host)).toContain('1 session is still to go.');
  });

  it('can be left without closing anything', async () => {
    const { fixture, host, closed } = await render(['Completed', 'Today']);

    press(host, 'Not now');
    await settle(fixture);

    expect(closed).toHaveBeenCalledWith(false);
  });
});
