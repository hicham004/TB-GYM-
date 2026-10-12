/**
 * A Markdown file imported as its text (angular.json `loader`: `.md` as `text`). The changelog
 * (`src/content/changelog.md`) is read this way at build time, so the `/changelog` page and the
 * homepage's "last change" date are finished HTML with no request behind them.
 */
declare module '*.md' {
  const text: string;
  export default text;
}
