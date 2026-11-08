import type { EventItem } from './events';

// Wall-clock time of `iso` in an IANA zone, formatted as ICS local time (YYYYMMDDTHHMMSS).
function localStamp(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

// UTC offset of a zone at a given instant, e.g. "+0500".
function offset(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const s = localStamp(iso, timeZone);
  const asUtc = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));
  const mins = Math.round((asUtc - d.getTime()) / 60000);
  const sign = mins >= 0 ? '+' : '-';
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
}

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

// RFC 5545: lines longer than 75 octets must be folded.
const fold = (line: string) => line.match(/.{1,73}/g)!.join('\r\n ');

export function buildIcs(event: EventItem, eventUrl: string): string {
  const tz = event.timezone || 'Asia/Almaty';
  const end = event.endsAt ?? new Date(new Date(event.startsAt).getTime() + 2 * 3600_000).toISOString();
  const off = offset(event.startsAt, tz);
  const utcNow = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const location = [event.venueName, event.venueAddress].filter(Boolean).join(', ');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BiletFlow//Event Discovery//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    `TZID:${tz}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    `TZOFFSETFROM:${off}`,
    `TZOFFSETTO:${off}`,
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:event-${event.id}@biletflow`,
    `DTSTAMP:${utcNow}`,
    `DTSTART;TZID=${tz}:${localStamp(event.startsAt, tz)}`,
    `DTEND;TZID=${tz}:${localStamp(end, tz)}`,
    `SUMMARY:${esc(event.title)}`,
    `DESCRIPTION:${esc(`${event.description}\n\n${eventUrl}`)}`,
    `LOCATION:${esc(location)}`,
    `URL:${eventUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(event: EventItem) {
  const url = `${window.location.origin}/events/${event.id}`;
  const blob = new Blob([buildIcs(event, url)], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${event.title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'event'}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
