const { test, expect, item, logs, waitLog } = require('./helpers');

const settle = (page) => page.waitForTimeout(700); // saves are debounced by 300 ms

async function plan(page, name, days, types = []) {
  await page.goto('/');
  await page.locator('#tn').fill(name);
  await page.locator('#td').fill(String(days));
  await page.locator('#td').dispatchEvent('change');
  for (const t of types) await page.getByRole('button', { name: t, exact: true }).click();
  await page.getByRole('button', { name: /Make packlist/ }).click();
}
const row = (page, name) => page.locator('.li', { hasText: name });

const base = () => ({
  tags: ['Beach', 'Hiking'],
  items: [
    item({ id: 'pass', name: 'Passport' }),
    item({ id: 'swim', name: 'Swim shorts', qty: 2, tags: ['Beach'] }),
    item({ id: 'sock', name: 'Socks', mode: 'per', qty: 1, every: 1, cap: 10 }),
    item({ id: 'shirt', name: 'T-shirts', mode: 'per', qty: 1, every: 2, cap: 7 }),
    item({ id: 'boot', name: 'Boots', tags: ['Hiking'] }),
    item({ id: 'long', name: 'Tent', minDays: 5 }),
  ],
  trips: [],
});

test('plans a trip with the right list and quantities', async ({ page, api }) => {
  await api.put(base());
  await plan(page, 'Beach week', 7, ['Beach']);
  await expect(row(page, 'Passport').locator('.q')).toHaveText('1×');
  await expect(row(page, 'Swim shorts').locator('.q')).toHaveText('2×'); // fixed, trip type
  await expect(row(page, 'Socks').locator('.q')).toHaveText('7×'); // per day
  await expect(row(page, 'T-shirts').locator('.q')).toHaveText('4×'); // every 2 days, rounded up
  await expect(row(page, 'Tent')).toHaveCount(1); // 7 days is longer than 5
  await expect(row(page, 'Boots')).toHaveCount(0); // other trip type
});

test('caps per-day amounts and skips items for longer trips on short trips', async ({ page, api }) => {
  await api.put(base());
  await plan(page, 'Long', 30, []);
  await expect(row(page, 'Socks').locator('.q')).toHaveText('10×');
  await expect(row(page, 'T-shirts').locator('.q')).toHaveText('7×');
  await page.getByRole('button', { name: 'Back' }).click();
  await plan(page, 'Short', 3, []);
  await expect(row(page, 'Tent')).toHaveCount(0);
  await expect(row(page, 'Socks').locator('.q')).toHaveText('3×');
});

test('ticks survive a reload', async ({ page, api }) => {
  await api.put(base());
  await plan(page, 'Trip', 3);
  await row(page, 'Passport').locator('input').check();
  await settle(page);
  await page.reload();
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(row(page, 'Passport').locator('input')).toBeChecked();
  await expect(row(page, 'Socks').locator('input')).not.toBeChecked();
});

test('editing a trip keeps ticks and asks before removing items', async ({ page, api }) => {
  await api.put(base());
  await plan(page, 'Trip', 7, ['Beach']);
  await row(page, 'Passport').locator('input').check();
  await row(page, 'Swim shorts').locator('input').check();

  // Change only the name: nothing removed, no dialog, ticks stay.
  await page.getByRole('button', { name: 'Edit trip' }).click();
  await page.locator('#en').fill('Renamed');
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(page.getByRole('heading', { name: 'Renamed' })).toBeVisible();
  await expect(row(page, 'Passport').locator('input')).toBeChecked();
  await expect(row(page, 'Swim shorts').locator('input')).toBeChecked();

  // Drop the Beach type: asks first. Dismissing keeps the item.
  await page.getByRole('button', { name: 'Edit trip' }).click();
  await page.locator('.chip[data-act=ttag]', { hasText: 'Beach' }).click();
  let msg = '';
  page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
  await page.getByRole('button', { name: 'Save trip' }).click();
  expect(msg).toContain('Swim shorts');
  await expect(row(page, 'Swim shorts')).toHaveCount(1);

  // Accepting removes it; the other tick stays.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(row(page, 'Swim shorts')).toHaveCount(0);
  await expect(row(page, 'Passport').locator('input')).toBeChecked();
});

