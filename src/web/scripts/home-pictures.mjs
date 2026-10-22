// The homepage's device pictures: the real app on the demo, photographed (UI plan R6.2d).
//
// Two steps, so the slow one (signing in and clicking through the app) is repeated only when a
// screen changes, and the cheap one (framing and encoding) whenever the look does:
//
//   node scripts/home-pictures.mjs capture --base http://127.0.0.1:4340 --out <shots> [--only name,name]
//   node scripts/home-pictures.mjs compose --shots <shots> --bezel "<Apple's bezel PNG>" --out <pictures> [--only name]
//
// `capture` signs in to the demo built with `demo-workspace --cast sample` (scripts/demo-workspace.ps1):
// the first-name cast in "Oakline Strength", so no picture carries a full name. It photographs the
// client as a phone (402 x 874 points at 3x, the iPhone 17's screen, minus the 62-point status bar
// the installed app sits under) and the coach's and owner's screens at 1440 x 900 at 2x, each in
// light and in dark. Screens that need doing are done through the real UI: Maya starts Lower A, logs
// her squats with 2.5 kg more on the last set, finishes, and opens the share card.
//
// `compose` makes the pictures the page shows, as AVIF, WebP and PNG in --out:
//   <shot>.png                the phone: a drawn 9:41 status bar (full signal, Wi-Fi and battery, the
//                             iOS convention) and the home indicator over the capture, whole and
//                             front-on under Apple's own iPhone 17 bezel, no shadow, no tilt. Apple's
//                             marketing rules ask for exactly this (developer.apple.com/design/resources,
//                             "Product bezels"; the files stay out of the repository).
//   <shot>-<width>.avif/webp  the same phone at the widths the page draws (3x and 2x of its slot).
//   <picture>.png/avif/webp   a coach screen: a 1:1 crop of one region of the 2x capture in a bare
//                             window with rounded corners and a hairline edge, nothing else; and
//   <picture>-1x.avif/webp    the same at 1x, for screens that draw one device pixel per CSS pixel.
//
// `sharp` is deliberately not a dependency of the app (a native image library for a once-a-release
// task): install it outside the repository and point TB_HOME_TOOLS at that folder, e.g.
//   mkdir %TEMP%\tb-home-tools && cd %TEMP%\tb-home-tools && npm init -y && npm i sharp
// (that folder is the default). Playwright comes from the web project itself.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const PASSWORD = 'AtlasDemo-2026!';
const PEOPLE = {
  client: 'maya.f@mail.example',
  coach: 'lea@oakline.example',
  owner: 'karim@oakline.example',
};

// The iPhone 17's screen in points and the status bar the installed app sits under.
const PHONE = { width: 402, height: 874, statusBar: 62, homeIndicator: 34, scale: 3 };
const DESKTOP = { width: 1440, height: 900, scale: 2 };

/**
 * One screen to photograph. `steps` run after the navigation; each is one of
 *   { goto }, { click: { role, name } | { text } | { css } }, { wait }, { scroll: { css, offset } },
 *   { logSet }, { bumpSet: { set, times } }, { dismissTimer: true }, { logAllSets: true }, { eval }.
 */
const COACH_SHOTS = [
  { name: 'coach-today', path: '/' },
  { name: 'coach-clients', path: '/clients' },
  {
    name: 'coach-client',
    path: '/clients',
    steps: [{ click: { text: 'Maya F.' } }, { wait: 1500 }],
  },
  // The client's pages hang off her id, which the run learns when it opens her overview.
  { name: 'coach-client-training', after: 'coach-client', relative: '/training' },
  { name: 'coach-client-nutrition', after: 'coach-client', relative: '/nutrition' },
  { name: 'coach-client-checkins', after: 'coach-client', relative: '/checkins' },
  {
    name: 'coach-client-checkin',
    after: 'coach-client',
    relative: '/checkins',
    steps: [{ click: { css: 'main a.row-link' } }, { wait: 1500 }],
  },
  { name: 'coach-client-progress', after: 'coach-client', relative: '/progress' },
  { name: 'coach-programs', path: '/training/programs' },
  {
    name: 'coach-builder',
    path: '/training/programs',
    steps: [{ click: { text: 'Lean & Strong · Phase 1' } }, { wait: 2000 }],
  },
  {
    name: 'coach-messages',
    path: '/messages',
    steps: [{ click: { text: 'Maya F.' } }, { wait: 1500 }],
  },
  // The check-in forms library (audit A14b); a client's check-ins are on their record now.
  { name: 'coach-checkins', path: '/checkins/forms' },
];

