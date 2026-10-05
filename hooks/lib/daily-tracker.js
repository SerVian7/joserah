'use strict';
/**
 * Today's Daily Tracker folder: desk/artifacts/<day>/daily-tracker, else the first folder of the day
 * whose index.html says "Daily Tracker" and has a rows.json. Null when there is none. Shared by
 * hooks/crew.js (the Crew strip) and hooks/tracker-guard.js (the Stop guard).
 */
const fs = require('fs');
const path = require('path');

function dailyTracker(root, day) {
  const base = path.join(root, '.joserah', 'desk', 'artifacts', day);
  let subs;
  try { subs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return null; }
  if (subs.includes('daily-tracker')) subs = ['daily-tracker', ...subs.filter((n) => n !== 'daily-tracker')];
  for (const n of subs) {
    const d = path.join(base, n);
    try {
      if (!fs.existsSync(path.join(d, 'rows.json'))) continue;
      if (/Daily Tracker/.test(fs.readFileSync(path.join(d, 'index.html'), 'utf8'))) return d;
    } catch { /* not a page */ }
  }
  return null;
}

module.exports = { dailyTracker };
