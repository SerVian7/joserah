'use strict';
// Crew strip icons (decision, owner, 2026-10-05): one recognisable line icon
// per role, drawn here as plain inline SVG — 24×24 viewBox, stroke
// currentColor, no fill, no colour of their own, no external library, no faces,
// no emoji. The page's theme tokens colour them through `color`.

const svg = (body) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '
  + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// a brain: two mirrored lobes, a centre line and a few folds
const LOBE = 'C12 4 10.5 3.4 9.5 3.7C8.1 4 7.3 5.1 7.5 6.2C5.8 6.3 4.6 7.7 5 9.3C3.8 10.1 3.6 12.1 4.8 13.1'
  + 'C4 14.6 4.9 16.5 6.6 16.6C6.8 18.4 8.4 19.7 10.2 19.3C11.2 19.1 12 18.4 12 17.5';
const mirror = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => `${+(24 - x).toFixed(2)} ${y}`);

const ICONS = {
  // speech bubble: rounded body and a tail
  voice: svg('<path d="M5 4.5h14a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-8l-4.5 3.5V17H5a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z"/>'),
  lead: svg(`<path d="M12 5.5${LOBE}"/><path d="M12 5.5${mirror(LOBE)}"/><path d="M12 5.5v12"/>`
    + '<path d="M7.5 6.2c.8.2 1.4.8 1.6 1.6M5 9.3c1 0 2 .6 2.5 1.5M4.8 13.1c.9-.5 2.1-.5 3 .1M6.6 16.6c0-1 .6-1.9 1.5-2.3"/>'
    + '<path d="M16.5 6.2c-.8.2-1.4.8-1.6 1.6M19 9.3c-1 0-2 .6-2.5 1.5M19.2 13.1c-.9-.5-2.1-.5-3 .1M17.4 16.6c0-1-.6-1.9-1.5-2.3"/>'),
  // drafting compass: handle, hinge, two legs, the arc between them
  architect: svg('<path d="M12 2v1.5"/><circle cx="12" cy="5" r="1.5"/><path d="M11.3 6.3 6 20.5M12.7 6.3 18 20.5"/>'
    + '<path d="M8 14.5a9 9 0 0 0 8 0"/>'),
  // wrench: open jaw at the head, rounded handle, laid on the diagonal
  builder: svg('<path transform="rotate(45 12 12)" d="M10.8 2.7V5.5h2.4V2.7A3.5 3.5 0 0 1 13.5 9.2V19.5'
    + 'a1.5 1.5 0 0 1-3 0V9.2A3.5 3.5 0 0 1 10.8 2.7z"/>'),
  // magnifier: lens and handle
  scout: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>'),
  // shield outline
  sentry: svg('<path d="M12 3l7 2.8v5.4c0 4.6-3 8.4-7 9.8-4-1.4-7-5.2-7-9.8V5.8z"/>'),
};

module.exports = { ICONS };