const OWNER_SHOTS = [
  { name: 'owner-today', path: '/' },
  { name: 'owner-team', path: '/team' },
  { name: 'owner-brand', path: '/workspace/brand' },
];

const CLIENT_SHOTS = [
  { name: 'client-today', path: '/' },
  { name: 'client-training', path: '/training/program' },
  { name: 'client-nutrition', path: '/nutrition/today' },
  { name: 'client-checkins', path: '/checkins/me' },
  {
    name: 'client-checkin',
    path: '/checkins/me',
    steps: [{ click: { css: 'main a[href*="/checkins/me/"]' } }, { wait: 1500 }],
  },
  { name: 'client-messages', path: '/messages' },
  { name: 'client-progress', path: '/progress/dashboard' },
  { name: 'client-me', path: '/me' },
];

// Only once, in the dark run: these change the demo (Maya trains).
const CLIENT_TRAINING_SHOTS = [
  {
    name: 'client-player',
    path: '/training/today',
    steps: [
      { click: { role: 'button', name: 'Start workout' } },
      { wait: 2500 },
      { logSet: 1 },
      { wait: 800 },
      { dismissTimer: true },
      { bumpSet: { set: 3, times: 1 } },
      { logSet: 2 },
      { wait: 700 },
      { scroll: { css: '.exercise-heading', offset: -8 } },
    ],
  },
  {
    // Its own address, so the workout can be finished in a later run (after its start is backdated);
    // once it is finished, the same address shows the summary and the optional clicks find nothing.
    name: 'client-finish',
    path: '/training/today',
    steps: [
      { dismissTimer: true },
      { logSet: 3 },
      { wait: 600 },
      { dismissTimer: true },
      { logAllSets: true },
      { click: { role: 'button', name: 'Finish workout' }, optional: true },
      { click: { role: 'button', name: 'Confirm finish' }, optional: true },
      { wait: 2500 },
      { eval: 'window.scrollTo(0, 0)' },
      { wait: 500 },
    ],
  },
  {
    // Straight after the finish, from the summary (the record card is only offered there), so this
    // shot needs a demo whose hero client has not finished today's workout yet.
    name: 'client-share',
    steps: [{ click: { role: 'button', name: 'Share your record' } }, { wait: 2000 }],
  },
];

// After Maya's workout: the coach's feed carries it.
const COACH_AFTER_SHOTS = [
  { name: 'coach-today-after', path: '/' },
  {
    name: 'coach-client-after',
    path: '/clients',
    steps: [{ click: { text: 'Maya F.' } }, { wait: 1500 }],
  },
  { name: 'coach-client-training-after', after: 'coach-client-after', relative: '/training' },
];

/**
 * The coach pictures the page draws: one region of a 2x capture, in CSS px of the 1440 x 900
 * screen (the sidebar ends at 232, the top bar at 64), shown 1:1 so its text keeps its size.
 */
