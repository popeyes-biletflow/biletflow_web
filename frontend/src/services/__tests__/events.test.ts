import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEvent, getEvents, HttpError, normalizeEvent } from '../events';
import { buildIcs } from '../calendar';

const base = { id: 'e1', title: 'Concert', starts_at: '2026-12-01T14:00:00+00:00', status: 'published', visibility: 'public' };

afterEach(() => vi.unstubAllGlobals());

const stubFetch = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ status, ok: status < 400, json: async () => body })));

describe('normalizeEvent', () => {
  it('never invents a start date', () => {
    expect(normalizeEvent({ ...base, starts_at: undefined })).toBeNull();
    expect(normalizeEvent({ ...base, starts_at: 'not-a-date' })).toBeNull();
    expect(normalizeEvent({ ...base, id: undefined })).toBeNull();
  });

  it('treats an unknown or missing status as non-public (draft), not published', () => {
    expect(normalizeEvent({ ...base, status: 'archived' })?.status).toBe('draft');
    expect(normalizeEvent({ ...base, status: undefined })?.status).toBe('draft');
    expect(normalizeEvent(base)?.status).toBe('published');
    expect(normalizeEvent({ ...base, status: 'cancelled' })?.status).toBe('cancelled');
  });

  it('uses only the backend-computed `available` for remaining stock, never total quantity', () => {
    const tier = (t: object) => normalizeEvent({ ...base, ticket_types: [{ id: 't', name: 'GA', price: 1000, ...t }] })!.ticketTiers[0];
    expect(tier({ quantity: 100, available: 0 }).remaining).toBe(0);
    expect(tier({ quantity: 100, available: 40 }).remaining).toBe(40);
    expect(tier({ quantity: 100 }).remaining).toBeNull();
    expect(tier({ stock: 5 }).remaining).toBeNull();
  });

  it('hides hidden tiers', () => {
    const e = normalizeEvent({ ...base, ticket_types: [{ id: 'a', is_hidden: true }, { id: 'b' }] })!;
    expect(e.ticketTiers.map((t) => t.id)).toEqual(['b']);
  });
});

describe('getEvents', () => {
  it('keeps only published, public, unsuspended, well-formed events', async () => {
    stubFetch(200, [
      base,
      { ...base, id: 'draft', status: 'draft' },
      { ...base, id: 'unlisted', visibility: 'unlisted' },
      { ...base, id: 'private', visibility: 'private' },
      { ...base, id: 'susp', is_suspended: true },
      { ...base, id: 'nodate', starts_at: null },
      { ...base, id: 'cancelled', status: 'cancelled' },
    ]);
    expect((await getEvents()).map((e) => e.id)).toEqual(['e1']);
  });
});

describe('getEvent', () => {
  it('surfaces 404 as an HttpError(404) so the UI can tell missing from failed', async () => {
    stubFetch(404, { detail: 'Event not found.' });
    await expect(getEvent('x')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects an incomplete record instead of showing a made-up event', async () => {
    stubFetch(200, { ...base, starts_at: null });
    await expect(getEvent('e1')).rejects.toBeInstanceOf(HttpError);
  });

  it('retries without the token on 401 so expired sessions do not hide public events', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 401, ok: false, json: async () => ({ detail: 'expired' }) })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => base });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { dispatchEvent: () => true });
    expect((await getEvent('e1', 'tok')).id).toBe('e1');
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).not.toHaveProperty('Authorization');
  });
});

describe('buildIcs', () => {
  it('emits a valid VEVENT in the event timezone with escaped text', () => {
    const e = normalizeEvent({ ...base, id: 'e9', title: 'A, B; C', venue_name: 'Hall', venue_address: 'Abay 1', timezone: 'Asia/Almaty', ends_at: '2026-12-01T16:00:00+00:00' })!;
    const ics = buildIcs(e, 'https://x.test/events/e9');
    expect(ics).toContain('DTSTART;TZID=Asia/Almaty:20261201T190000');
    expect(ics).toContain('DTEND;TZID=Asia/Almaty:20261201T210000');
    expect(ics).toContain(String.raw`SUMMARY:A\, B\; C`);
    expect(ics).toContain('UID:event-e9@biletflow');
    expect(ics.endsWith('\r\n')).toBe(true);
  });
});
