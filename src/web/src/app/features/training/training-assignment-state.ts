import type { TrainingLoadUnit } from '../../core/api/generated';

export interface UnitBoundWorkingMax {
  value: number | null;
  unit: TrainingLoadUnit;
  sourceRecordId: string | null;
}

export class IntentIdempotencyKey {
  private fingerprint: string | null = null;
  private key: string | null = null;

  constructor(private readonly keyFactory: () => string = () => globalThis.crypto.randomUUID()) {}

  forPayload(payload: unknown): string {
    const fingerprint = JSON.stringify(payload);
    if (this.fingerprint !== fingerprint || !this.key) {
      this.fingerprint = fingerprint;
      this.key = this.keyFactory();
    }
    return this.key;
  }

  complete(): void {
    this.fingerprint = null;
    this.key = null;
  }
}

export function changeWorkingMaxUnit<T extends UnitBoundWorkingMax>(
  rows: readonly T[],
  unit: TrainingLoadUnit,
): T[] {
  return rows.map((row) => ({
    ...row,
    unit,
    sourceRecordId: null,
  }));
}