const WINDOWS = [
  // The hero: the greeting, the day's numbers and who needs the coach.
  { name: 'today-needs-you', shot: 'coach-today', left: 248, top: 92, width: 660, height: 668 },
  {
    name: 'today-needs-you-dark',
    shot: 'coach-today-dark',
    left: 248,
    top: 92,
    width: 660,
    height: 668,
  },
  // Monday evening: the activity feed with the finished workout and its record on top.
  { name: 'feed-after', shot: 'coach-today-after', left: 940, top: 350, width: 480, height: 520 },
  {
    name: 'feed-after-dark',
    shot: 'coach-today-after-dark',
    left: 940,
    top: 350,
    width: 480,
    height: 520,
  },
  // Thursday: this week's answers beside last week's.
  {
    name: 'checkin-review',
    shot: 'coach-client-checkin',
    left: 265,
    top: 440,
    width: 700,
    height: 460,
  },
  {
    name: 'checkin-review-dark',
    shot: 'coach-client-checkin-dark',
    left: 265,
    top: 440,
    width: 700,
    height: 460,
  },
  // The builder's first week, two sessions and a rest day, for the independent coach's story.
  { name: 'builder-week', shot: 'coach-builder', left: 330, top: 300, width: 520, height: 560 },
  {
    name: 'builder-week-dark',
    shot: 'coach-builder-dark',
    left: 330,
    top: 300,
    width: 520,
    height: 560,
  },
  // The Team page, for the gym's story.
  { name: 'team-window', shot: 'owner-team', left: 480, top: 195, width: 640, height: 420 },
  {
    name: 'team-window-dark',
    shot: 'owner-team-dark',
    left: 480,
    top: 195,
    width: 640,
    height: 420,
  },
  // Friday: the thread with the client beside her plan and last workout.
  { name: 'messages-thread', shot: 'coach-messages', left: 600, top: 140, width: 620, height: 640 },
  {
    name: 'messages-thread-dark',
    shot: 'coach-messages-dark',
    left: 600,
    top: 140,
    width: 620,
    height: 640,
  },
  // Sunday: the training maxes with the suggestion from logged sets.
  { name: 'maxes', shot: 'coach-client-training', left: 1050, top: 300, width: 360, height: 580 },
  {
    name: 'maxes-dark',
    shot: 'coach-client-training-dark',
    left: 1050,
    top: 300,
    width: 360,
    height: 580,
  },
  // The feature rows (UI plan R6.2f): a 560-750 px region of the coach's screen beside the phone,
  // and a narrower region of the same screen for phones, where the window is drawn about 350 px
  // wide and a wide crop would shrink its text. A row whose phone sits at the left has only the
  // narrow one (R6.2i): a wide crop there ran off the page's edge.
  { name: 'programs', shot: 'coach-builder', left: 262, top: 130, width: 745, height: 680 },
  { name: 'programs-narrow', shot: 'coach-builder', left: 262, top: 130, width: 380, height: 680 },
  {
    name: 'week-done-narrow',
    shot: 'coach-client-after',
    left: 265,
    top: 505,
    width: 380,
    height: 310,
  },
  { name: 'targets', shot: 'coach-client-nutrition', left: 265, top: 310, width: 675, height: 520 },
  {
    name: 'targets-narrow',
    shot: 'coach-client-nutrition',
    left: 265,
    top: 310,
    width: 380,
    height: 520,
  },
  {
    name: 'review-narrow',
    shot: 'coach-client-checkin',
    left: 258,
    top: 355,
    width: 380,
    height: 520,
  },
  { name: 'thread-narrow', shot: 'coach-messages', left: 611, top: 148, width: 460, height: 612 },
  { name: 'clients-narrow', shot: 'coach-clients', left: 258, top: 230, width: 420, height: 460 },
  // Who it's for on a phone, where the band draws its screens about 350 px wide (R6.2j): the
  // builder's first day whole with the second beside it, and the Team page's three people.
  {
    name: 'builder-week-narrow',
    shot: 'coach-builder',
    left: 330,
    top: 300,
    width: 380,
    height: 560,
  },
  { name: 'team-window-narrow', shot: 'owner-team', left: 480, top: 195, width: 380, height: 420 },
];

const PHONE_WIDTHS = [1140, 760, 600, 460];

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key.startsWith('--') || index + 1 >= args.length) {
      throw new Error(`Unexpected argument: ${key}`);
    }
    options[key.slice(2)] = args[index + 1];
  }
  return options;
}

function wanted(options, name) {
  if (!options.only) {
    return true;
  }
  return options.only.split(',').some((item) => name === item || name === `${item}-dark`);
}

// ---------------------------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------------------------

