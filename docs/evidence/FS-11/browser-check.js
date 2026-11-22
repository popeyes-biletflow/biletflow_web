const { chromium } = require('playwright');
const ev = (id, o = {}) => ({ id, title: 'Event ' + id, starts_at: '2026-12-01T14:00:00+00:00', status: 'published', visibility: 'public', category: 'Music',
  venue_name: 'Hall', venue_address: 'Abay 1', timezone: 'Asia/Almaty', ticket_types: [{ id: 't' + id, name: 'GA', price: 1000, quantity: 10, available: 3 }], ...o });
(async () => {
  const b = await chromium.launch(); const res = [];
  const ok = (n, c) => { res.push((c ? 'PASS ' : 'FAIL ') + n); };
  for (const vp of [{ width: 1280, height: 800 }, { width: 375, height: 700 }]) {
    const p = await (await b.newContext({ viewport: vp, acceptDownloads: true })).newPage();
    let failList = true, delayA = 0;
    await p.route('**/api/events', r => failList ? r.fulfill({ status: 500, body: '{"detail":"boom"}' }) : r.fulfill({ json: [ev('A'), ev('B', { category: 'Sport' })] }));
    await p.route('**/api/events/*', async r => {
      const id = r.request().url().split('/').pop();
      if (id === 'A') await new Promise(s => setTimeout(s, delayA));
      if (id === 'missing') return r.fulfill({ status: 404, body: '{"detail":"Event not found."}' });
      if (id === 'boom') return r.fulfill({ status: 500, body: '{"detail":"x"}' });
      if (id === 'C') return r.fulfill({ json: ev('C', { status: 'cancelled' }) });
      return r.fulfill({ json: ev(id) });
    });
    const tag = vp.width + 'px ';
    await p.goto('http://localhost:5199/events?q=zzz'); await p.evaluate(() => localStorage.setItem('lang', 'en')); await p.reload();
    await p.getByRole('alert').waitFor(); ok(tag + 'list error shown with retry', await p.getByRole('button', { name: 'Try again' }).isVisible());
    failList = false; await p.getByRole('button', { name: 'Try again' }).click();
    await p.getByRole('status').filter({ hasText: 'events' }).waitFor(); ok(tag + 'retry recovers; search q kept in URL', p.url().includes('q=zzz'));
    await p.goto('http://localhost:5199/events'); await p.getByText('Event A').first().waitFor();
    await p.getByRole('button', { name: 'Sport' }).click(); await p.waitForTimeout(300); ok(tag + 'category filter -> URL', p.url().includes('category=Sport') && !(await p.getByText('Event A').count()));
    await p.goto('http://localhost:5199/events/missing'); await p.getByText('Event not found').waitFor(); ok(tag + '404 -> not found, no retry', !(await p.getByRole('button', { name: 'Try again' }).count()));
    await p.goto('http://localhost:5199/events/boom'); await p.getByRole('alert').waitFor(); ok(tag + '500 -> error+retry (not "not found")', !(await p.getByText('Event not found').count()) && await p.getByRole('button', { name: 'Try again' }).isVisible());
    await p.goto('http://localhost:5199/events/C'); await p.getByText('This event has been cancelled').waitFor();
    ok(tag + 'cancelled: banner, no purchase action', !(await p.getByText(/Sign in to get a ticket|Buy ticket/i).count()));
    // stale: slow A then client-navigate to B
    delayA = 1500; await p.goto('http://localhost:5199/events'); await p.getByText('Event B').waitFor();
    await p.getByText('Event A').first().click(); await p.getByText('Loading event').waitFor();
    await p.goBack(); await p.getByText('Event B').first().click(); await p.getByRole('heading', { name: 'Event B' }).waitFor();
    await p.waitForTimeout(2000); ok(tag + 'late response for A does not overwrite B', await p.getByRole('heading', { name: 'Event B' }).isVisible() && !(await p.getByRole('heading', { name: 'Event A' }).count()));
    delayA = 0; await p.goto('http://localhost:5199/events/B'); await p.getByRole('heading', { name: 'Event B' }).waitFor();
    ok(tag + 'published: login-to-buy shown, 3 left shown', await p.getByText(/Sign in to get a ticket/i).isVisible() && await p.getByText('3 left').isVisible());
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /calendar/i }).click()]);
    const txt = require('fs').readFileSync(await dl.path(), 'utf8');
    ok(tag + '.ics download', dl.suggestedFilename().endsWith('.ics') && txt.includes('DTSTART;TZID=Asia/Almaty:20261201T190000'));
    ok(tag + 'no horizontal scroll', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await p.screenshot({ path: process.argv[2] + `/fs11-${vp.width}.png` });
  }
  console.log(res.join('\n')); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
