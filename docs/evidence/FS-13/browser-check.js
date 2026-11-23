const { chromium } = require('playwright');
const base = 'http://localhost:5199';
const EV = { id: 'ev1', title: 'Jazz', status: 'published', visibility: 'public', starts_at: '2026-12-01T14:00:00+05:00', timezone: 'Asia/Almaty', venue_name: 'Hall', paid_sales_status: 'NONE' };
const tiers = [{ id: 't1', event_id: 'ev1', name: 'GA', price: 0, quantity: 10, sold: 2, available: 8, reserved: 1, refunded: 1, checked_in: 1, is_hidden: false },
  { id: 't2', event_id: 'ev1', name: 'VIP', price: 5000, quantity: 5, sold: 0, available: 5, reserved: 0, refunded: 0, checked_in: 0, is_hidden: false }];
const camp = { campaign_id: 'c1', event_id: 'ev1', name: 'Spring', code: 'SPRING', discount_percent: 10, discount_type: 'percent', discount_value: 10, max_uses: 5, qr_scans: 4, orders: 2, tickets_sold: 3,
  gross_sales_kzt: 15000, discount_total_kzt: 1500, net_revenue_kzt: 13500, state: 'active', qr_link: 'http://localhost:8000/c/abc123', starts_at: '2026-11-01T00:00:00+00:00', ends_at: '2026-12-31T00:00:00+00:00' };
(async () => {
  const b = await chromium.launch(); const res = []; const ok = (n, c) => res.push((c ? 'PASS ' : 'FAIL ') + n);
  for (const upgrade of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
    await p.addInitScript(() => { localStorage.setItem('lang', 'en'); localStorage.setItem('auth_token', 'tok');
      localStorage.setItem('auth_user', JSON.stringify({ id: 'org-1', email: 'o@example.com', name: 'o', role: 'organizer' })); });
    let posted = null;
    await p.route('**/openapi.json', r => r.fulfill({ json: { paths: upgrade ? { '/api/campaigns/{campaign_id}/disabled': {} } : {} } }));
    await p.route('**/api/users/me', r => r.fulfill({ json: { id: 'org-1', email: 'o@example.com', full_name: 'O', role: 'organizer', payout_info: null } }));
    await p.route('**/api/organizer/events', r => r.fulfill({ json: [EV] }));
    await p.route('**/api/organizer/events/ev1/ticket-types', r => r.fulfill({ json: tiers }));
    await p.route('**/api/organizer/events/zzz/ticket-types', r => r.fulfill({ status: 403, json: { detail: 'You do not manage this event.' } }));
    await p.route('**/api/organizer/events/ev1/activation', r => r.fulfill({ json: { event_id: 'ev1', paid_sales_status: 'NONE', paid_sales_active: false, activation_fee_kzt: 7500, simulated: true,
      checklist: { at_least_one_paid_ticket_type: { passed: true }, valid_payout_account: { passed: false }, identity_verified: { passed: true, simulated: true }, activation_fee_paid: { passed: false, simulated: true, amount_kzt: 7500 } } } }));
    await p.route('**/api/organizer/campaigns/stats**', r => r.fulfill({ json: { campaigns: [camp], totals: {} } }));
    await p.route('**/api/campaigns', async r => { posted = JSON.parse(r.request().postData()); await r.fulfill({ status: 201, json: { qr_link: 'x' } }); });
    const t = `[upgrade=${upgrade}] `;
    await p.goto(base + '/organizer/events/ev1?tab=tickets');
    await p.getByText('Available 8 · Reserved 1 · Sold 2 · Refunded 1 · Checked in 1').waitFor();
    ok(t + 'tier shows available/reserved/sold/refunded/checked-in', true);
    if (!upgrade) {
      await p.goto(base + '/organizer/events/zzz'); await p.getByText('does not exist or you do not manage it').waitFor(); ok(t + 'cross-organizer URL -> no access message', true);
      await p.goto(base + '/organizer/events/ev1?tab=paid'); await p.getByText('Activate paid sales (7,500 ₸)').waitFor();
      ok(t + 'activation uses backend fee (7,500), not hard-coded', !(await p.getByText('5,000').count()));
      ok(t + 'identity item flagged demo', (await p.getByText('demo', { exact: true }).count()) >= 1);
      ok(t + 'payout item missing from backend state', await p.getByText('Enter and save a payout account.').isVisible());
    }
    await p.goto(base + '/organizer/events/ev1?tab=campaigns'); await p.getByText('SPRING').first().waitFor();
    ok(t + 'campaign state badge + stats', await p.getByText('Active', { exact: true }).isVisible() && await p.getByText('13,500 ₸').isVisible());
    ok(t + 'upgrade notice ' + (upgrade ? 'hidden' : 'shown'), (await p.getByText(/campaign upgrade on the server/).count()) === (upgrade ? 0 : 1));
    ok(t + 'fixed-amount radio ' + (upgrade ? 'enabled' : 'disabled'), (await p.getByRole('radio', { name: /Fixed amount/ }).isDisabled()) === !upgrade);
    ok(t + 'destination shown', await p.getByText(/opens http:\/\/localhost:5199\/events\/ev1\?promo=SPRING/).isVisible());
    await p.getByRole('button', { name: 'QR code' }).click();
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Download QR/ }).click()]);
    ok(t + 'QR PNG download', dl.suggestedFilename() === 'campaign-spring.png');
    await p.getByLabel(/^Name/).fill('Autumn'); await p.getByLabel(/^Promo code/).fill('ab'); await p.getByRole('button', { name: 'Create campaign' }).click();
    await p.getByText('Please fix the following:').waitFor();
    ok(t + 'validation keeps inputs and lists errors', (await p.getByLabel(/^Name/).inputValue()) === 'Autumn' && await p.getByText(/Code: 3/).isVisible() && posted === null);
    await p.getByLabel(/^Promo code/).fill('autumn'); await p.getByLabel(/^Discount, %/).fill('15'); await p.getByLabel(/^Maximum/).fill('20'); await p.getByLabel(/^Expires/).fill('2026-12-30T12:00');
    await p.getByRole('button', { name: 'Create campaign' }).click(); await p.getByText('Campaign AUTUMN created.').waitFor();
    ok(t + 'create sends percent payload' + (upgrade ? ' + upgrade fields' : ' only'), posted.discount_percent === 15 && posted.code === 'AUTUMN' && (('discount_type' in posted) === upgrade));
    if (upgrade) ok(t + 'disable action offered', await p.getByRole('button', { name: 'Disable' }).isVisible());
    ok(t + 'no horizontal scroll', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await ctx.close();
  }
  console.log(res.join('\n')); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
