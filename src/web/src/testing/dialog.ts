/**
 * jsdom implements `<dialog>` as an element but not its behaviour: `showModal` and `close` do not
 * exist, so a component that opens a dialog cannot be driven in a unit test at all.
 *
 * This adds the smallest honest stand-in — the `open` attribute and the `close` event — and nothing
 * else. It deliberately does not pretend to provide what the platform provides and a test therefore
 * must not assert on here: the focus trap, the inert background, the top layer, or Escape. Those
 * are browser behaviour and are covered in the Playwright checks.
 */
interface DialogParts {
  showModal(): void;
  show(): void;
  close(returnValue?: string): void;
}

export function installDialogSupport(): () => void {
  const prototype = HTMLDialogElement.prototype as unknown as Partial<DialogParts>;
  if (typeof prototype.showModal === 'function') {
    return () => undefined;
  }

  const open = function (this: HTMLDialogElement): void {
    this.setAttribute('open', '');
  };

  prototype.showModal = open;
  prototype.show = open;
  prototype.close = function (this: HTMLDialogElement, returnValue?: string): void {
    if (!this.hasAttribute('open')) {
      return;
    }

    this.removeAttribute('open');
    if (returnValue !== undefined) {
      this.returnValue = returnValue;
    }

    this.dispatchEvent(new Event('close'));
  };

  return () => {
    delete prototype.showModal;
    delete prototype.show;
    delete prototype.close;
  };
}
