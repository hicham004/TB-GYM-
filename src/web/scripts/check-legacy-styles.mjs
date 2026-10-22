// Fails when the older styling comes back (docs/UI-REDESIGN-PLAN.md, R5.3f). Three rules:
//
// 1. No colour name from before brand v2 (`var(--surface)`, `--muted-text`, ...). Every colour is a
//    `--tb-*` token, or a `--color-*` name the kit's primitives read.
// 2. No class the old global stylesheet used to style (`.primary-button`, `.notice`, `.muted`, ...) in
//    a template unless the component styles it itself. Nothing global styles them any more, so one
//    used without its own rule is drawn as plain text.
// 3. No default button: every <button> is the kit's (`appButton`, `appIconButton`), or has a matching
//    class, attribute or element selector in its component's actual styles.
// 4. No picker the browser draws (plan §2 rule 8, audit A14a): no <select>, and no <input> of type
//    date, time, datetime-local, month or week. The kit's select, date field, date input and time
//    input take their place.
//
// It reads the source as text on purpose: no compiler, no browser, and a fast answer in `npm run lint`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const LEGACY_VARIABLES = [
  'accent',
  'accent-strong',
  'background',
  'border',
  'border-strong',
  'danger',
  'danger-soft',
  'muted-text',
  'success',
  'success-border',
  'success-soft',
  'surface',
  'surface-subtle',
  'text',
  'warning',
  'warning-soft',
];

const FORMER_GLOBAL_CLASSES = [
  'primary-button',
  'secondary-button',
  'quiet-button',
  'danger-button',
  'page-heading',
  'eyebrow',
  'form-grid',
  'span-full',
  'form-actions',
  'form-error',
  'form-success',
  'notice',
  'muted',
  'loading-row',
  'status-badge',
  'empty-state',
  'surface-section',
  'section-heading',
  'data-table',
  'table-scroll',
  'button-group',
  'icon-actions',
  'danger-icon',
  'set-table',
  'set-header',
  'set-line',
  'set-details',
  'joined-inputs',
  'exertion-input',
  'inline-field',
  'add-set',
  'field-label',
  'compact',
];

/**
 * The R1.3 hero lab is a dev-only port of the clickable prototype (it is swapped out of the production
 * build by dev-routes). It is held to rule 1 but not to 2 and 3: its controls are the prototype's own.
 */
const PROTOTYPE_PORTS = ['app/dev/hero-lab/'];

/**
 * Templates audit A14b rebuilds, the two coach check-in pages, keep their selects until then. A14b
 * removes this list's entries; nothing else belongs in it.
 */
const PICKERS_UNTIL_REBUILT = [
  'app/features/checkins/checkin-clients.html',
  'app/features/checkins/checkin-forms.html',
];

