// iCalendar (.ics, RFC 5545) export so students can put their deadlines and
// events into Google Calendar, Apple Calendar, or Outlook. Pure; the page
// turns the string into a download.

const encoder = new TextEncoder();

export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a content line to 75 octets, never splitting a UTF-8 character. */
export function foldLine(line) {
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compactDate = (key) => key.replace(/-/g, '');
function nextDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function stamp(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
/** One hour after HH:MM (capped at the end of the day), as HHMMSS. */
function endTime(time) {
  const [h, m] = time.split(':').map(Number);
  return h >= 23 ? '235900' : `${String(h + 1).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
}

/**
 * events: [{ uid, date: 'YYYY-MM-DD', time?: 'HH:MM', title, description?, url?, remindDaysBefore? }]
 * Timed events use floating local time, so they show at the same clock time
 * wherever the student opens them.
 */
export function buildICS(events, { name = 'Student Atlas', now = new Date() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Student Atlas//Application Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${escapeText(e.uid)}@student-atlas`, `DTSTAMP:${stamp(now)}`);
    if (e.time) {
      const t = e.time.replace(':', '');
      lines.push(`DTSTART:${compactDate(e.date)}T${t}00`, `DTEND:${compactDate(e.date)}T${endTime(e.time)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${String(e.url).replace(/[\r\n]/g, '')}`);
    if (e.remindDaysBefore) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(`Reminder: ${e.title}`)}`, `TRIGGER:-P${e.remindDaysBefore}D`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