async function capture(options) {
  const base = options.base ?? 'http://127.0.0.1:4340';
  const out = options.out ?? join(tmpdir(), 'tb-home-shots');
  mkdirSync(out, { recursive: true });
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch();
  try {
    for (const scheme of ['light', 'dark']) {
      await run(browser, {
        base,
        out,
        scheme,
        who: PEOPLE.coach,
        phone: false,
        shots: COACH_SHOTS,
        options,
      });
      await run(browser, {
        base,
        out,
        scheme,
        who: PEOPLE.owner,
        phone: false,
        shots: OWNER_SHOTS,
        options,
      });
      await run(browser, {
        base,
        out,
        scheme,
        who: PEOPLE.client,
        phone: true,
        shots: CLIENT_SHOTS,
        options,
      });
    }
    await run(browser, {
      base,
      out,
      scheme: 'dark',
      who: PEOPLE.client,
      phone: true,
      shots: CLIENT_TRAINING_SHOTS,
      options,
      bare: true,
    });
    for (const scheme of ['light', 'dark']) {
      await run(browser, {
        base,
        out,
        scheme,
        who: PEOPLE.coach,
        phone: false,
        shots: COACH_AFTER_SHOTS,
        options,
      });
    }
    await statusBars(browser, out);
  } finally {
    await browser.close();
  }
}