test('adds, edits and deletes an item', async ({ page, api }) => {
  await api.put({ tags: [], items: [], trips: [] });
  await page.goto('/');
  await page.getByRole('button', { name: 'My items' }).click();
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.locator('#in').fill('Camera');
  await page.locator('#ic').fill('Electronics');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.locator('.item', { hasText: 'Camera' })).toContainText('1 per trip');

  await page.locator('.item', { hasText: 'Camera' }).getByRole('button', { name: 'Edit' }).click();
  await page.locator('#in').fill('Camera body');
  await page.locator('#iq').fill('2');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.locator('.item', { hasText: 'Camera body' })).toContainText('2 per trip');
  await expect(page.locator('.item')).toHaveCount(1);

  await settle(page);
  await page.reload();
  await page.getByRole('button', { name: 'My items' }).click();
  await expect(page.locator('.item', { hasText: 'Camera body' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Delete Camera body' }).click();
  await expect(page.locator('.item')).toHaveCount(0);
  await settle(page);
  expect((await api.get()).data.items).toEqual([]);
});

test('adds and removes a trip type', async ({ page, api }) => {
  await api.put({ tags: [], items: [item({ id: 'a', name: 'Skis', tags: ['Winter'] })], trips: [] });
  await page.goto('/');
  await page.getByRole('button', { name: 'My items' }).click();
  await page.locator('#nt').fill('Camping');
  await page.getByRole('button', { name: 'Add type' }).click();
  await expect(page.getByRole('button', { name: /Camping ✕/ })).toBeVisible();
  await settle(page);
  expect((await api.get()).data.tags).toEqual(['Camping']);

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Camping ✕/ }).click();
  await expect(page.getByRole('button', { name: /Camping ✕/ })).toHaveCount(0);
  await settle(page);
  expect((await api.get()).data.tags).toEqual([]);
});

test('deleting a trip asks for confirmation', async ({ page, api }) => {
  await api.put(base());
  await plan(page, 'Doomed', 3);
  await page.getByRole('button', { name: 'Back' }).click();

  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Delete trip' }).click();
  await expect(page.locator('.trip')).toHaveCount(1);

  let msg = '';
  page.once('dialog', (d) => { msg = d.message(); d.accept(); });
  await page.getByRole('button', { name: 'Delete trip' }).click();
  expect(msg).toBe('Delete this trip?');
  await expect(page.locator('.trip')).toHaveCount(0);
});

test('reports thrown browser errors, at most 5 per page load, without user data', async ({ page, api }) => {
  await api.put({ ...base(), tags: [] });
  const reqs = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/log')) reqs.push(r.postDataJSON()); });
  await page.goto('/');
  await expect(page.locator('#app')).not.toBeEmpty();
  await page.evaluate(() => { for (let i = 0; i < 8; i++) setTimeout(() => { throw new Error('test boom ' + i); }, 0); });
  await page.waitForTimeout(700);
  expect(reqs.length).toBe(5);
  expect(reqs[0].message).toContain('test boom');
  expect(Object.keys(reqs[0]).sort()).toEqual(['message', 'path', 'stack', 'version']);
  expect(reqs[0].path).toBe('/');
  expect(JSON.stringify(reqs)).not.toContain('Passport');
});

test('reports unhandled promise rejections', async ({ page }) => {
  await page.goto('/');
  const req = page.waitForRequest((r) => r.url().endsWith('/api/log'));
  await page.evaluate(() => { Promise.reject(new Error('rejected')); });
  expect((await req).postDataJSON().message).toBe('rejected');
});

test('reports key actions in one batch without user text', async ({ page, api }) => {
  await api.put(base());
  const reqs = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/log')) reqs.push(r.postDataJSON()); });
  await plan(page, 'Zebra Safari', 3);
  await settle(page);
  expect(reqs.length).toBe(1);
  expect(reqs[0].actions).toEqual(['trip_created']);
  const s = JSON.stringify(reqs);
  expect(s).not.toContain('Zebra');
  expect(s).not.toContain('Passport');
  await waitLog((o) => o.event === 'action' && o.action === 'trip_created');
  expect(JSON.stringify(logs())).not.toContain('Zebra');
});

const renameSetup = (api) => api.put({
  tags: ['Beach', 'City'],
  items: [item({ id: 'swim', name: 'Swim shorts', tags: ['Beach'] }), item({ id: 'pass', name: 'Passport' })],
  trips: [{ id: 't1', name: 'Trip', days: 3, tags: ['Beach'], list: [{ id: 'swim', name: 'Swim shorts', cat: '', qty: 1 }], checked: { swim: true } }],
});
async function startRename(page, from) {
  await page.goto('/');
  await page.getByRole('button', { name: 'My items' }).click();
  await page.getByRole('button', { name: 'Rename ' + from }).click();
}

test('renaming a trip type updates items and trips', async ({ page, api }) => {
  await renameSetup(api);
  await startRename(page, 'Beach');
  await page.locator('#rn').fill('  Sea side ');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: /Sea side ✕/ })).toBeVisible();
  await settle(page);
  const d = (await api.get()).data;
  expect(d.tags).toEqual(['Sea side', 'City']);
  expect(d.items.find((i) => i.id === 'swim').tags).toEqual(['Sea side']);
  expect(d.trips[0].tags).toEqual(['Sea side']);
  expect(d.trips[0].list.map((x) => x.id)).toEqual(['swim@me']);
  expect(d.trips[0].checked).toEqual({ 'swim@me': true });
});

