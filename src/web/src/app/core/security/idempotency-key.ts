/**
 * A fresh idempotency key for a command the server binds to its payload (AGENTS.md). A browser gives
 * `crypto.randomUUID` only in a secure context; on a plain http address on the laptop's own network
 * (docs/MOTION-PLAN-2026-11.md, W2) it has `getRandomValues` and nothing more, so the key is laid out
 * there as a version 4 UUID from sixteen random bytes. The server reads it as a Guid either way.
 */
export function newIdempotencyKey(): string {
  const api: Crypto | undefined = globalThis.crypto;
  if (typeof api?.randomUUID === 'function') return api.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof api?.getRandomValues === 'function') api.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