async function run(browser, { base, out, scheme, who, phone, shots, options, bare }) {
  const names = shots.map((shot) => shot.name + (scheme === 'dark' && !bare ? '-dark' : ''));
  // The shots asked for, and the ones they start from; nothing else is even opened, so a run for
  // one picture never repeats what another shot does to the demo.
  const needed = new Set();
  for (const [index, shot] of shots.entries()) {
    if (wanted(options, names[index])) {
      for (
        let current = shot;
        current;
        current = shots.find((item) => item.name === current.after)
      ) {
        needed.add(current.name);
      }
    }
  }
  if (needed.size === 0) {
    return;
  }
  const context = await browser.newContext({
    viewport: phone
      ? { width: PHONE.width, height: PHONE.height - PHONE.statusBar }
      : { width: DESKTOP.width, height: DESKTOP.height },
    deviceScaleFactor: phone ? PHONE.scale : DESKTOP.scale,
    isMobile: phone,
    hasTouch: phone,
    colorScheme: scheme,
    locale: 'en-US',
    timezoneId: 'Asia/Beirut',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${error.message}`));
  if (phone) {
    // The installed app pads its bottom bar for the home indicator, as it would on the phone.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 0, bottom: PHONE.homeIndicator, left: 0, right: 0 },
    });
  }
  await signIn(page, base, who);
  // Where each shot ended up, so a shot can start from another's address (a client's own pages).
  const reached = {};
  for (const [index, shot] of shots.entries()) {
    const name = names[index];
    if (!needed.has(shot.name)) {
      continue;
    }
    try {
      if (shot.after && !reached[shot.after]) {
        const earlier = shots.find((item) => item.name === shot.after);
        await navigate(page, base, earlier, reached);
        reached[earlier.name] = page.url();
      }
      await navigate(page, base, shot, reached);
      reached[shot.name] = page.url();
      if (!wanted(options, name)) {
        continue;
      }
      await settle(page, shot.wait);
      const file = join(out, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      console.log(`saved ${name} | ${await page.title()} | ${page.url()}`);
    } catch (error) {
      console.log(`FAILED ${name}: ${String(error.message).split('\n')[0]}`);
    }
  }
  await context.close();
}

async function navigate(page, base, shot, reached) {
  if (shot.path) {
    await page.goto(`${base}${shot.path}`);
    await settle(page, 1200);
  }
  if (shot.relative) {
    await page.goto(`${reached[shot.after].split('?')[0]}${shot.relative}`);
    await settle(page, 1200);
  }
  for (const step of shot.steps ?? []) {
    await act(page, step);
  }
}

async function act(page, step) {
  if (step.goto) {
    await page.goto(step.goto);
  } else if (step.click) {
    const { role, name, text, css } = step.click;
    const target = css
      ? page.locator(css).first()
      : text
        ? page.getByText(text, { exact: true }).first()
        : page.getByRole(role, { name, exact: true }).first();
    if (step.optional && !(await target.isVisible().catch(() => false))) {
      return;
    }
    await target.click();
    await page.waitForTimeout(700);
  } else if (step.wait) {
    await page.waitForTimeout(step.wait);
  } else if (step.scroll) {
    await page.evaluate(({ css, offset }) => {
      const element = document.querySelector(css);
      element?.scrollIntoView({ block: 'start' });
      window.scrollBy(0, offset ?? 0);
    }, step.scroll);
    await page.waitForTimeout(400);
  } else if (step.logSet) {
    // Nothing to do when that set was logged in an earlier run.
    const log = setCard(page, step.logSet).getByRole('button', { name: 'Log set' });
    if (await log.isVisible().catch(() => false)) {
      await log.click();
      await page.waitForTimeout(900);
    }
  } else if (step.bumpSet) {
    const button = setCard(page, step.bumpSet.set).getByRole('button', { name: 'More weight' });
    for (let count = 0; count < step.bumpSet.times; count += 1) {
      await button.click();
    }
    await page.waitForTimeout(400);
  } else if (step.dismissTimer) {
    const dismiss = page.getByRole('timer').getByRole('button', { name: 'Dismiss' });
    if (await dismiss.isVisible().catch(() => false)) {
      await dismiss.click();
      await page.waitForTimeout(300);
    }
  } else if (step.logAllSets) {
    // Every set still open, each at its prescribed values, exercise by exercise: the player shows
    // one exercise at a time and "Next exercise" opens the following one.
    for (let guard = 0; guard < 60; guard += 1) {
      const log = page.getByRole('button', { name: 'Log set' }).first();
      if (await log.isVisible().catch(() => false)) {
        await log.scrollIntoViewIfNeeded();
        await log.click();
        await page.waitForTimeout(700);
        await act(page, { dismissTimer: true });
        continue;
      }
      const next = page.getByRole('button', { name: /Next exercise/ }).first();
      if (!(await next.isVisible().catch(() => false))) {
        break;
      }
      await next.click();
      await page.waitForTimeout(900);
    }
  } else if (step.eval) {
    await page.evaluate(step.eval);
  } else {
    throw new Error(`Unknown step ${JSON.stringify(step)}`);
  }
}

function setCard(page, number) {
  return page.locator(`section.set-card[aria-label="Set ${number}"]`).first();
}

async function signIn(page, base, who) {
  await page.goto(`${base}/auth/sign-in`);
  await page.getByLabel('Email').fill(who);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 30_000 });
  await settle(page, 1500);
}

async function settle(page, extra) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(extra ?? 1200);
}

/**
 * The status bar, drawn by the browser so its digits and symbols are crisp: 9:41 beside the Dynamic
 * Island, full signal, Wi-Fi and battery at the right, on nothing. Two copies, for light and dark
 * screens; `compose` lays the right one over a band in the screen's own colour.
 */
async function statusBars(browser, out) {
  const font = readFileSync(
    join(here, '..', 'public', 'fonts', 'ibm-plex', 'IBMPlexSans-SemiBold.woff2'),
  ).toString('base64');
  const context = await browser.newContext({
    viewport: { width: PHONE.width, height: PHONE.statusBar },
    deviceScaleFactor: PHONE.scale,
  });
  const page = await context.newPage();
  for (const [name, color] of [
    ['statusbar-on-light', '#000000'],
    ['statusbar-on-dark', '#ffffff'],
  ]) {
    await page.setContent(`<!doctype html><html><head><style>
      @font-face { font-family: 'Bar'; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 600; }
      html, body { margin: 0; background: transparent; }
      .bar { position: relative; width: ${PHONE.width}px; height: ${PHONE.statusBar}px; color: ${color}; font: 600 17px/1 'Bar', system-ui, sans-serif; }
      .time { position: absolute; left: 0; width: 138px; top: 32px; transform: translateY(-50%); text-align: center; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
      .icons { position: absolute; right: 24px; top: 32px; transform: translateY(-50%); display: flex; align-items: center; gap: 7px; }
      svg { display: block; }
    </style></head><body><div class="bar">
      <div class="time">9:41</div>
      <div class="icons">
        <svg width="19" height="12" viewBox="0 0 19 12" fill="currentColor"><rect x="0" y="8" width="3.4" height="4" rx="1"/><rect x="5.2" y="5.5" width="3.4" height="6.5" rx="1"/><rect x="10.4" y="3" width="3.4" height="9" rx="1"/><rect x="15.6" y="0" width="3.4" height="12" rx="1"/></svg>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor"><path d="M8.5 11.6 5.9 8.9a3.7 3.7 0 0 1 5.2 0Zm4.4-4.5a6.3 6.3 0 0 0-8.8 0L2.3 5.3a8.9 8.9 0 0 1 12.4 0ZM16.6 3.5a11.5 11.5 0 0 0-16.2 0L0 3.1a12.1 12.1 0 0 1 17 0Z"/></svg>
        <svg width="28" height="13" viewBox="0 0 28 13"><rect x="0.5" y="0.5" width="24" height="12" rx="3.5" fill="none" stroke="currentColor" stroke-opacity="0.4"/><rect x="2" y="2" width="21" height="9" rx="2" fill="currentColor"/><path d="M26 4.5v4a2.2 2.2 0 0 0 0-4Z" fill="currentColor" fill-opacity="0.4"/></svg>
      </div>
    </div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, `${name}.png`), omitBackground: true });
  }
  await context.close();
}

