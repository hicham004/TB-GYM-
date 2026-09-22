import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { provideRouter, Router, RouterLink } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { query, settle } from '../../testing/dom';
import { Button, ButtonLink, IconButton } from './button';
import { Icon } from './icon';

@Component({ template: '' })
class Destination {}

@Component({
  imports: [Button, ButtonLink, FormsModule, Icon, IconButton, RouterLink],
  template: `
    <form (ngSubmit)="submits.set(submits() + 1)">
      <input name="query" aria-label="Query" />
      <button
        id="save"
        appButton
        type="submit"
        [loading]="saving()"
        (click)="clicks.set(clicks() + 1)"
      >
        Save changes
      </button>
      <button id="cancel" appButton type="button" variant="outlined" size="touch">Cancel</button>
      <button
        id="publish"
        appButton
        type="button"
        variant="text"
        disabled
        (click)="blocked.set(true)"
      >
        Publish
      </button>
      <button
        id="bell"
        appIconButton
        type="button"
        label="Notifications"
        [loading]="saving()"
        (click)="bellPresses.set(bellPresses() + 1)"
      >
        <app-icon name="bell" />
      </button>
    </form>
    <a id="next" appButton variant="outlined" routerLink="/next">Next step</a>
  `,
})
class Host {
  readonly saving = signal(false);
  readonly clicks = signal(0);
  readonly submits = signal(0);
  readonly bellPresses = signal(0);
  readonly blocked = signal(false);
}

async function render() {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [provideRouter([{ path: 'next', component: Destination }])],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, component: fixture.componentInstance };
}

describe('appButton', () => {
  it('always renders an explicit type, so a plain button never submits its form', async () => {
    const { host } = await render();

    expect(query(host, '#save').getAttribute('type')).toBe('submit');
    expect(query(host, '#cancel').getAttribute('type')).toBe('button');
    expect(query(host, '#publish').getAttribute('type')).toBe('button');
  });

  it('maps variant and size onto the design-system classes', async () => {
    const { host } = await render();

    expect(query(host, '#save').className).toContain('tb-button tb-button--filled');
    expect(query(host, '#cancel').classList).toContain('tb-button--outlined');
    expect(query(host, '#cancel').classList).toContain('tb-button--touch');
    expect(query(host, '#publish').classList).toContain('tb-button--text');
  });

  it('submits and fires its handler once per click when idle', async () => {
    const { fixture, host, component } = await render();

    query<HTMLButtonElement>(host, '#save').click();
    await settle(fixture);

    expect(component.clicks()).toBe(1);
    expect(component.submits()).toBe(1);
  });

  it('while loading, swallows clicks before any handler and cancels the form submission', async () => {
    const { fixture, host, component } = await render();
    component.saving.set(true);
    await settle(fixture);
    const save = query<HTMLButtonElement>(host, '#save');

    save.click();
    save.click();
    await settle(fixture);

    expect(component.clicks()).toBe(0);
    expect(component.submits()).toBe(0);
  });

  it('keeps a loading button focusable and announces it as unavailable', async () => {
    const { fixture, host, component } = await render();
    const save = query<HTMLButtonElement>(host, '#save');
    save.focus();

    component.saving.set(true);
    await settle(fixture);

    expect(save.disabled).toBe(false);
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(save.classList).toContain('tb-button--loading');
    expect(document.activeElement).toBe(save);
  });

  it('works again as soon as loading ends', async () => {
    const { fixture, host, component } = await render();
    component.saving.set(true);
    await settle(fixture);
    component.saving.set(false);
    await settle(fixture);
    const save = query<HTMLButtonElement>(host, '#save');

    save.click();
    await settle(fixture);

    expect(save.hasAttribute('aria-disabled')).toBe(false);
    expect(component.clicks()).toBe(1);
    expect(component.submits()).toBe(1);
  });

  it('leaves a natively disabled button inert', async () => {
    const { fixture, host, component } = await render();
    const publish = query<HTMLButtonElement>(host, '#publish');

    publish.click();
    await settle(fixture);

    expect(publish.disabled).toBe(true);
    expect(component.blocked()).toBe(false);
  });
});

describe('appButton on a link', () => {
  it('stays a real link: an href, no button type, no disabled semantics', async () => {
    const { host } = await render();
    const next = query<HTMLAnchorElement>(host, '#next');

    expect(next.getAttribute('href')).toBe('/next');
    expect(next.hasAttribute('type')).toBe(false);
    expect(next.hasAttribute('role')).toBe(false);
    expect(next.hasAttribute('aria-disabled')).toBe(false);
    expect(next.classList).toContain('tb-button--outlined');
  });

  it('navigates like any router link', async () => {
    const { fixture, host } = await render();

    query<HTMLAnchorElement>(host, '#next').click();
    await settle(fixture);

    expect(TestBed.inject(Router).url).toBe('/next');
  });
});

describe('appIconButton', () => {
  it('names the action from its label and hides the glyph from assistive technology', async () => {
    const { host } = await render();
    const bell = query<HTMLButtonElement>(host, '#bell');
    const icon = query(bell, 'app-icon');

    expect(bell.getAttribute('aria-label')).toBe('Notifications');
    expect(bell.getAttribute('type')).toBe('button');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(query(icon, 'svg').getAttribute('aria-hidden')).toBe('true');
    expect(query(icon, 'svg').getAttribute('focusable')).toBe('false');
  });

  it('ignores presses while loading, like appButton', async () => {
    const { fixture, host, component } = await render();
    const bell = query<HTMLButtonElement>(host, '#bell');

    bell.click();
    component.saving.set(true);
    await settle(fixture);
    bell.click();
    await settle(fixture);

    expect(component.bellPresses()).toBe(1);
    expect(bell.getAttribute('aria-disabled')).toBe('true');
  });
});
