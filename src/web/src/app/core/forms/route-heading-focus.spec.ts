import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, expect, it } from 'vitest';
import { settle } from '../../../testing/dom';
import { RouteHeadingFocus } from './route-heading-focus';

@Component({ template: '<main id="main-content"></main>' })
class Page {
  constructor() {
    inject(RouteHeadingFocus);
  }
}

async function render() {
  const events = new Subject<NavigationEnd>();
  TestBed.configureTestingModule({
    imports: [Page],
    providers: [{ provide: Router, useValue: { events } }],
  });
  const fixture = TestBed.createComponent(Page);
  document.body.append(fixture.nativeElement);
  await settle(fixture);
  const main = fixture.nativeElement.querySelector('main') as HTMLElement;
  const navigate = async (url: string) => {
    events.next(new NavigationEnd(1, url, url));
    await settle(fixture);
  };
  return { fixture, main, navigate };
}

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.replaceChildren();
});

it('focuses a new route heading without changing the router’s scroll position', async () => {
  const { main, navigate } = await render();
  main.innerHTML = '<h1>Appearance</h1>';
  await navigate('/account/appearance');
  expect(document.activeElement).toBe(main.querySelector('h1'));
  expect(main.querySelector('h1')?.tabIndex).toBe(-1);
});

it('waits for an asynchronous heading and stops watching once the person starts typing', async () => {
  const { fixture, main, navigate } = await render();
  await navigate('/progress');
  main.innerHTML = '<h1>Progress</h1>';
  await settle(fixture);
  expect(document.activeElement).toBe(main.querySelector('h1'));
  main.replaceChildren();
  await navigate('/nutrition');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  main.innerHTML = '<h1>Meals</h1>';
  await settle(fixture);
  expect(document.activeElement).not.toBe(main.querySelector('h1'));
});

it('keeps deliberate field focus and does not reset it for a filter or anchor link', async () => {
  const { main, navigate } = await render();
  main.innerHTML = '<h1>Exercises</h1><input aria-label="Search">';
  const field = main.querySelector('input')!;
  field.focus();
  await navigate('/training/exercises');
  expect(document.activeElement).toBe(field);
  await navigate('/training/exercises?muscle=Back');
  expect(document.activeElement).toBe(field);
  await navigate('/#tour');
  expect(document.activeElement).toBe(field);
});