// ---------------------------------------------------------------------------------------------
// compose
// ---------------------------------------------------------------------------------------------

async function compose(options) {
  const shots = options.shots ?? join(tmpdir(), 'tb-home-shots');
  const out = options.out ?? join(tmpdir(), 'tb-home-pictures');
  if (!options.bezel || !existsSync(options.bezel)) {
    throw new Error('Pass --bezel with the path to Apple’s portrait iPhone 17 bezel PNG.');
  }
  mkdirSync(out, { recursive: true });
  const tools = process.env['TB_HOME_TOOLS'] ?? join(tmpdir(), 'tb-home-tools');
  const sharp = createRequire(join(tools, 'package.json'))('sharp');

  const bezel = await screenWindow(sharp, options.bezel);
  console.log(
    `bezel ${bezel.width} x ${bezel.height}, screen at ${bezel.left},${bezel.top} ${bezel.screenWidth} x ${bezel.screenHeight}`,
  );
  const bars = {
    light: await sharp(join(shots, 'statusbar-on-light.png')).png().toBuffer(),
    dark: await sharp(join(shots, 'statusbar-on-dark.png')).png().toBuffer(),
  };

  for (const file of listShots(shots)) {
    if (!wanted(options, file)) {
      continue;
    }
    await phonePicture(sharp, join(shots, `${file}.png`), file, bezel, bars, out);
  }

  for (const window of WINDOWS) {
    if (!wanted(options, window.name)) {
      continue;
    }
    const source = join(shots, `${window.shot}.png`);
    if (!existsSync(source)) {
      console.log(`skip ${window.name}: no ${window.shot}.png`);
      continue;
    }
    await windowPicture(sharp, source, window, out);
  }
}

function listShots(shots) {
  const { readdirSync } = require('node:fs');
  return readdirSync(shots)
    .filter((file) => file.startsWith('client-') && file.endsWith('.png'))
    .map((file) => file.slice(0, -4));
}

