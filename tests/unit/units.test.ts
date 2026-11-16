import { describe, expect, it } from 'vitest';
import { formatArea, formatLength, parseAngle, parseLength, type UnitPrefs } from '../../src/model/units';

const m: UnitPrefs = { units: 'metric', metricUnit: 'm' };
const cm: UnitPrefs = { units: 'metric', metricUnit: 'cm' };
const mm: UnitPrefs = { units: 'metric', metricUnit: 'mm' };
const imp: UnitPrefs = { units: 'imperial', metricUnit: 'm' };

describe('formatLength', () => {
  it('formats metric units', () => {
    expect(formatLength(3200, m)).toBe('3.20 m');
    expect(formatLength(3205, cm)).toBe('320.5 cm');
    expect(formatLength(3200, cm)).toBe('320 cm');
    expect(formatLength(3200.4, mm)).toBe('3200 mm');
    expect(formatLength(-150, mm)).toBe('-150 mm');
  });
  it('formats imperial with eighth-inch fractions', () => {
    expect(formatLength(304.8 * 10 + 25.4 * 6.5, imp)).toBe(`10' 6 1/2"`);
    expect(formatLength(25.4 * 3.125, imp)).toBe(`3 1/8"`);
    expect(formatLength(304.8 * 2, imp)).toBe(`2' 0"`);
    expect(formatLength(25.4 * 11.999, imp)).toBe(`1' 0"`);
  });
  it('formats areas', () => {
    expect(formatArea(12_000_000, m)).toBe('12.00 m²');
    expect(formatArea(304.8 * 304.8 * 100, imp)).toBe('100.0 ft²');
  });
});

describe('parseLength', () => {
  it.each([
    ['3.2m', 3200],
    ['3,2 m', 3200],
    ['320cm', 3200],
    ['320 cm', 3200],
    ['3200mm', 3200],
    [`10'6"`, 3200.4],
    [`10' 6 1/2"`, 3213.1],
    ['10ft 6in', 3200.4],
    ['126in', 3200.4],
    [`6 1/2"`, 165.1],
    [`1/2"`, 12.7],
    [`5'`, 1524],
  ])('parses %s', (s, expected) => {
    expect(parseLength(s, m)).toBeCloseTo(expected, 1);
  });
  it('uses the display unit for bare numbers', () => {
    expect(parseLength('3.2', m)).toBe(3200);
    expect(parseLength('320', cm)).toBe(3200);
    expect(parseLength('3200', mm)).toBe(3200);
    expect(parseLength('10', imp)).toBeCloseTo(3048, 5);
  });
  it('rejects garbage', () => {
    for (const s of ['', 'abc', '3.2.1m', '1/0"', 'm']) expect(parseLength(s, m)).toBeNull();
  });
  it('round-trips format -> parse within display precision', () => {
    for (const v of [0, 12.7, 1000, 2437, 3333, 12345]) {
      expect(parseLength(formatLength(v, imp), imp)!).toBeCloseTo(v, -0.5);
      expect(parseLength(formatLength(v, mm), mm)!).toBeCloseTo(v, -0.5);
    }
  });
  it('parses angles', () => {
    expect(parseAngle('90')).toBe(90);
    expect(parseAngle('-45°')).toBe(-45);
    expect(parseAngle('12,5 deg')).toBe(12.5);
    expect(parseAngle('x')).toBeNull();
  });
});

import { formatDimsCompact } from '../../src/model/units';
describe('formatDimsCompact', () => {
  it('uses one unit in metric and ft-in in imperial', () => {
    expect(formatDimsCompact(950, 2050, m)).toBe('95 × 205 cm');
    expect(formatDimsCompact(955, 2000, cm)).toBe('95.5 × 200 cm');
    expect(formatDimsCompact(304.8, 609.6, imp)).toBe(`1' 0" × 2' 0"`);
  });
});
