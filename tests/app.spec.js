const { test, expect, item } = require('./helpers');

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
