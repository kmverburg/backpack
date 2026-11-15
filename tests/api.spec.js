const { test, expect, H } = require('./helpers');

test('refuses /api/state without the login header', async ({ baseURL }) => {
  // Node fetch sends no extra headers, unlike the configured request context.
  expect((await fetch(baseURL + '/api/state')).status).toBe(403);
  const put = await fetch(baseURL + '/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rev: 0, data: {} }) });
  expect(put.status).toBe(403);
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

test('accepts a client error report', async ({ request }) => {
  const r = await request.post('/api/client-error', { headers: H, data: { message: 'boom', stack: 'at x', path: '/', version: '1' } });
  expect(r.status()).toBe(200);
});

test('rejects a client error report over 4 KB', async ({ request }) => {
  const r = await request.post('/api/client-error', { headers: H, data: { message: 'x'.repeat(5000) } });
  expect(r.status()).toBe(413);
});

test('refuses /api/client-error without the login header', async ({ baseURL }) => {
  const r = await fetch(baseURL + '/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"message":"x"}' });
  expect(r.status).toBe(403);
});