test('renaming to a used name is refused', async ({ page, api }) => {
  await renameSetup(api);
  await startRename(page, 'Beach');
  await page.locator('#rn').fill(' city ');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#rnerr')).toContainText('already a trip type');
  await settle(page);
  expect((await api.get()).data.tags).toEqual(['Beach', 'City']);
});

test('renaming to an empty name is refused', async ({ page, api }) => {
  await renameSetup(api);
  await startRename(page, 'Beach');
  await page.locator('#rn').fill('   ');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#rnerr')).toContainText('Enter a name');
  await settle(page);
  expect((await api.get()).data.tags).toEqual(['Beach', 'City']);
});

// Start dates
const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymdOf(d); };
const mk = (id, name, startDate, days = 3) => ({ id, name, days, tags: [], list: [], checked: {}, ...(startDate ? { startDate } : {}) });

test('saves a start date when planning and shows the date range', async ({ page, api }) => {
  await api.put(base());
  await page.goto('/');
  await page.locator('#tn').fill('Lisbon');
  await page.locator('#td').fill('7');
  await page.locator('#td').dispatchEvent('change');
  await page.locator('#ts').fill('2027-07-12');
  await page.getByRole('button', { name: /Make packlist/ }).click();
  const expected = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .formatRange(Date.UTC(2027, 6, 12), Date.UTC(2027, 6, 18));
  await expect(page.locator('.trip-date')).toHaveText(expected);
  await settle(page);
  expect((await api.get()).data.trips[0].startDate).toBe('2027-07-12');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.trip-date')).toHaveText(expected);
});

