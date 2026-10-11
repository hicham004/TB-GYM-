import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject } from '@angular/core';
import type { HoldsUnsavedWork } from './leave-guard';
import { TenantContext } from '../tenancy/tenant-context';
import { UnsavedWork } from './unsaved-work';

/** Registered by the sheet host, whose lifetime also owns its overlay. */
export function protectSheetEdits(
  host: HoldsUnsavedWork,
  dirty: () => boolean,
  close: () => void,
): void {
  const window = inject(DOCUMENT).defaultView;
  const removeContext = inject(TenantContext).onChange(close);
  const remove = inject(UnsavedWork).registerSheet(host);
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window?.addEventListener('beforeunload', beforeUnload);
  inject(DestroyRef).onDestroy(() => {
    remove();
    removeContext();
    close();
    window?.removeEventListener('beforeunload', beforeUnload);
  });
}