const BROWSER_PICKER_KINDS = ['date', 'time', 'datetime-local', 'month', 'week'];
// A type written out, bound to a string or interpolated, in any case: type="date", TYPE='Date',
// [type]="'date'", [attr.type]="'time'", type="{{ 'week' }}". A bound expression stays unknown.
const TYPE_ATTRIBUTE = /\s(?:\[(?:attr\.)?type\]|type)\s*=\s*(["'])(.*?)\1/gi;

/** The picker an <input> tag's type draws, or null when it draws none or cannot be known. */
function browserPickerKind(tagText) {
  for (const match of tagText.matchAll(TYPE_ATTRIBUTE)) {
    const value = match[2]
      .replace(/^\s*(?:\{\{)?\s*['"]?/, '')
      .replace(/['"]?\s*(?:\}\})?\s*$/, '')
      .toLowerCase();
    if (BROWSER_PICKER_KINDS.includes(value)) return value;
  }
  return null;
}

function* walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      if (name === 'generated') continue;
      yield* walk(path);
    } else if (/\.(html|css|scss|ts)$/.test(name) && !/\.spec\.ts$/.test(name)) {
      yield path;
    }
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** The opening tags named `tag` in a template, read with quotes so `=>` inside a binding is safe. */
function* openingTags(text, tag) {
  // Angular reads tag names in any case, so <SELECT> is a select too.
  const start = new RegExp(`<${tag}(?=[\\s>/])`, 'gi');
  for (let match = start.exec(text); match; match = start.exec(text)) {
    let quote = null;
    let end = match.index;
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        break;
      }
    }
    yield { index: match.index, text: text.slice(match.index, end + 1) };
  }
}

function classTokens(text) {
  const tokens = new Set();
  for (const match of text.matchAll(/\bclass=("([^"]*)"|'([^']*)')/g)) {
    for (const token of (match[2] ?? match[3]).split(/\s+/)) {
      if (token && !token.includes('{{')) tokens.add(token);
    }
  }
  for (const match of text.matchAll(/\[class\.([a-z][a-z0-9-]*)\]/g)) tokens.add(match[1]);
  return tokens;
}

/** Read actual Angular metadata, so a template, comment or method cannot masquerade as CSS. */
function componentTemplates(file, cache) {
  const source = parseSource(file, cache);
  const templates = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'Component') {
      const metadata = node.arguments[0];
      if (metadata && ts.isObjectLiteralExpression(metadata)) {
        const properties = new Map(
          metadata.properties
            .filter(ts.isPropertyAssignment)
            .map((p) => [p.name.getText(source), p.initializer]),
        );
        let styles = values(properties.get('styles'), file, cache).join('\n');
        for (const url of [
          ...values(properties.get('styleUrl'), file, cache),
          ...values(properties.get('styleUrls'), file, cache),
        ])
          styles += `\n${readFileSync(resolve(dirname(file), url), 'utf8')}`;
        const inline = properties.get('template');
        if (inline) {
          templates.push({
            file,
            text: values(inline, file, cache).join(''),
            styles,
            offset: lineOf(source.text, inline.getStart(source)) - 1,
          });
        }
        for (const url of values(properties.get('templateUrl'), file, cache)) {
          const path = resolve(dirname(file), url);
          templates.push({ file: path, text: readFileSync(path, 'utf8'), styles, offset: 0 });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return templates;
}

function parseSource(file, cache) {
  if (!cache.has(file))
    cache.set(
      file,
      ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true),
    );
  return cache.get(file);
}

/** Resolve literal styles, including shared constants imported or re-exported by a local module. */
function values(node, file, cache, seen = new Set()) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node))
    return node.elements.flatMap((element) => values(element, file, cache, seen));
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return [...values(node.left, file, cache, seen), ...values(node.right, file, cache, seen)];
  if (!ts.isIdentifier(node)) return [];
  const key = `${file}:${node.text}`;
  if (seen.has(key)) return [];
  const next = new Set([...seen, key]);
  const source = parseSource(file, cache);
  let result = [];
  function visit(part) {
    if (ts.isVariableDeclaration(part) && part.name.getText(source) === node.text)
      result = values(part.initializer, file, cache, next);
    const imports = ts.isImportDeclaration(part)
      ? part.importClause?.namedBindings
      : ts.isExportDeclaration(part)
        ? part.exportClause
        : null;
    if (
      imports &&
      (ts.isNamedImports(imports) || ts.isNamedExports(imports)) &&
      part.moduleSpecifier &&
      ts.isStringLiteral(part.moduleSpecifier)
    ) {
      const binding = imports.elements.find((element) => element.name.text === node.text);
      if (binding && part.moduleSpecifier.text.startsWith('.')) {
        const path = resolve(dirname(file), `${part.moduleSpecifier.text}.ts`);
        if (existsSync(path))
          result = values(binding.propertyName ?? binding.name, path, cache, next);
      }
    }
    ts.forEachChild(part, visit);
  }
  visit(source);
  return result;
}

/** Only selectors count as styling: comments and declaration values are not rules for a control. */
function selectors(styles) {
  return [...styles.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1])
    .join('\n');
}

export function checkLegacyStyles(sourceRoot = root) {
  const findings = [];
  const cache = new Map();
  const name = (file) => relative(sourceRoot, file).split(sep).join('/');
  const report = (file, line, message) => findings.push(`${name(file)}:${line}  ${message}`);
  const variableUse = new RegExp(`var\\(\\s*--(${LEGACY_VARIABLES.join('|')})\\s*[,)]`, 'g');
  const variableDefinition = new RegExp(`(^|[\\s;{])--(${LEGACY_VARIABLES.join('|')})\\s*:`, 'gm');

  for (const file of walk(sourceRoot)) {
    const text = readFileSync(file, 'utf8');
    const uncommented = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (match) =>
      match.replace(/[^\n]/g, ' '),
    );
    for (const match of uncommented.matchAll(variableUse))
      report(
        file,
        lineOf(text, match.index),
        `${match[0]} is a pre-brand-v2 colour name; use a --tb-* token`,
      );
    for (const match of uncommented.matchAll(variableDefinition))
      report(
        file,
        lineOf(text, match.index),
        `--${match[2]} is defined, but pre-brand-v2 colour names are gone`,
      );
    if (!file.endsWith('.ts')) continue;

    for (const template of componentTemplates(file, cache)) {
      if (PROTOTYPE_PORTS.some((port) => name(template.file).startsWith(port))) continue;
      const rules = selectors(template.styles);
      const stylesClass = (token) =>
        new RegExp(`\\.${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![-\\w])`).test(rules);
      const tokens = classTokens(template.text);
      for (const token of FORMER_GLOBAL_CLASSES) {
        if (tokens.has(token) && !stylesClass(token))
          report(
            template.file,
            template.offset + 1,
            `class "${token}" was styled by the old global stylesheet and this component does not style it`,
          );
      }
      const markup = template.text.replace(/<!--[\s\S]*?-->/g, (match) =>
        match.replace(/[^\n]/g, ' '),
      );
      if (!PICKERS_UNTIL_REBUILT.includes(name(template.file))) {
        for (const tag of openingTags(markup, 'select'))
          report(
            template.file,
            template.offset + lineOf(template.text, tag.index),
            "<select> is drawn by the browser: use the kit's select (app-select)",
          );
        for (const tag of openingTags(markup, 'input')) {
          const kind = browserPickerKind(tag.text);
          if (kind)
            report(
              template.file,
              template.offset + lineOf(template.text, tag.index),
              `<input type="${kind}"> is drawn by the browser: use the kit's date field, date input or time input`,
            );
        }
      }
      const stylesButtons = /(^|[\s,>+~])button(?![-\w])/m.test(rules);
      for (const tag of openingTags(markup, 'button')) {
        const kit = /\s(appButton|appIconButton)(?=[\s=>])/.test(tag.text);
        const styled = [...classTokens(tag.text)].some(stylesClass);
        const attributeStyled = /\sngTab(?=[\s=>])/.test(tag.text) && /\[ngTab\]/.test(rules);
        if (!kit && !styled && !stylesButtons && !attributeStyled)
          report(
            template.file,
            template.offset + lineOf(template.text, tag.index),
            '<button> has no kit directive or matching component style: it would be drawn by the browser',
          );
      }
    }
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = [...checkLegacyStyles(), ...checkLegacyStyles(join(root, '..', 'public'))];
  if (findings.length > 0) {
    console.error(
      `${findings.length} legacy styling problem(s):\n${findings.map((line) => `  ${line}`).join('\n')}`,
    );
    process.exitCode = 1;
  } else
    console.log(
      'No legacy colour names, former global classes, default buttons or browser-drawn pickers.',
    );
}
