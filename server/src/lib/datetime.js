// Resolve relative time expressions in a *query* to an absolute [start, end].
// NOTE: computed in UTC for now — true timezone correctness needs a tz library
// (flagged in the review log). Good enough to make "this weekend" / "today" work.
function startOfDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function endOfDay(d) {
  const x = startOfDay(d);
  x.setUTCDate(x.getUTCDate() + 1);
  x.setUTCMilliseconds(-1);
  return x;
}
// 0=Sun..6=Sat -> days until the next occurrence (today counts).
function daysUntil(now, weekday) {
  return (weekday - now.getUTCDay() + 7) % 7;
}

export function resolveRelative(text, now = new Date()) {
  if (!text) return null;
  const t = String(text).toLowerCase().trim();
  const today = startOfDay(now);

  if (/\btoday\b/.test(t)) return { start: today, end: endOfDay(today) };
  if (/\btonight\b/.test(t)) {
    const s = new Date(today); s.setUTCHours(17, 0, 0, 0);
    const e = addDays(today, 1); e.setUTCHours(4, 0, 0, 0);
    return { start: s, end: e };
  }
  if (/\btomorrow\b/.test(t)) {
    const d = addDays(today, 1);
    return { start: d, end: endOfDay(d) };
  }
  if (/\b(this )?weekend\b/.test(t)) {
    const sat = addDays(today, daysUntil(now, 6));
    return { start: sat, end: endOfDay(addDays(sat, 1)) };
  }
  const dows = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < dows.length; i++) {
    if (new RegExp(`\\b${dows[i]}\\b`).test(t)) {
      const d = addDays(today, daysUntil(now, i));
      return { start: d, end: endOfDay(d) };
    }
  }
  if (/\bthis week\b/.test(t)) return { start: today, end: endOfDay(addDays(today, daysUntil(now, 0) || 7)) };
  if (/\bthis month\b/.test(t)) {
    const e = new Date(today); e.setUTCMonth(e.getUTCMonth() + 1, 1); e.setUTCMilliseconds(-1);
    return { start: today, end: e };
  }
  if (/\bnext week\b/.test(t)) {
    const s = addDays(today, 7 - now.getUTCDay());
    return { start: s, end: endOfDay(addDays(s, 6)) };
  }
  return null;
}
