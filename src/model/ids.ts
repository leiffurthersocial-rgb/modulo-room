const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

let counter = 0;
let seeded: (() => number) | null = null;

/** Deterministic ids for tests and screenshot mode. */
export function seedIds(seed: number): void {
  let s = seed >>> 0 || 1;
  counter = 0;
  seeded = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function unseedIds(): void {
  seeded = null;
}

/** Short random id with a type prefix, e.g. `w_k3j9x2`. */
export function newId(prefix: string): string {
  const rnd = seeded ?? Math.random;
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
  counter++;
  return `${prefix}_${s}`;
}

export function idCounter(): number {
  return counter;
}