/** Finds the bezel's transparent screen window from its alpha channel, so another model needs no numbers. */
async function screenWindow(sharp, file) {
  const image = sharp(file).ensureAlpha();
  const { width, height } = await image.metadata();
  const alpha = await image.extractChannel(3).raw().toBuffer();
  const at = (x, y) => alpha[y * width + x];
  const middle = Math.floor(height / 2);
  let left = Math.floor(width / 2);
  while (left > 0 && at(left - 1, middle) === 0) left -= 1;
  let right = Math.floor(width / 2);
  while (right < width - 1 && at(right + 1, middle) === 0) right += 1;
  // A column a quarter of the way in: clear of the Dynamic Island and of the corners.
  const column = left + Math.floor((right - left) / 4);
  let top = middle;
  while (top > 0 && at(column, top - 1) === 0) top -= 1;
  let bottom = middle;
  while (bottom < height - 1 && at(column, bottom + 1) === 0) bottom += 1;
  const inside = phoneOutline(alpha, width, height);
  if (inside[0] || !inside[middle * width + Math.floor((left + right) / 2)]) {
    throw new Error(`The frame in ${file} does not close around its screen.`);
  }
  return {
    file,
    width,
    height,
    left,
    top,
    screenWidth: right - left + 1,
    screenHeight: bottom - top + 1,
    inside,
  };
}

/** Alpha from which a pixel of the frame stops the space around the phone. */
const OPAQUE = 250;

/**
 * The phone's outline: 1 for each pixel of the frame and of everything it encloses (the screen's
 * window, the Dynamic Island), 0 for the space around it. The space around is what the picture's
 * edge reaches without crossing an opaque pixel, so the frame's soft outer edge belongs to it and
 * its soft inner edge, which the screen has to fill, to the phone.
 */
