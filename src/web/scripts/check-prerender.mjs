// Fails when the production build no longer carries the homepage, or what changed, as finished
// HTML (UI plan R6.2a, R6.2f).
//
// `ng build` renders `/` ahead of time into index.html and `/changelog` into changelog/index.html,
// and keeps the plain application shell as index.csr.html; nginx.conf serves the first two for
// their own addresses and the shell for every other. This reads all three from the build output
// and checks what each must and must not hold, so a build that quietly stopped pre-rendering (a
// service touching the browser at start-up, a route change) fails here rather than on Google.
// `npm run build` runs it; `node scripts/check-prerender.mjs <dir>` reads another output folder.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The homepage headline, as the <h1> in features/home/home-hero.html reads. */
export const HEADLINE = ['Coach both', 'sides of', 'the week.'];

/** The changelog's title, as the <h1> in features/changelog/changelog.html reads. */
export const CHANGELOG_TITLE = 'What changed';

/** The description and link-preview tags index.html declares; each must survive the render. */
export const PREVIEW_TAGS = [
  'description',
  'og:title',
  'og:description',
  'og:image',
  'og:image:alt',
  'twitter:card',
];

const DEFAULT_OUTPUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'tb-gym-web',
  'browser',
);

/** The problems with a build output, or none. */
export function checkPrerender(browserDirectory = DEFAULT_OUTPUT) {
  const findings = [];
  const read = (name) => {
    const path = join(browserDirectory, name);
    if (!existsSync(path)) {
      findings.push(`${name} is missing from ${browserDirectory}.`);
      return null;
    }
    return readFileSync(path, 'utf8');
  };
  const home = read('index.html');
  const changelog = read(join('changelog', 'index.html'));
  const shell = read('index.csr.html');

  if (home !== null) {
    const text = visibleText(home);
    for (const part of HEADLINE) {
      if (!text.includes(part)) findings.push(`index.html does not hold the headline "${part}".`);
    }
    if (!/<h1[\s>]/.test(home)) findings.push('index.html has no <h1>.');
    for (const tag of PREVIEW_TAGS) {
      if (!metaContent(home, tag)) findings.push(`index.html lacks the ${tag} tag or its content.`);
    }
    findings.push(...renderedPageProblems(home, 'index.html'));
  }

  if (changelog !== null) {
    const text = visibleText(changelog);
    if (!text.includes(CHANGELOG_TITLE) || !/<h1[\s>]/.test(changelog)) {
      findings.push(
        `changelog/index.html does not hold the title "${CHANGELOG_TITLE}" as its <h1>.`,
      );
    }
    if (!/<time\s[^>]*datetime="\d{4}-\d{2}-\d{2}"/.test(changelog)) {
      findings.push('changelog/index.html holds no dated release.');
    }
    findings.push(...renderedPageProblems(changelog, 'changelog/index.html'));
  }

  if (shell !== null) {
    if (!/<app-root><\/app-root>/.test(shell)) {
      findings.push('index.csr.html is not the plain shell: <app-root> is not empty.');
    }
    const text = visibleText(shell);
    for (const part of [...HEADLINE, CHANGELOG_TITLE]) {
      if (text.includes(part)) {
        findings.push(
          `index.csr.html holds page text ("${part}"): a deep link would show that page first.`,
        );
      }
    }
  }

  return findings;
}

/** What every pre-rendered page must and must not carry, whatever its words. */
function renderedPageProblems(html, name) {
  const findings = [];
  if (!/<app-root[^>]*\sngh="/.test(html)) {
    findings.push(`${name} was not rendered by Angular: <app-root> carries no hydration mark.`);
  }
  if (
    !/<script id="ng-state" type="application\/json">[^<]*"tb-gym\.rendered-signed-out":true/.test(
      html,
    )
  ) {
    findings.push(`${name} has no "rendered signed out" mark for the session store.`);
  }
  if (/<script(?![^>]*type="application\/json")[^>]*>[^<]/.test(html)) {
    findings.push(
      `${name} holds an inline script, which the CSP (script-src 'self') would refuse.`,
    );
  }
  if (/<link\s+rel="stylesheet"/.test(html)) {
    findings.push(
      `${name} still links the global stylesheet: scripts/inline-home-styles.mjs did not run.`,
    );
  }
  return findings;
}

/** The document's text without its tags, so an attribute value (og:title) does not count as page text. */
function visibleText(html) {
  return html.replace(/<[^>]*>/g, ' ');
}

/** The non-empty content of the <meta> whose name or property is `name`, or null. */
function metaContent(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = new RegExp(`<meta\\s[^>]*(?:name|property)="${escaped}"[^>]*>`).exec(html);
  if (!tag) return null;
  const content = /\scontent="([^"]*)"/.exec(tag[0]);
  return content && content[1].trim() ? content[1] : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUTPUT;
  const findings = checkPrerender(directory);
  if (findings.length > 0) {
    console.error(
      `${findings.length} pre-render problem(s) in ${directory}:\n${findings.map((line) => `  ${line}`).join('\n')}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `The built homepage holds its headline and preview tags, the changelog its releases, and the shell holds neither (${directory}).`,
    );
  }
}
