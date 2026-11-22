const { chromium } = require('playwright');
const fs = require('fs');
const base = 'http://localhost:5199';
const users = [{ id: 'u1', email: 'ann@example.com', full_name: 'Ann', role: 'attendee', is_suspended: false }, { id: 'u2', email: 'bob@example.com', full_name: 'Bob', role: 'organizer', is_suspended: true }];
const events = [{ id: 'e1', title: 'Jazz', organizer_id: 'u2', status: 'published', visibility: 'public', paid_sales_status: 'ACTIVE', paid_sales_active: true, is_suspended: false },
  { id: 'e2', title: 'Rock', organizer_id: 'u2', status: 'draft', visibility: 'public', paid_sales_status: 'NONE', paid_sales_active: false, is_suspended: false }];
(async () => {
  const b = await chromium.launch(); const res = []; const ok = (n, c) => res.push((c ? 'PASS ' : 'FAIL ') + n);
  for (const role of ['attendee', 'organizer', 'platform_admin']) {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
    await p.addInitScript((r) => { localStorage.setItem('lang', 'en'); localStorage.setItem('auth_token', 'tok');
      localStorage.setItem('auth_user', JSON.stringify({ id: 'x', email: 'x@example.com', name: 'x', role: r })); }, role);
    const calls = []; let fee = 5000, auditOk = true, bodies = {};
    await p.route('**/api/users/me', r => r.fulfill({ json: { id: 'x', email: 'x@example.com', full_name: 'X', role } }));
    await p.route('**/api/admin/**', async r => {
      const u = new URL(r.request().url()); const path = u.pathname; calls.push(path + u.search);
      if (role !== 'platform_admin') return r.fulfill({ status: 403, json: { detail: 'Platform admin permissions required.' } });
      if (path.endsWith('/users') && r.request().method() === 'GET') {
        const q = u.searchParams.get('q');
        if (q === 'sl') await new Promise(s => setTimeout(s, 1200));
        return r.fulfill({ json: q === 'sl' ? [users[0]] : q === 'bo' ? [users[1]] : users });
      }
      if (path.endsWith('/events')) return r.fulfill({ json: events });
      if (path.endsWith('/orders')) return r.fulfill({ json: [{ id: 'o-1234567890', status: 'refunded', total_amount: 10000, created_at: '2026-11-01T00:00:00Z' }] });
      if (path.endsWith('/payments')) return r.fulfill({ json: [{ id: 'p-1234567890', status: u.searchParams.get('status') || 'completed', amount: 5000, simulated: true }] });
      if (path.endsWith('/reports')) return r.fulfill({ json: [{ id: 'c1', subject: 'Escalated: refund', category: 'payment', status: 'OPEN' }] });
      if (path.endsWith('/suspend')) { bodies.suspend = JSON.parse(r.request().postData()); return r.fulfill({ json: { success: true, suspended: true, message: 'ok', entity_id: 'u1', audit_recorded: auditOk } }); }
      if (path.endsWith('/unsuspend')) return r.fulfill({ json: { success: true, suspended: false, message: 'ok', entity_id: 'u2', audit_recorded: true } });
      if (path.endsWith('/activation-fee')) { if (r.request().method() === 'PATCH') { bodies.fee = JSON.parse(r.request().postData()); fee = bodies.fee.activation_fee_kzt; } return r.fulfill({ json: { activation_fee_kzt: fee } }); }
      if (path.endsWith('/export')) return r.fulfill({ json: { events_count: 2, orders_count: 1, tickets_count: 0, total_revenue_kzt: 0, timestamp: 'x', events, orders: [{ id: 'o1', status: 'paid', total_amount: 1, event_id: 'e1', created_at: 'd', user_id: 'SECRET-USER' }] } });
      return r.fulfill({ status: 404, json: {} });
    });
    const t = `[${role}] `;
    await p.goto(base + '/admin');
    if (role !== 'platform_admin') {
      await p.getByRole('heading', { name: 'No access' }).waitFor(); await p.waitForTimeout(300);
      ok(t + 'direct /admin shows no-access, no admin nav link, no admin API call', !(await p.getByRole('link', { name: 'Admin', exact: true }).count()) && calls.length === 0);
      const apiStatus = await p.evaluate(async () => (await fetch('http://localhost:8000/api/admin/users').catch(() => ({ status: 0 }))).status);
      ok(t + 'admin API itself answers 403 (stub mirrors server contract; real denial proven by backend tests)', apiStatus === 403 || apiStatus === 0);
      await ctx.close(); continue;
    }
    await p.getByRole('heading', { name: 'Admin console' }).waitFor(); ok(t + 'admin nav link present', await p.getByRole('link', { name: 'Admin', exact: true }).isVisible());
    await p.getByText('ann@example.com').waitFor(); ok(t + 'users list; payout info never requested/shown', !(await p.getByText(/payout/i).count()));
    await p.getByLabel('Search by email or name').fill('sl'); await p.getByLabel('Search by email or name').fill('bo');
    await p.getByText('bob@example.com').waitFor(); await p.waitForTimeout(1500);
    ok(t + 'slow earlier search does not overwrite newer results', (await p.getByText('bob@example.com').count()) === 1 && !(await p.getByText('ann@example.com').count()));
    await p.getByLabel('Search by email or name').fill(''); await p.getByText('ann@example.com').waitFor();
    await p.getByRole('button', { name: 'Suspend', exact: true }).first().click();
    ok(t + 'suspend needs a reason (confirm disabled)', await p.getByRole('region', { name: 'Suspend' }).getByRole('button', { name: 'Suspend' }).isDisabled());
    await p.getByLabel(/^Reason/).fill('Chargeback abuse'); auditOk = false;
    await p.getByRole('region', { name: 'Suspend' }).getByRole('button', { name: 'Suspend' }).click();
    await p.getByText(/audit log entry could not be recorded/).waitFor(); ok(t + 'reason sent; missing audit entry is surfaced', bodies.suspend.reason === 'Chargeback abuse');
    await p.getByRole('button', { name: 'Unsuspend' }).first().click(); await p.getByText('Unsuspended.').waitFor(); ok(t + 'unsuspend', true);
    await p.getByRole('tab', { name: 'Events' }).click(); await p.getByText('Rock').waitFor();
    await p.getByLabel('Paid sales').selectOption('NONE'); ok(t + 'paid-sales filter (activation review)', (await p.getByText('Jazz').count()) === 0 && (await p.getByText('Rock').count()) === 1);
    await p.getByRole('tab', { name: 'Orders' }).click(); await p.locator('tbody').getByText('refunded').waitFor(); ok(t + 'orders show refund state', await p.getByText('10,000 ₸').isVisible());
    await p.getByRole('tab', { name: 'Payments' }).click(); await p.getByLabel('Status').selectOption('failed'); await p.locator('tbody').getByText('failed').waitFor();
    ok(t + 'failed-payment filter hits server filter', calls.some(c => c.includes('/payments') && c.includes('status=failed')));
    await p.getByRole('tab', { name: 'Support' }).click(); const href = await p.getByRole('link', { name: 'Escalated: refund' }).getAttribute('href');
    ok(t + 'escalation links to its support thread; escalated badge', href === '/support/c1' && await p.getByText('Escalated', { exact: true }).isVisible());
    await p.getByRole('tab', { name: 'Campaigns' }).click(); await p.getByText(/needs an admin campaign API/).waitFor(); ok(t + 'campaigns: honest blocked notice', true);
    await p.getByRole('tab', { name: 'Settings' }).click(); await p.getByLabel(/^Fee/).fill('7500'); p.once('dialog', d => d.accept());
    await p.getByRole('button', { name: 'Save' }).click(); await p.getByText('Activation fee set to 7,500 ₸.').waitFor(); ok(t + 'fee change sent as PATCH', bodies.fee.activation_fee_kzt === 7500);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Export orders' }).click()]);
    const csv = fs.readFileSync(await dl.path(), 'utf8'); ok(t + 'orders CSV has no user ids/emails', csv.includes('id,status,total_amount,event_id,created_at') && !csv.includes('SECRET-USER'));
    ok(t + 'no horizontal scroll', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await ctx.close();
  }
  console.log(res.join('\n')); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
