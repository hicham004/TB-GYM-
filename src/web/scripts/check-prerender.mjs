// Fails when the production build no longer carries the homepage, or what changed, as finished
// HTML (UI plan R6.2a, R6.2f), or when it carries what only the private pre-launch build may
// (R6.2h): a stand-in photograph, the placeholders folder, or a robots noindex tag.
//
// `ng build` renders `/` ahead of time into index.html and `/changelog` into changelog/index.html,
// and keeps the plain application shell as index.csr.html; nginx.conf serves the first two for
// their own addresses and the shell for every other. This reads all three from the build output
// and checks what each must and must not hold, so a build that quietly stopped pre-rendering (a
// service touching the browser at start-up, a route change) fails here rather than on Google.
// `npm run build` runs it; `node scripts/check-prerender.mjs <dir>` reads another output folder,
// and `--private` checks a private pre-launch build the other way round (its stand-ins and its
// noindex tag must be there).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
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

/**
 * The folder the private pre-launch build serves its stand-in photographs from (UI plan R6.2h):
 * `src/web/placeholders/`, copied to this name in the output by the `placeholders` configuration
 * alone. A production output must neither hold it nor name it.
 */
export const PLACEHOLDERS_FOLDER = 'placeholders';

/** How a stand-in names the folder in a page or a script: as a path. */
const PLACEHOLDERS_PATH = /placeholders\//;

/** A stand-in drawn by the page: features/home/home-placeholder.ts marks its host with this. */
const STAND_IN = /\sdata-placeholder="/;

/**
 * The output files whose text can name the folder; pictures and fonts cannot. A source map (a
 * development build's, for the `built` checks; production writes none) embeds every source
 * comment and is read by no browser, so it is left out.
 */
const TEXT_FILES = /\.(?:html|m?js|css|json|txt|webmanifest|svg|xml)$/i;

const DEFAULT_OUTPUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'tb-gym-web',
  'browser',
);

/**
 * The problems with a build output, or none. `privatePreview` checks a private pre-launch build
 * (R6.2h): the same rules, except that its pages must carry the stand-ins and the noindex tag
 * that a production build must not.
 */
export function checkPrerender(browserDirectory = DEFAULT_OUTPUT, { privatePreview = false } = {}) {
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
    // Talk to us (R6.2g) arrives with the page; analytics never does (it waits for the settings).
    if (!/<section[^>]*\sid="talk"/.test(home) || !/<form[\s>]/.test(home)) {
      findings.push('index.html does not hold the Talk-to-us form.');
    }
    if (/<script[^>]*src="\/stats\//.test(home)) {
      findings.push('index.html loads the analytics script at build time.');
    }
    for (const tag of PREVIEW_TAGS) {
      if (!metaContent(home, tag)) findings.push(`index.html lacks the ${tag} tag or its content.`);
    }
    findings.push(...renderedPageProblems(home, 'index.html', privatePreview));
    if (privatePreview && !STAND_IN.test(home)) {
      findings.push(
        'index.html draws no stand-in photograph: this is not the private pre-launch build.',
      );
    }
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
    findings.push(...renderedPageProblems(changelog, 'changelog/index.html', privatePreview));
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

  if (!privatePreview) findings.push(...placeholderLeaks(browserDirectory));

  return findings;
}

/**
 * What a production output must not carry from the private pre-launch build (R6.2h): the
 * placeholders folder itself, a file that names it, or a page that draws a stand-in. Every text
 * file of the output is read, because a stand-in's address could sit in a script as well as a page.
 */
export function placeholderLeaks(browserDirectory) {
  const findings = [];
  if (existsSync(join(browserDirectory, PLACEHOLDERS_FOLDER))) {
    findings.push(
      `the output holds a ${PLACEHOLDERS_FOLDER}/ folder: the stand-in photographs were copied into it.`,
    );
  }
  for (const file of filesUnder(browserDirectory)) {
    const name = relative(browserDirectory, file).split(sep).join('/');
    if (name.startsWith(`${PLACEHOLDERS_FOLDER}/`) || !TEXT_FILES.test(name)) continue;
    const content = readFileSync(file, 'utf8');
    if (PLACEHOLDERS_PATH.test(content)) {
      findings.push(
        `${name} names the ${PLACEHOLDERS_FOLDER}/ folder: a stand-in photograph is referenced.`,
      );
    } else if (name.endsWith('.html') && STAND_IN.test(content)) {
      findings.push(`${name} draws a stand-in photograph, which only the private build may.`);
    }
  }
  return findings;
}

/** What every pre-rendered page must and must not carry, whatever its words. */
function renderedPageProblems(html, name, privatePreview) {
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
  // The private build asks not to be indexed in its own document (R6.2h); the public one never does.
  const robots = metaContent(html, 'robots');
  const noindex = robots !== null && /noindex/.test(robots);
  if (privatePreview && !noindex) {
    findings.push(
      `${name} carries no robots noindex tag, which the private pre-launch build must.`,
    );
  } else if (!privatePreview && noindex) {
    findings.push(`${name} carries a robots noindex tag, which only the private build may.`);
  }
  return findings;
}

/** Every file under a folder, deepest last. */
function filesUnder(directory) {
  const files = [];
  const visit = (path) => {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (!stats) return;
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
    } else {
      files.push(path);
    }
  };
  visit(directory);
  return files;
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
  const args = process.argv.slice(2);
  const privatePreview = args.includes('--private');
  const named = args.find((arg) => !arg.startsWith('--'));
  const directory = named ? resolve(named) : DEFAULT_OUTPUT;
  const findings = checkPrerender(directory, { privatePreview });
  if (findings.length > 0) {
    console.error(
      `${findings.length} pre-render problem(s) in ${directory}:\n${findings.map((line) => `  ${line}`).join('\n')}`,
    );
    process.exitCode = 1;
  } else if (privatePreview) {
    console.log(
      `The private pre-launch build holds its stand-ins and its noindex tag, besides everything the public page holds (${directory}).`,
    );
  } else {
    console.log(
      `The built homepage holds its headline and preview tags, the changelog its releases, the shell holds neither, and nothing names the placeholders folder (${directory}).`,
    );
  }
}
