const { chromium } = require('playwright');
const fs = require('fs');
const base = 'http://localhost:5199';
const EV = { id: 'ev1', title: 'Jazz', status: 'published', visibility: 'public', starts_at: '2026-12-01T14:00:00+05:00', timezone: 'Asia/Almaty', venue_name: 'Hall', paid_sales_status: 'NONE' };
const hist = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, action: i % 5 === 0 ? 'EVENT_PUBLISHED' : 'ORDER_PAID', created_at: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(), performed_by: 'u', performed_by_name: 'Org', metadata: { n: i } }));
const att = (n, o = {}) => ({ ticket_id: 'tk' + n, attendee_name: 'P' + n, attendee_email: `p${n}@example.com`, ticket_type: 'GA', status: 'valid', order_id: 'o' + n, checked_in_at: null, created_at: null, ...o });
const all = Array.from({ length: 60 }, (_, i) => att(i + 1));
all[1] = att(2, { attendee_name: '=HYPERLINK("http://x")' });
const dash = (title) => ({ totals: { events: 1, by_phase: { upcoming: 1, active: 0, completed: 0, cancelled: 0 }, tickets_sold: 0, capacity: 0, capacity_unlimited_events: 1, gross_kzt: 0, discounts_kzt: 0, refunds_kzt: 0, net_kzt: 0, checked_in: 0, percent_checked_in: null, promo_redemptions: 0 }, events: [an('unfiltered')] });
const an = (tag, sold = 0) => ({ event: { id: 'ev1', title: 'Jazz ' + tag, status: 'published', phase: 'upcoming', starts_at: EV.starts_at, ends_at: null, timezone: 'Asia/Almaty', paid_sales_status: 'NONE' }, filters: {}, capacity: { total: 10, sold, remaining: 10 - sold, percent_sold: sold * 10 }, revenue: { currency: 'KZT', simulated: true, gross_kzt: 0, discounts_kzt: 0, fees_kzt: 0, refunds_kzt: 0, net_kzt: 0, orders: 0 }, attendance: { registered: 0, checked_in: 0, absent: 0, percent_checked_in: null }, cancellations: { cancelled: 0, refunded: 0 }, sales_over_time: [], by_ticket_type: [{ ticket_type_id: 't1', name: 'GA', price_kzt: 0, capacity: 10, sold: 0, remaining: 10, percent_sold: 0, revenue_kzt: 0, checked_in: 0, is_hidden: false }], campaigns: [] });
(async () => {
  const b = await chromium.launch(); const res = []; const ok = (n, c) => res.push((c ? 'PASS ' : 'FAIL ') + n);
  for (const roster of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
    await p.addInitScript(() => { localStorage.setItem('lang', 'en'); localStorage.setItem('auth_token', 'tok');
      localStorage.setItem('auth_user', JSON.stringify({ id: 'org-1', email: 'o@example.com', name: 'o', role: 'organizer' })); });
    const t = `[roster api=${roster}] `; let dupBody = null, refunded = null, attendeeCalls = [];
    const paths = roster ? { '/api/organizer/events/{event_id}/attendees': {}, '/api/organizer/orders/{order_id}/refund': {} } : {};
    await p.route('**/openapi.json', r => r.fulfill({ json: { paths } }));
    await p.route('**/api/users/me', r => r.fulfill({ json: { id: 'org-1', email: 'o@example.com', full_name: 'O', role: 'organizer' } }));
    await p.route('**/api/organizer/events', r => r.fulfill({ json: [EV, { ...EV, id: 'ev2', title: 'Jazz (copy)', status: 'draft' }] }));
    await p.route('**/api/organizer/events/ev2/ticket-types', r => r.fulfill({ json: [] }));
    await p.route('**/api/organizer/events/ev1/ticket-types', r => r.fulfill({ json: [] }));
    await p.route('**/api/organizer/events/ev1/history', r => r.fulfill({ json: hist }));
    await p.route('**/api/organizer/events/ev1/duplicate', async r => { dupBody = JSON.parse(r.request().postData()); await r.fulfill({ status: 201, json: { event_id: 'ev2', source_event_id: 'ev1', status: 'draft', ticket_types_copied: 0 } }); });
    await p.route('**/api/organizer/events/ev1/attendees**', async r => {
      const u = new URL(r.request().url()); const st = u.searchParams.get('status'); const off = +u.searchParams.get('offset'); const lim = +u.searchParams.get('limit');
      attendeeCalls.push(`${st}|${off}`);
      if (st === 'refunded') await new Promise(s => setTimeout(s, 1200));
      const pool = st === 'refunded' ? [att(99, { status: 'refunded' })] : all;
      await r.fulfill({ json: { total: pool.length, limit: lim, offset: off, items: pool.slice(off, off + lim) } });
    });
    await p.route('**/api/organizer/orders/*/refund', async r => { refunded = r.request().url(); await r.fulfill({ json: { ok: true } }); });
    await p.route('**/api/organizer/dashboard', r => r.fulfill({ json: dash() }));
    await p.route('**/api/organizer/events/ev1/analytics**', async r => {
      const q = new URL(r.request().url()).searchParams; const slow = q.get('date_from') === '2026-11-01' && !q.get('date_to');
      if (slow) await new Promise(s => setTimeout(s, 1500));
      await r.fulfill({ json: an(slow ? 'FROM-NOV1' : q.get('date_to') ? 'TO-NOV30' : 'plain', slow ? 7 : 3) });
    });

    await p.goto(base + '/organizer/events/ev1?tab=history'); await p.getByText('Showing 20 of 25').waitFor();
    ok(t + 'history paginates (20 of 25) newest first', await p.locator('ol li').first().innerText().then(x => x.includes('Nov 25') || x.includes('25')));
    await p.getByRole('button', { name: 'Show more' }).click(); await p.getByText('Showing 25 of 25').waitFor(); ok(t + 'history show more', true);
    await p.getByLabel('Action').selectOption('EVENT_PUBLISHED'); await p.getByText('Showing 5 of 5').waitFor(); ok(t + 'history action filter', true);

    await p.goto(base + '/organizer/events/ev1');
    await p.getByRole('button', { name: 'Duplicate' }).click(); await p.getByRole('button', { name: 'Create draft copy' }).click();
    await p.waitForURL('**/organizer/events/ev2'); ok(t + 'duplicate -> new draft route; payload has title only', dupBody.title === 'Jazz (copy)' && !dupBody.starts_at);

    await p.goto(base + '/organizer/events/ev1?tab=attendees');
    if (!roster) {
      await p.getByText(/roster API on the server, which is not available yet/).waitFor(); ok(t + 'blocked notice, no fake roster', !(await p.locator('table').count()));
    } else {
      await p.getByText('1–50 of 60').waitFor(); ok(t + 'roster paginated 50/60', (await p.locator('tbody tr').count()) === 50);
      ok(t + 'no email column/contact data shown', !(await p.getByText('example.com').count()));
      await p.getByRole('button', { name: 'Next' }).click(); await p.getByText('51–60 of 60').waitFor(); ok(t + 'next page', (await p.locator('tbody tr').count()) === 10);
      await p.getByRole('button', { name: 'Previous' }).click(); await p.getByText('1–50 of 60').waitFor();
      await p.getByLabel('Status').selectOption('refunded'); await p.getByLabel('Status').selectOption('');
      await p.getByText('1–50 of 60').waitFor(); await p.waitForTimeout(1800);
      ok(t + 'slow refunded response does not overwrite newer unfiltered list', (await p.locator('tbody tr').count()) === 50 && !(await p.getByText('P99').count()));
      const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Export CSV' }).click()]);
      const csv = fs.readFileSync(await dl.path(), 'utf8');
      ok(t + 'CSV has all 60 rows + header, same columns', csv.trim().split('\r\n').length === 61 && csv.includes('Name,Ticket type,Status,Checked in'));
      ok(t + 'CSV neutralises formula and excludes email', csv.includes(`"'=HYPERLINK(""http://x"")"`) && !csv.includes('@example.com'));
      p.once('dialog', d => d.accept());
      await p.getByRole('button', { name: 'Refund order' }).first().click(); await p.getByText('Order refunded.').waitFor();
      ok(t + 'refund calls order endpoint then reloads', /orders\/o1\/refund$/.test(refunded));
    }
    if (!roster) {
      await p.goto(base + '/organizer'); await p.getByRole('button', { name: 'Analytics' }).first().click(); await p.getByText('Analytics', { exact: false }).first().waitFor();
      await p.getByLabel('From').fill('2026-11-01'); await p.getByLabel('To').fill('2026-11-30');
      await p.getByText('Sold').first().waitFor(); await p.waitForTimeout(2200);
      const heading = await p.locator('h2').filter({ hasText: 'Jazz' }).first().innerText();
      ok(t + 'analytics: slow earlier filter response does not overwrite newer filters', !(await p.getByText('7 / 10').count()) && (await p.getByText('3 / 10').count()) >= 1);
    }
    ok(t + 'no horizontal scroll', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await ctx.close();
  }
  console.log(res.join('\n')); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
