import { Component, input, signal } from '@angular/core';

@Component({
  selector: 'app-photo-compare',
  template: `
    <div class="compare" [attr.aria-label]="label()">
      <img [src]="beforeSrc()" [alt]="beforeLabel()" />
      <img
        class="after"
        [src]="afterSrc()"
        [alt]="afterLabel()"
        [style.clip-path]="'inset(0 0 0 ' + position() + '%)'"
      />
      <span class="divider" [style.inset-inline-start.%]="position()" aria-hidden="true"></span>
    </div>
    <label class="control"
      ><span>{{ beforeLabel() }}</span
      ><input
        type="range"
        min="0"
        max="100"
        step="1"
        [value]="position()"
        (input)="position.set(+$any($event.target).value)"
        [attr.aria-label]="label()"
      /><span>{{ afterLabel() }}</span></label
    >
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .compare {
        position: relative;
        inline-size: 100%;
        aspect-ratio: 4 / 5;
        max-block-size: 26rem;
        overflow: hidden;
        border-radius: 1rem;
        background: var(--tb-line, #d9dfd1);
      }
      .compare img {
        position: absolute;
        inset: 0;
        inline-size: 100%;
        block-size: 100%;
        object-fit: cover;
      }
      .divider {
        position: absolute;
        inset-block: 0;
        border-inline-start: 3px solid #fff;
        box-shadow: 0 0 0.3rem #0009;
      }
      .control {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin-block-start: 0.6rem;
        font-size: 0.75rem;
      }
      input {
        flex: 1;
        accent-color: var(--tb-brand, #153d33);
        min-block-size: 2.75rem;
      }
    `,
  ],
})
export class PhotoCompare {
  readonly beforeSrc = input.required<string>();
  readonly afterSrc = input.required<string>();
  readonly beforeLabel = input.required<string>();
  readonly afterLabel = input.required<string>();
  readonly label = input('Compare progress photos');
  readonly position = signal(50);
}
