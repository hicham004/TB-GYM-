/**
 * Retained idempotency keys, one per command and target.
 *
 * A key minted fresh on every click is not an idempotency key at all. The case it exists for is the
 * lost response: the request reached the server and committed, the reply never arrived, and the user
 * clicks again. With a new key the server sees a different command and writes a second message — the
 * exact duplicate the key was supposed to prevent.
 *
 * So a key is retained for as long as the attempt is unchanged: the same command, against the same
 * target, carrying the same normalized payload. It is released when the command finally succeeds,
 * when the user abandons it, when the payload changes into a genuinely different command, and
 * whenever the account, workspace or conversation changes underneath.
 */
export type MessagingCommand = 'send' | 'edit' | 'delete' | 'moderate';

interface RetainedKey {
  readonly key: string;
  readonly payload: string;
}

export class CommandKeys {
  private readonly retained = new Map<string, RetainedKey>();

  /**
   * The key to send with this attempt.
   *
   * @param command which operation is being attempted.
   * @param targetId the conversation or message it acts on.
   * @param payload the normalized body or reason, or the empty string for a command that has none.
   * @returns the retained key when this is a retry of the same attempt, and a new one otherwise.
   */
  for(command: MessagingCommand, targetId: string, payload: string): string {
    const slot = `${command}|${targetId}`;
    const existing = this.retained.get(slot);
    if (existing !== undefined && existing.payload === payload) {
      return existing.key;
    }

    // A changed payload is a different command, so it gets a different key. Reusing the retained one
    // would make the server refuse the edit as a conflicting reuse rather than perform it.
    const key = crypto.randomUUID();
    this.retained.set(slot, { key, payload });
    return key;
  }

  /** The attempt is over — it succeeded, or the user walked away from it. */
  release(command: MessagingCommand, targetId: string): void {
    this.retained.delete(`${command}|${targetId}`);
  }

  /** The account, workspace or conversation changed, so no attempt in flight is still ours. */
  clear(): void {
    this.retained.clear();
  }

  /** How many attempts are currently retained. Read by the tests, not by the screen. */
  get size(): number {
    return this.retained.size;
  }
}
