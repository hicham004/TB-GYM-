import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkLegacyStyles } from './check-legacy-styles.mjs';

function inspect(files) {
  const root = mkdtempSync(join(tmpdir(), 'tb-gym-style-check-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    return checkLegacyStyles(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('rejects old variables, including definitions and fallbacks, with source locations', () => {
  const findings = inspect({
    'theme.scss': ':root {\n --surface: white;\n color: var( --accent, red);\n}',
    'app/core/api/generated/types.gen.ts': 'const example = "var(--surface)";',
  });
  assert.equal(findings.length, 2);
  assert.match(findings[0], /theme\.scss:3/);
  assert.match(findings[1], /theme\.scss:2/);
});

test('a class, binding, or CSS-looking comment cannot hide a default button or old class', () => {
  const findings = inspect({
    'page.ts': `@Component({
      template: '<button class="made-up">Save</button><p class="muted">Help</p>',
      styles: '/* .muted {} button {} */ .other { color: red; }'
    }) class Page { example = 'button {}'; }`,
  });
  assert.equal(findings.length, 2);
  assert.match(findings.join('\n'), /class "muted"/);
  assert.match(findings.join('\n'), /<button>/);
});

test('reads external templates, every styleUrl, and shared styles through a re-export', () => {
  assert.deepEqual(
    inspect({
      'shared.ts': 'export const SHARED = `.muted { color: var(--tb-muted); }`;',
      'bridge.ts': "export { SHARED } from './shared';",
      'page.ts': `import { SHARED } from './bridge';
      @Component({ templateUrl: './page.html', styleUrls: ['./first.scss', './second.scss'],
        styles: [SHARED + ' .extra { color: blue; }'] }) class Page {}`,
      'page.html': '<p class="muted">Help</p><button class="save">Save</button>',
      'first.scss': ':host { display: block; }',
      'second.scss': '.save { background: var(--tb-accent); }',
    }),
    [],
  );
});

test('styles from a sibling component do not hide an unstyled component', () => {
  const findings = inspect({
    'pages.ts': `@Component({ template: '<button>Save</button>', styles: 'button { color: red; }' }) class Styled {}
      @Component({ template: '<button>Save</button>' }) class Unstyled {}`,
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /<button>/);
});

test('accepts kit controls and styled tabs; ignores commented examples', () => {
  assert.deepEqual(
    inspect({
      'page.ts': `@Component({ template: \`<button appButton>Save</button><button appIconButton>Close</button>
      <button ngTab>Overview</button><!-- <button>Example</button> -->\`,
      styles: '[ngTab] { background: transparent; }' }) class Page {}`,
      'theme.scss': '// var(--surface) is gone\n:root { color: var(--tb-ink); }',
    }),
    [],
  );
});

test('the prototype lab exemption never permits a legacy variable', () => {
  const findings = inspect({
    'app/dev/hero-lab/hero-lab.ts': `@Component({ template: '<button>Demo</button>', styles: 'button { color: var(--surface); }' }) class Lab {}`,
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /pre-brand-v2/);
});
