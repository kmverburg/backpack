const { test, expect, H, waitLog } = require('./helpers');

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

test('logs every /api request with method, path, status and ms', async ({ request }) => {
  await request.get('/api/state', { headers: H });
  const [l] = await waitLog((o) => o.event === 'request' && o.path === '/api/state' && o.method === 'GET' && o.status === 200);
  expect(l).toBeTruthy();
  expect(typeof l.ms).toBe('number');
});

test('logs a save conflict as a warning with both revisions', async ({ request, api }) => {
  const cur = await api.get();
  const body = { tags: [], items: [], trips: [] };
  await request.put('/api/state', { headers: H, data: { rev: cur.rev, data: body } });
  const r = await request.put('/api/state', { headers: H, data: { rev: cur.rev, data: body } });
  expect(r.status()).toBe(409);
  const [l] = await waitLog((o) => o.event === 'state_conflict' && o.clientRev === cur.rev);
  expect(l.level).toBe('warn');
  expect(l.serverRev).toBe(cur.rev + 1);
});

test('logs reported actions, drops unknown ones and ignores user text', async ({ request }) => {
  const r = await request.post('/api/log', { headers: H, data: { actions: ['trip_created', 'Secret trip name', { name: 'x' }], version: '1' } });
  expect(r.status()).toBe(200);
  const hits = await waitLog((o) => o.event === 'action' && o.action === 'trip_created');
  expect(hits.length).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 300));
  const all = JSON.stringify(require('./helpers').logs());
  expect(all).not.toContain('Secret trip name');
});

test('refuses /api/log without the login header', async ({ baseURL }) => {
  const r = await fetch(baseURL + '/api/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"actions":["trip_created"]}' });
  expect(r.status).toBe(403);
});

// Places search (Photon is replaced by tests/photon-mock.js)
const hitsOf = async (q) => (await (await fetch('http://localhost:8789/__hits?q=' + q)).json()).hits;

test('places: refuses without the login header', async ({ baseURL }) => {
  expect((await fetch(baseURL + '/api/places?q=lisbon')).status).toBe(403);
});

test('places: returns cities and countries with country, drops other types', async ({ request }) => {
  const r = await request.get('/api/places?q=Valencia', { headers: H });
  expect(r.status()).toBe(200);
  expect((await r.json()).places).toEqual([
    { name: 'Valencia', country: 'Spain', countryCode: 'ES', lat: 39.4699, lon: -0.3763 },
    { name: 'Valencia', country: 'Venezuela', countryCode: 'VE', lat: 10.162, lon: -68 },
  ]);
  const c = await (await request.get('/api/places?q=spain', { headers: H })).json();
  expect(c.places).toEqual([{ name: 'Spain', country: 'Spain', countryCode: 'ES', lat: 40.2, lon: -3.6 }]);
});

test('places: short queries return nothing without searching', async ({ request }) => {
  expect((await (await request.get('/api/places?q=a', { headers: H })).json()).places).toEqual([]);
  expect(await hitsOf('a')).toBe(0);
});

test('places: caches results and sends a user agent', async ({ request }) => {
  const url = '/api/places?q=Lisbon';
  const a = await (await request.get(url, { headers: H })).json();
  await new Promise((r) => setTimeout(r, 300)); // cache write finishes after the response
  const b = await (await request.get('/api/places?q=lisbon', { headers: H })).json();
  expect(b).toEqual(a);
  expect(a.places[0].name).toBe('Lisbon');
  expect(await hitsOf('lisbon')).toBe(1); // the mock refuses calls without a Backpack user agent
});

test('places: a failing search service gives 502 and is not cached', async ({ request }) => {
  const before = await hitsOf('boom');
  expect((await request.get('/api/places?q=boom', { headers: H })).status()).toBe(502);
  expect((await request.get('/api/places?q=boom', { headers: H })).status()).toBe(502);
  expect(await hitsOf('boom')).toBe(before + 2);
  expect((await request.get('/api/places?q=junk', { headers: H })).status()).toBe(502);
  await waitLog((o) => o.route === '/api/places' && o.level === 'error' && o.status === 502);
});
