const { test: base, expect } = require('@playwright/test');

const H = { 'Cf-Access-Jwt-Assertion': 'local-test' };
let n = 0;
const item = (o) => ({ id: 'i' + ++n, name: 'Thing', cat: 'Misc', mode: 'fixed', qty: 1, every: 1, cap: 0, tags: [], ...o });

// Every test starts from an empty state: no items, no trip types, no trips.
const test = base.extend({
  api: async ({ request }, use) => {
    const put = async (data) => {
      const cur = await (await request.get('/api/state', { headers: H })).json();
      const r = await request.put('/api/state', { headers: H, data: { rev: cur.rev, data } });
      expect(r.ok()).toBeTruthy();
    };
    await put({ tags: [], items: [], trips: [] });
    await use({ put, get: async () => (await request.get('/api/state', { headers: H })).json() });
  },
  page: async ({ page }, use) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await use(page);
  },
});

module.exports = { test, expect, item, H };
