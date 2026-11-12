import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { query, settle } from '../../../testing/dom';
import { FEATURE_ROWS } from './home-content';
import { HomeRows } from './home-rows';

/**
 * What's inside as its page draws it. `signedIn` is what the homepage passes down inside the app
 * (notes plan N2); left out, the rows are the public website's, for a visitor.
 */
async function render(inputs: { signedIn?: boolean } = {}) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(HomeRows);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const TITLES = [
  'Build it once. Assign it in a tap.',
  'Every set, against the plan.',
  'Meals with real targets.',
  'Their week, in their words.',
  'The conversation lives with the coaching.',
  'The trend, not the noise.',
];

/** Each row's own words, which nobody loses: its eyebrow, its title and its one sentence. */
function rowWords(host: HTMLElement) {
  return Array.from(host.querySelectorAll('.row')).map((row) => ({
    eyebrow: textOf(row.querySelector('.row__eyebrow')),
    title: textOf(row.querySelector('.row__title')),
    body: textOf(row.querySelector('.row__body')),
  }));
}

const WORDS = FEATURE_ROWS.map(({ eyebrow, title, body }) => ({ eyebrow, title, body }));

describe('HomeRows', () => {
  it('gives a visitor six rows, each with its title, its sentence and one quiet link to sign-up', async () => {
    const { host } = await render();

    expect(rowWords(host).map((row) => row.title)).toEqual(TITLES);
    expect(rowWords(host)).toEqual(WORDS);
    const links = Array.from(host.querySelectorAll('.row .row__link'));
    expect(
      links.map((link) => [textOf(link.querySelector('span')), link.getAttribute('href')]),
    ).toEqual([
      ['Build your first program', '/auth/register'],
      ['Log a first workout', '/auth/register'],
      ["Set a client's targets", '/auth/register'],
      ['Write your check-in', '/auth/register'],
      ['Open your inbox', '/auth/register'],
      ["Follow a client's trend", '/auth/register'],
    ]);
    expect(host.querySelectorAll('[href="/auth/register"]')).toHaveLength(6);
    // One link a row, inside its copy.
    for (const row of Array.from(host.querySelectorAll('.row'))) {
      expect(row.querySelectorAll('.row__copy a')).toHaveLength(1);
    }
  });

  it('draws none of the six sign-up links for someone signed in, and keeps every row’s words and screens', async () => {
    const { fixture, host } = await render({ signedIn: true });

    expect(host.querySelector('[href="/auth/register"]')).toBeNull();
    expect(host.querySelectorAll('.row__link')).toHaveLength(0);
    expect(host.querySelectorAll('.row a')).toHaveLength(0);
    for (const row of FEATURE_ROWS) expect(host.textContent).not.toContain(row.link);

    expect(host.querySelectorAll('.row')).toHaveLength(6);
    expect(rowWords(host).map((row) => row.title)).toEqual(TITLES);
    expect(rowWords(host)).toEqual(WORDS);
    expect(host.querySelectorAll('.row .pair__window img')).toHaveLength(6);
    expect(host.querySelectorAll('.row .pair__phone img')).toHaveLength(6);
    // The headlines the page reveals line by line are all still there: the intro's and the six rows'.
    expect(fixture.componentInstance.titles().map((title) => title.className)).toEqual([
      'rows__title',
      ...Array<string>(6).fill('row__title'),
    ]);
  });

  it('tells a visitor on the clients’ strip that the coach sends the invitation, with Sign in for one who has joined', async () => {
    const { host } = await render();

    const strip = query(host, '.clients');
    expect(textOf(strip.querySelector('p'))).toBe(
      'Here as a client? Your coach sends the invitation. Already joined? Sign in.',
    );
    const links = Array.from(strip.querySelectorAll('a'));
    expect(links.map((link) => [textOf(link), link.getAttribute('href')])).toEqual([
      ['Sign in', '/auth/sign-in'],
    ]);
  });

  it('on the clients’ strip tells someone signed in just that the coach sends the invitation, with no link', async () => {
    const { host } = await render({ signedIn: true });

    const strip = query(host, '.clients');
    expect(strip.querySelectorAll('p')).toHaveLength(1);
    expect(textOf(strip)).toBe('Here as a client? Your coach sends the invitation.');
    expect(strip.querySelector('a')).toBeNull();
    expect(host.querySelector('[href="/auth/sign-in"]')).toBeNull();
    expect(host.querySelector('a')).toBeNull();
  });

  it('takes the links away and brings them back as the session becomes known', async () => {
    const { fixture, host } = await render();
    expect(host.querySelectorAll('[href="/auth/register"]')).toHaveLength(6);

    fixture.componentRef.setInput('signedIn', true);
    await settle(fixture);
    expect(host.querySelectorAll('a')).toHaveLength(0);

    fixture.componentRef.setInput('signedIn', false);
    await settle(fixture);
    expect(host.querySelectorAll('[href="/auth/register"]')).toHaveLength(6);
    expect(host.querySelectorAll('.clients a[href="/auth/sign-in"]')).toHaveLength(1);
  });
});
