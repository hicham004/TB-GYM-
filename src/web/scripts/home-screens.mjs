// Makes the homepage's pictures of the app from screenshots of the Atlas demo (UI plan R6.2b).
//
// The homepage tells one week of coaching from both sides with the real product on the demo
// workspace. This turns the screenshots a Playwright pass took (one coach screen at 1440 x 900 at
// 1.5x, one client phone at 390 x 844 at 2x, per moment of the week) into the pictures the page
// shows, each as AVIF and WebP in public/images/home/:
//   <moment>-coach        a 1200 x 900 window on the part of the coach's screen that moment is about
//   <moment>-coach-small  a tighter 800 x 600 window on the same screen, for phones
//   <moment>-phone        the client's phone at 720 px wide, and <moment>-phone-480 at 480 px for phones
//
//   node scripts/home-screens.mjs <shots-folder>
//
// It needs `sharp`, which is deliberately not a dependency of the app (a 30 MB native image library
// for a once-a-release task): install it outside the repository and point NODE_PATH at it, e.g.
//   mkdir %TEMP%\tb-home-tools && cd %TEMP%\tb-home-tools && npm init -y && npm i sharp
//   set NODE_PATH=%TEMP%\tb-home-tools\node_modules && node scripts/home-screens.mjs %TEMP%\tb-home-shots
//
// The screenshots come from the demo (scripts/demo-workspace.ps1) signed in as Lea Khoury (coach),
// Karim Haddad (owner, for Brand) and Maya Fakhoury (client), after Maya logged Lower A with 2.5 kg
// more on her last squat set and opened "Share a record" on the finish summary. The file each moment
// needs is named below, so the pass can be repeated when the app changes.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const shots = process.argv[2];
if (!shots) {
  console.error('Usage: node scripts/home-screens.mjs <shots-folder>');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'images', 'home');
mkdirSync(out, { recursive: true });

/**
 * The moments of the week, in the page's order. `window` and `small` are the top-left corners of
 * the two windows in the 2160 x 1350 coach screenshot; the phone screenshot is 780 x 1688.
 */
const MOMENTS = [
  // Monday morning: Lea's Today (the greeting, who needs her) and Maya's Today with Lower A waiting.
  {
    name: 'hero',
    coach: 'coach-today.png',
    window: [348, 100],
    small: [348, 100],
    phone: 'client-today.png',
  },
  // Monday: the program builder's week grid; Maya's Training with week 4 of 6 and today's session.
  {
    name: 'plan',
    coach: 'coach-builder.png',
    window: [740, 330],
    small: [780, 380],
    phone: 'client-training.png',
  },
  // Monday evening: the activity feed with Maya's two records; the player mid-set with the rest timer.
  {
    name: 'train',
    coach: 'coach-today.png',
    window: [960, 420],
    small: [1360, 530],
    phone: 'client-player.png',
  },
  // Tuesday: Maya's daily targets and meal plan on Lea's screen; Meals for the day on the phone.
  {
    name: 'eat',
    coach: 'coach-maya-nutrition.png',
    window: [348, 330],
    small: [348, 330],
    phone: 'client-nutrition.png',
  },
  // Thursday: the check-in review beside last week's answers; Maya's answers on the phone.
  {
    name: 'checkin',
    coach: 'coach-maya-checkin.png',
    window: [348, 450],
    small: [348, 520],
    phone: 'client-checkin-answers.png',
  },
  // Friday: the thread with Maya's plan and last workout beside it; the same thread on the phone.
  {
    name: 'talk',
    coach: 'coach-messages-maya.png',
    window: [640, 150],
    small: [660, 160],
    phone: 'client-messages.png',
  },
  // Sunday: Maya's overview, where logged sets suggest a new deadlift max to review; the weight trend on the phone.
  {
    name: 'progress',
    coach: 'coach-maya-overview.png',
    window: [348, 330],
    small: [348, 330],
    phone: 'client-progress.png',
  },
  // Sunday night: the brand settings that paint the share card; the card on Maya's phone.
  {
    name: 'share',
    coach: 'owner-brand.png',
    window: [700, 280],
    small: [720, 290],
    phone: 'client-share-card.png',
  },
];

const WINDOW = { width: 1200, height: 900 };
const SMALL = { width: 800, height: 600 };
const PHONE_WIDTHS = [720, 480];

async function write(pipeline, name) {
  const [webp, avif] = await Promise.all([
    pipeline
      .clone()
      .webp({ quality: 80 })
      .toFile(join(out, `${name}.webp`)),
    pipeline
      .clone()
      .avif({ quality: 55 })
      .toFile(join(out, `${name}.avif`)),
  ]);
  console.log(`${name}: webp ${webp.size} B, avif ${avif.size} B`);
}

for (const moment of MOMENTS) {
  const coach = join(shots, moment.coach);
  const [left, top] = moment.window;
  await write(sharp(coach).extract({ left, top, ...WINDOW }), `${moment.name}-coach`);
  const [smallLeft, smallTop] = moment.small;
  await write(
    sharp(coach).extract({ left: smallLeft, top: smallTop, ...SMALL }),
    `${moment.name}-coach-small`,
  );
  for (const width of PHONE_WIDTHS) {
    await write(
      sharp(join(shots, moment.phone)).resize({ width, withoutEnlargement: true }),
      width === 720 ? `${moment.name}-phone` : `${moment.name}-phone-${width}`,
    );
  }
}
