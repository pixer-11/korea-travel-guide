// Minimal RFC 5545 iCalendar builder for the events feed. Hand-rolled because the
// output is tiny and a dependency isn't worth it; the only fiddly parts are line
// folding (75 octets) and escaping, both handled below.

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string;
  url?: string;
  location?: string;
  start: Date;
  end?: Date | null;
}

// RFC 5545 §3.3.11 — escape backslash, semicolon, comma and newlines in TEXT values.
const esc = (s: string) =>
  String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

// All-day dates use VALUE=DATE (yyyymmdd) — event posts only carry day precision,
// so inventing a clock time would be wrong (and would shift across time zones).
const day = (d: Date) => {
  const x = new Date(d);
  return `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`;
};

const stamp = (d: Date) => `${day(d)}T000000Z`;

// RFC 5545 §3.1 — fold lines longer than 75 octets, continuation starts with a space.
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const w = Buffer.byteLength(ch, 'utf8');
    // 74 to leave room for the leading space on continuation lines
    if (len + w > 74) { out.push(cur); cur = ' '; len = 1; }
    cur += ch; len += w;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function buildIcs({ name, description, events }: { name: string; description: string; events: IcsEvent[] }): string {
  const now = new Date();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wander Atlas//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    `X-WR-CALDESC:${esc(description)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:P1D',
    'X-PUBLISHED-TTL:P1D',
  ];

  for (const e of events) {
    // DTEND is exclusive for all-day events → add one day to the last day.
    const endBase = e.end && e.end >= e.start ? e.end : e.start;
    const endExclusive = new Date(endBase);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(e.uid)}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${day(e.start)}`,
      `DTEND;VALUE=DATE:${day(endExclusive)}`,
      `SUMMARY:${esc(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
      ...(e.url ? [`URL:${esc(e.url)}`] : []),
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
