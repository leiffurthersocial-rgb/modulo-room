/**
 * Deterministic "screenshot mode" (?screenshot=1):
 * fixed pixel ratio, no animation, no PWA registration noise, and a
 * `window.__mrReady` flag the Playwright tests wait for before capturing.
 */
export const params = new URLSearchParams(location.search);
export const screenshotMode = params.has('screenshot');

declare global {
  interface Window {
    __mrReady?: boolean;
    __mrInfo?: Record<string, unknown>;
  }
}

export function markReady(info: Record<string, unknown> = {}): void {
  window.__mrInfo = info;
  window.__mrReady = true;
  document.documentElement.dataset.ready = 'true';
}
