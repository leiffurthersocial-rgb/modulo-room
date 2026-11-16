import { svg, type SVGTemplateResult } from 'lit-html';

const wrap = (body: SVGTemplateResult) =>
  svg`<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  select: wrap(svg`<path d="M5 3l14 8-6 1.5L10 19z"/>`),
  wall: wrap(svg`<path d="M3 17h7V7h11"/><path d="M3 20h10V10h8" opacity=".55"/>`),
  room: wrap(svg`<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 9h3M17 19v-3"/>`),
  door: wrap(
    svg`<path d="M5 20h14"/><path d="M7 20V8"/><path d="M7 8a12 12 0 0 1 12 12" stroke-dasharray="2 2"/>`,
  ),
  window: wrap(svg`<rect x="3" y="9" width="18" height="6"/><path d="M3 12h18"/>`),
  furniture: wrap(
    svg`<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 12a2 2 0 0 1 4 0v3h10v-3a2 2 0 0 1 4 0v5H3z"/><path d="M5 17v2M19 17v2"/>`,
  ),
  measure: wrap(svg`<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>`),
  text: wrap(svg`<path d="M5 6h14M12 6v13M9 19h6"/>`),
  erase: wrap(svg`<path d="M16 3l5 5-11 11H5l-2-2z"/><path d="M10 19h11"/><path d="M8 11l5 5"/>`),
  pan: wrap(
    svg`<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v7M14 6.5a1.5 1.5 0 0 1 3 0V12M17 9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.5-2.7L4 15.3a1.5 1.5 0 0 1 2.3-1.9L8 15"/>`,
  ),
  undo: wrap(svg`<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>`),
  redo: wrap(svg`<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>`),
  magnet: wrap(svg`<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 7h4M14 7h4"/>`),
  grid: wrap(svg`<path d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16"/>`),
  menu: wrap(svg`<path d="M4 6h16M4 12h16M4 18h16"/>`),
  help: wrap(
    svg`<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17h.01"/>`,
  ),
  fit: wrap(svg`<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`),
  zoomIn: wrap(svg`<circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M20 20l-4-4"/>`),
  zoomOut: wrap(svg`<circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-4-4"/>`),
  trash: wrap(svg`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>`),
  rotate: wrap(svg`<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>`),
  copy: wrap(
    svg`<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>`,
  ),
  image: wrap(
    svg`<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>`,
  ),
  panel: wrap(svg`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>`),
  close: wrap(svg`<path d="M6 6l12 12M18 6L6 18"/>`),
  warn: wrap(svg`<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>`),
  lock: wrap(svg`<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`),
};

export type IconName = keyof typeof icons;
