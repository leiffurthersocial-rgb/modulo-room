import { html, nothing, type TemplateResult } from 'lit-html';
import { formatLength, lengthToInput, parseLength, type UnitPrefs } from '../model/units';

/** Text input that parses a length on commit (blur / Enter). Invalid input reverts. */
export function lengthField(
  label: string,
  mm: number,
  prefs: UnitPrefs,
  onCommit: (mm: number) => void,
  opts: { min?: number; disabled?: boolean; testId?: string } = {},
): TemplateResult {
  const commit = (e: Event) => {
    const el = e.target as HTMLInputElement;
    const v = parseLength(el.value, prefs);
    if (v === null || (opts.min !== undefined && v < opts.min)) {
      el.classList.add('invalid');
      el.value = lengthToInput(mm, prefs);
      setTimeout(() => el.classList.remove('invalid'), 900);
      return;
    }
    if (Math.abs(v - mm) > 0.01) onCommit(v);
  };
  return html`<label class="field">
    <span>${label}</span>
    <input
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      .value=${lengthToInput(mm, prefs)}
      title=${formatLength(mm, prefs)}
      ?disabled=${opts.disabled ?? false}
      data-testid=${opts.testId ?? nothing}
      @change=${commit}
      @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  </label>`;
}

export function numberField(
  label: string,
  value: number,
  onCommit: (v: number) => void,
  opts: { min?: number; max?: number; step?: number; suffix?: string } = {},
): TemplateResult {
  return html`<label class="field">
    <span>${label}</span>
    <span class="with-suffix">
      <input
        type="number"
        inputmode="decimal"
        .value=${String(Math.round(value * 100) / 100)}
        min=${opts.min ?? nothing}
        max=${opts.max ?? nothing}
        step=${opts.step ?? 'any'}
        @change=${(e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(v)) onCommit(v);
        }}
      />${opts.suffix ? html`<em>${opts.suffix}</em>` : nothing}
    </span>
  </label>`;
}

export function textField(
  label: string,
  value: string,
  onCommit: (v: string) => void,
  testId?: string,
): TemplateResult {
  return html`<label class="field">
    <span>${label}</span>
    <input
      type="text"
      .value=${value}
      data-testid=${testId ?? nothing}
      @change=${(e: Event) => onCommit((e.target as HTMLInputElement).value)}
      @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  </label>`;
}

export function selectField(
  label: string,
  value: string,
  options: { value: string; label: string }[],
  onChange: (v: string) => void,
): TemplateResult {
  return html`<label class="field">
    <span>${label}</span>
    <select @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}>
      ${options.map((o) => html`<option value=${o.value} ?selected=${o.value === value}>${o.label}</option>`)}
    </select>
  </label>`;
}

export function toggle(label: string, on: boolean, onChange: (v: boolean) => void): TemplateResult {
  return html`<label class="toggle">
    <input
      type="checkbox"
      .checked=${on}
      @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)}
    />
    <span>${label}</span>
  </label>`;
}

export function segmented<T extends string | number>(
  options: { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void,
  ariaLabel: string,
): TemplateResult {
  return html`<div class="segmented" role="radiogroup" aria-label=${ariaLabel}>
    ${options.map(
      (o) =>
        html`<button
          type="button"
          role="radio"
          aria-checked=${o.value === value ? 'true' : 'false'}
          class=${o.value === value ? 'on' : ''}
          @click=${() => onChange(o.value)}
        >
          ${o.label}
        </button>`,
    )}
  </div>`;
}
