/**
 * One or two initials for an avatar: the first character of the first and last words of a display
 * name. Characters are taken whole (`Array.from`), so a surrogate pair is never split. A name with
 * no letters falls back to the first character of `fallback`, normally the email address.
 */
export function initialsOf(name: string, fallback = ''): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return (Array.from(fallback.trim())[0] ?? '').toLocaleUpperCase();
  }

  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';
  return `${first}${last}`.toLocaleUpperCase();
}
