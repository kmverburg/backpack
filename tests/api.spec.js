const { test, expect, H } = require('./helpers');

test('refuses /api/state without the login header', async ({ playwright, baseURL }) => {
  const bare = await playwright.request.newContext({ baseURL });
  expect((await bare.get('/api/state')).status()).toBe(403);
  expect((await bare.put('/api/state', { data: { rev: 0, data: {} } })).status()).toBe(403);
  await bare.dispose();
});

test('reads and saves state', async ({ request, api }) => {
  const before = await api.get();
  expect(before.data).toEqual({ tags: [], items: [], trips: [] });
  const r = await request.put('/api/state', { headers: H, data: { rev: before.rev, data: { tags: ['A'], items: [], trips: [] } } });
  expect(r.status()).toBe(200);
  expect((await r.json()).rev).toBe(before.rev + 1);
  const after = await api.get();
  expect(after.rev).toBe(before.rev + 1);
  expect(after.data.tags).toEqual(['A']);
});

test('rejects a save based on an outdated version', async ({ request, api }) => {
  const cur = await api.get();
  const ok = await request.put('/api/state', { headers: H, data: { rev: cur.rev, data: { tags: ['new'], items: [], trips: [] } } });
  expect(ok.status()).toBe(200);
  const stale = await request.put('/api/state', { headers: H, data: { rev: cur.rev, data: { tags: ['stale'], items: [], trips: [] } } });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).data.tags).toEqual(['new']);
  expect((await api.get()).data.tags).toEqual(['new']);
});