export function phoneOutline(alpha, width, height) {
  const outside = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const reach = (index) => {
    if (!outside[index] && alpha[index] < OPAQUE) {
      outside[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < width; x += 1) {
    reach(x);
    reach((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    reach(y * width);
    reach(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    if (x > 0) reach(index - 1);
    if (x < width - 1) reach(index + 1);
    if (index >= width) reach(index - width);
    if (index < (height - 1) * width) reach(index + width);
  }
  return outside.map((isOutside) => 1 - isOutside);
}

/**
 * The screen (RGBA, as large as the frame's window) laid into a transparent picture the size of the
 * frame, kept only inside the phone's outline. Apple's frame rounds its corners more than the
 * window's rectangle reaches, so a whole screen showed its square corners past the frame (the
 * owner saw them on 2026-10-13).
 */
export function screenInOutline(screen, bezel) {
  const layer = Buffer.alloc(bezel.width * bezel.height * 4);
  for (let y = 0; y < bezel.screenHeight; y += 1) {
    const row = (bezel.top + y) * bezel.width + bezel.left;
    let start = 0;
    while (start < bezel.screenWidth && !bezel.inside[row + start]) start += 1;
    let end = bezel.screenWidth;
    while (end > start && !bezel.inside[row + end - 1]) end -= 1;
    const from = y * bezel.screenWidth;
    screen.copy(layer, (row + start) * 4, (from + start) * 4, (from + end) * 4);
  }
  return layer;
}

async function phonePicture(sharp, source, name, bezel, bars, out) {
  const scale = PHONE.scale;
  const shot = sharp(source);
  const { width, height } = await shot.metadata();
  const band = PHONE.statusBar * scale;
  if (width !== PHONE.width * scale || height + band !== PHONE.height * scale) {
    console.log(`skip ${name}: ${width} x ${height} is not a phone capture`);
    return;
  }
  // The status bar's band takes the screen's own top colour, as a phone's would.
  const top = await sharp(source)
    .extract({ left: Math.floor(width * 0.2), top: 0, width: Math.floor(width * 0.6), height: 3 })
    .stats();
  const [r, g, b] = top.channels.map((channel) => Math.round(channel.mean));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const onDark = luminance < 140;
  const foot = await sharp(source)
    .extract({
      left: Math.floor(width * 0.3),
      top: height - 6,
      width: Math.floor(width * 0.4),
      height: 6,
    })
    .stats();
  const footDark =
    0.2126 * foot.channels[0].mean +
      0.7152 * foot.channels[1].mean +
      0.0722 * foot.channels[2].mean <
    140;
  const indicatorWidth = 139 * scale;
  const indicatorHeight = 5 * scale;
  const indicator = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + band}"><rect x="${(width - indicatorWidth) / 2}" y="${height + band - 8 * scale - indicatorHeight}" width="${indicatorWidth}" height="${indicatorHeight}" rx="${indicatorHeight / 2}" fill="${footDark ? '#ffffff' : '#000000'}" fill-opacity="0.92"/></svg>`,
  );
  const screen = await sharp({
    create: { width, height: height + band, channels: 4, background: { r, g, b, alpha: 1 } },
  })
    .composite([
      { input: await shot.png().toBuffer(), left: 0, top: band },
      { input: bars[onDark ? 'dark' : 'light'], left: 0, top: 0 },
      { input: indicator, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  // The screen sits under the frame, which covers its edges and carries the island; only the part
  // inside the phone's outline is kept, or its square corners show past the frame's round ones.
  const fitted = await sharp(screen)
    .resize({ width: bezel.screenWidth, height: bezel.screenHeight, fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const picture = sharp(screenInOutline(fitted, bezel), {
    raw: { width: bezel.width, height: bezel.height, channels: 4 },
  }).composite([{ input: bezel.file, left: 0, top: 0 }]);
  const master = await picture.png().toBuffer();
  await sharp(master)
    .png({ compressionLevel: 9 })
    .toFile(join(out, `${name}.png`));
  for (const target of PHONE_WIDTHS) {
    const resized = sharp(master).resize({ width: target });
    // The two small sizes are a phone's own: a touch more compression keeps its first screens light.
    const [avif, webp] = await Promise.all([
      resized
        .clone()
        .avif({ quality: target <= 600 ? 54 : 60 })
        .toFile(join(out, `${name}-${target}.avif`)),
      resized
        .clone()
        .webp({ quality: 82 })
        .toFile(join(out, `${name}-${target}.webp`)),
    ]);
    console.log(`${name}-${target}: avif ${avif.size} B, webp ${webp.size} B`);
  }
}

async function windowPicture(sharp, source, window, out) {
  const scale = DESKTOP.scale;
  const radius = (window.radius ?? 14) * scale;
  const width = window.width * scale;
  const height = window.height * scale;
  const crop = await sharp(source)
    .extract({ left: window.left * scale, top: window.top * scale, width, height })
    .png()
    .toBuffer();
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="#fff"/></svg>`,
  );
  // One hairline (1 CSS px), a neutral mid-tone that reads on the dark stage and on cream alike.
  const edge = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${scale / 2}" y="${scale / 2}" width="${width - scale}" height="${height - scale}" rx="${radius - scale / 2}" fill="none" stroke="${window.edge ?? '#7d8a84'}" stroke-opacity="0.55" stroke-width="${scale}"/></svg>`,
  );
  const picture = await sharp(crop)
    .ensureAlpha()
    .composite([
      { input: mask, blend: 'dest-in' },
      { input: edge, blend: 'over' },
    ])
    .png()
    .toBuffer();
  const [png, avif, webp] = await Promise.all([
    sharp(picture)
      .png({ compressionLevel: 9 })
      .toFile(join(out, `${window.name}.png`)),
    sharp(picture)
      .avif({ quality: 62 })
      .toFile(join(out, `${window.name}.avif`)),
    sharp(picture)
      .webp({ quality: 84 })
      .toFile(join(out, `${window.name}.webp`)),
    sharp(picture)
      .resize({ width: window.width })
      .avif({ quality: 62 })
      .toFile(join(out, `${window.name}-1x.avif`)),
    sharp(picture)
      .resize({ width: window.width })
      .webp({ quality: 84 })
      .toFile(join(out, `${window.name}-1x.webp`)),
  ]);
  console.log(
    `${window.name}: ${window.width} x ${window.height} css px, png ${png.size} B, avif ${avif.size} B, webp ${webp.size} B`,
  );
}

// ---------------------------------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  if (command === 'capture') {
    await capture(options);
  } else if (command === 'compose') {
    await compose(options);
  } else {
    console.error('Usage: node scripts/home-pictures.mjs capture|compose [--option value ...]');
    process.exit(1);
  }
}
