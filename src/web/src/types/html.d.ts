/**
 * An HTML template imported as its text (`with { loader: 'text' }`). Only a spec does this: the
 * founding words test (notes plan N3b) reads the templates it guards as they are written. Components
 * keep `templateUrl`, which the Angular compiler reads on its own.
 */
declare module '*.html' {
  const text: string;
  export default text;
}
