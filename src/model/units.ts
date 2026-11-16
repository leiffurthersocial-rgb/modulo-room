import type { DisplayUnits, MetricUnit } from './types';

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;

export interface UnitPrefs {
  units: DisplayUnits;
  metricUnit: MetricUnit;
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Greatest common divisor for fraction reduction. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Formats inches with fractional precision 1/`den`, e.g. `6 1/2`. */
function formatInches(inches: number, den = 8): string {
  const whole = Math.floor(inches + 1e-9);
  let num = Math.round((inches - whole) * den);
  let w = whole;
  if (num === den) {
    w += 1;
    num = 0;
  }
  if (num === 0) return `${w}`;
  const g = gcd(num, den);
  const frac = `${num / g}/${den / g}`;
  return w === 0 ? frac : `${w} ${frac}`;
}

/** Formats a length in mm for display. */
export function formatLength(mm: number, prefs: UnitPrefs): string {
  const neg = mm < 0;
  const v = Math.abs(mm);
  let out: string;
  if (prefs.units === 'imperial') {
    const totalIn = Math.round((v / MM_PER_INCH) * 8) / 8;
    const feet = Math.floor(totalIn / 12 + 1e-9);
    const inches = totalIn - feet * 12;
    out = feet > 0 ? `${feet}' ${formatInches(inches)}"` : `${formatInches(inches)}"`;
  } else if (prefs.metricUnit === 'm') {
    out = `${(v / 1000).toFixed(2)} m`;
  } else if (prefs.metricUnit === 'cm') {
    out = `${trimZeros((v / 10).toFixed(1))} cm`;
  } else {
    out = `${Math.round(v)} mm`;
  }
  return neg ? `-${out}` : out;
}

/** Formats an area given in mm². */
export function formatArea(mm2: number, prefs: UnitPrefs): string {
  if (prefs.units === 'imperial') return `${(mm2 / (MM_PER_FOOT * MM_PER_FOOT)).toFixed(1)} ft²`;
  return `${(mm2 / 1e6).toFixed(2)} m²`;
}

/** Plain number in the user's input unit, used to prefill numeric fields. */
export function lengthToInput(mm: number, prefs: UnitPrefs): string {
  if (prefs.units === 'imperial') return formatLength(mm, prefs);
  if (prefs.metricUnit === 'm') return trimZeros((mm / 1000).toFixed(3));
  if (prefs.metricUnit === 'cm') return trimZeros((mm / 10).toFixed(1));
  return String(Math.round(mm));
}

/** The unit a bare number is interpreted in. */
export function bareUnitLabel(prefs: UnitPrefs): string {
  return prefs.units === 'imperial' ? 'ft' : prefs.metricUnit;
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;

function num(s: string): number {
  return Number(s.replace(',', '.'));
}

/**
 * Parses a user-typed length into mm. Accepts `3.2m`, `320 cm`, `3200mm`, `3,2`,
 * `10'6"`, `10' 6 1/2"`, `10ft 6in`, `126in`, `6 1/2"`. A bare number uses the
 * current display unit (m/cm/mm, or feet for imperial). Returns null if invalid.
 */
export function parseLength(input: string, prefs: UnitPrefs): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let m: RegExpMatchArray | null;

  if ((m = s.match(new RegExp(`^${NUM} ?(mm|cm|m)$`)))) {
    const v = num(m[1] ?? '');
    const u = m[2];
    return u === 'mm' ? v : u === 'cm' ? v * 10 : v * 1000;
  }

  // Imperial: optional feet part, optional inches part with optional fraction.
  const imperial = s.match(
    /^(?:(\d+(?:\.\d+)?) ?(?:'|ft|feet|foot))? ?(?:(\d+(?:\.\d+)?)?(?: ?(\d+)\/(\d+))? ?(?:"|in|inch|inches|'')?)?$/,
  );
  if (imperial && /['"]|ft|in|feet|foot|inch|\//.test(s)) {
    const feet = imperial[1] ? Number(imperial[1]) : 0;
    const inches = imperial[2] ? Number(imperial[2]) : 0;
    const fn = imperial[3] ? Number(imperial[3]) : 0;
    const fd = imperial[4] ? Number(imperial[4]) : 1;
    if (fd === 0) return null;
    if (!imperial[1] && !imperial[2] && !imperial[3]) return null;
    return feet * MM_PER_FOOT + (inches + fn / fd) * MM_PER_INCH;
  }

  if ((m = s.match(new RegExp(`^${NUM}$`)))) {
    const v = num(m[1] ?? '');
    if (prefs.units === 'imperial') return v * MM_PER_FOOT;
    return prefs.metricUnit === 'm' ? v * 1000 : prefs.metricUnit === 'cm' ? v * 10 : v;
  }
  return null;
}

/** Parses an angle in degrees (`90`, `90°`, `-45deg`). */
export function parseAngle(input: string): number | null {
  const m = input
    .trim()
    .toLowerCase()
    .match(/^(-?\d+(?:[.,]\d+)?) ?(?:°|deg)?$/);
  return m ? Number((m[1] ?? '').replace(',', '.')) : null;
}

export function formatAngle(deg: number): string {
  return `${trimZeros(deg.toFixed(1))}°`;
}

/** Compact "W × D" for small labels: one unit at the end in metric (cm), ft-in otherwise. */
export function formatDimsCompact(w: number, d: number, prefs: UnitPrefs): string {
  if (prefs.units === 'imperial') return `${formatLength(w, prefs)} × ${formatLength(d, prefs)}`;
  const cm = (v: number) => trimZeros((v / 10).toFixed(1));
  return `${cm(w)} × ${cm(d)} cm`;
}