test('date range is in the browser locale and crosses months', async ({ browser, api }) => {
  await api.put({ ...base(), trips: [mk('a', 'Alps', '2027-07-30', 5)] });
  const ctx = await browser.newContext({ locale: 'en-GB', extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': 'local-test' } });
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('http://localhost:8788/');
  await expect(page.locator('.trip-date')).toHaveText('30 Jul – 3 Aug 2027');
  await ctx.close();
});

test('edits, changes and clears the start date; undated trips show no date', async ({ page, api }) => {
  await api.put({ ...base(), trips: [mk('a', 'Plain', null)] });
  await page.goto('/');
  await expect(page.locator('.trip-date')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Edit trip' }).click();
  await page.locator('#es').fill('2027-03-01');
  await page.getByRole('button', { name: 'Save trip' }).click();
  await settle(page);
  expect((await api.get()).data.trips[0].startDate).toBe('2027-03-01');
  await page.getByRole('button', { name: 'Edit trip' }).click();
  await expect(page.locator('#es')).toHaveValue('2027-03-01');
  await page.locator('#es').fill('2027-04-02');
  await page.getByRole('button', { name: 'Save trip' }).click();
  await settle(page);
  expect((await api.get()).data.trips[0].startDate).toBe('2027-04-02');
  await page.getByRole('button', { name: 'Edit trip' }).click();
  await page.locator('#es').fill('');
  await page.getByRole('button', { name: 'Save trip' }).click();
  await settle(page);
  expect((await api.get()).data.trips[0].startDate).toBeUndefined();
  await expect(page.locator('.trip-date')).toHaveCount(0);
});

test('sorts upcoming first, then undated, then a collapsed Past trips group', async ({ page, api }) => {
  await api.put({ ...base(), trips: [
    mk('p1', 'Old', inDays(-30)), mk('n1', 'Undated', null), mk('u2', 'Later', inDays(40)),
    mk('u1', 'Soon', inDays(5)), mk('p2', 'Older', inDays(-90)), mk('now', 'Ongoing', inDays(-1)),
  ] });
  await page.goto('/');
  const top = page.locator('#app > section:last-of-type > .trip b');
  await expect(top).toHaveText(['Ongoing', 'Soon', 'Later', 'Undated']);
  const past = page.locator('details#pastg');
  await expect(past).toHaveJSProperty('open', false);
  await expect(past.locator('summary')).toHaveText('Past trips');
  await past.locator('summary').click();
  await expect(past.locator('.trip b')).toHaveText(['Old', 'Older']);
  await page.getByRole('button', { name: 'Open' }).first().click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(past).toHaveJSProperty('open', true);
});

test('no Past trips group when no trip is past', async ({ page, api }) => {
  await api.put({ ...base(), trips: [mk('a', 'Soon', inDays(2)), mk('b', 'None', null)] });
  await page.goto('/');
  await expect(page.locator('details#pastg')).toHaveCount(0);
});

// Locations
const sugs = (page) => page.locator('.sug button');

test('picking a suggestion stores the place on the trip', async ({ page, api }) => {
  await api.put(base());
  await page.goto('/');
  await expect(page.getByLabel('Location')).toBeVisible();
  await page.locator('#tn').fill('Valencia');
  await expect(sugs(page)).toHaveText(['Valencia, Spain', 'Valencia, Venezuela']);
  await sugs(page).nth(1).click();
  await expect(page.locator('#tn')).toHaveValue('Valencia, Venezuela');
  await expect(sugs(page)).toHaveCount(0);
  await page.getByRole('button', { name: /Make packlist/ }).click();
  await expect(page.locator('h2', { hasText: 'Valencia, Venezuela' })).toBeVisible();
  await settle(page);
  const t = (await api.get()).data.trips[0];
  expect(t.name).toBe('Valencia, Venezuela');
  expect(t.location).toEqual({ name: 'Valencia', country: 'Venezuela', countryCode: 'VE', lat: 10.162, lon: -68 });
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.trip b')).toHaveText('Valencia, Venezuela');
});

test('a country is shown by its name only', async ({ page, api }) => {
  await api.put(base());
  await page.goto('/');
  await page.locator('#tn').fill('spain');
  await expect(sugs(page)).toHaveText(['Spain']);
});

test('free text without choosing is allowed and has no location', async ({ page, api }) => {
  await api.put(base());
  await page.goto('/');
  await page.locator('#tn').fill('Valencia');
  await expect(sugs(page)).toHaveCount(2);
  await page.locator('#tn').fill('Grandma\'s cabin');
  await page.getByRole('button', { name: /Make packlist/ }).click();
  await settle(page);
  const t = (await api.get()).data.trips[0];
  expect(t.name).toBe('Grandma\'s cabin');
  expect(t.location).toBeUndefined();
});

test('editing text after choosing drops the place; editing can pick a new one', async ({ page, api }) => {
  await api.put(base());
  await page.goto('/');
  await page.locator('#tn').fill('Lisbon');
  await sugs(page).first().click();
  await page.locator('#tn').fill('Lisbon, June');
  await page.getByRole('button', { name: /Make packlist/ }).click();
  await settle(page);
  expect((await api.get()).data.trips[0].location).toBeUndefined();
  await page.getByRole('button', { name: 'Edit trip' }).click();
  await page.locator('#en').fill('Valencia');
  await sugs(page).first().click();
  await page.getByRole('button', { name: 'Save trip' }).click();
  await settle(page);
  const t = (await api.get()).data.trips[0];
  expect(t.name).toBe('Valencia, Spain');
  expect(t.location.countryCode).toBe('ES');
});

test('old trips keep their name as location text without coordinates', async ({ page, api }) => {
  await api.put({ ...base(), trips: [mk('a', 'Old trip', '2027-07-12')] });
  await page.goto('/');
  await expect(page.locator('.trip b')).toHaveText('Old trip');
  await expect(page.locator('.trip-date')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Edit trip' }).click();
  await expect(page.locator('#en')).toHaveValue('Old trip');
  await page.getByRole('button', { name: 'Save trip' }).click();
  await settle(page);
  const t = (await api.get()).data.trips[0];
  expect(t.name).toBe('Old trip');
  expect(t.location).toBeUndefined();
});

test('trip with a location shows it with the country and the start date', async ({ page, api }) => {
  const loc = { name: 'Lisbon', country: 'Portugal', countryCode: 'PT', lat: 38.7, lon: -9.1 };
  await api.put({ ...base(), trips: [{ ...mk('a', 'Lisbon, Portugal', '2027-07-12'), location: loc }] });
  await page.goto('/');
  await expect(page.locator('.trip b')).toHaveText('Lisbon, Portugal');
  await expect(page.locator('.trip-date')).toHaveCount(1);
});

test('typing waits 300 ms and sends at most one search per second', async ({ page, api }) => {
  await api.put(base());
  const times = [];
  await page.route('**/api/places*', (r) => { times.push(Date.now()); r.continue(); });
  await page.goto('/');
  const box = page.locator('#tn');
  await box.pressSequentially('Val', { delay: 50 }); // one burst of typing
  await page.waitForTimeout(150);
  expect(times).toHaveLength(0); // still waiting
  await expect.poll(() => times.length).toBe(1);
  await box.pressSequentially('encia');
  await page.waitForTimeout(500);
  await box.pressSequentially('x'); // type again right after the second search is due
  await expect.poll(() => times.length, { timeout: 5000 }).toBe(2);
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(950);
  await page.waitForTimeout(1500);
  expect(times).toHaveLength(2);
});

test('a failing search leaves free typing working', async ({ page, api }) => {
  await api.put(base());
  await page.goto('/');
  await page.locator('#tn').fill('boom town');
  await page.waitForTimeout(800);
  await expect(sugs(page)).toHaveCount(0);
  await page.getByRole('button', { name: /Make packlist/ }).click();
  await expect(page.locator('h2', { hasText: 'boom town' })).toBeVisible();
});
