const { test, expect, item, waitLog } = require('./helpers');

const settle = (page) => page.waitForTimeout(700);
const P2 = [{ id: 'me', name: 'Me' }, { id: 'an', name: 'Anna' }];
const row = (page, name) => page.locator('.li', { hasText: name });
const sec = (page, who) => page.locator('section.sec', { has: page.locator('h2.who', { hasText: who }) });
const items = () => [
  item({ id: 'pass', name: 'Passport' }),
  item({ id: 'sock', name: 'Socks', mode: 'per', qty: 1, every: 2, cap: 5 }),
  item({ id: 'tent', name: 'Tent', for: 'shared', packer: 'an' }),
  item({ id: 'razor', name: 'Razor', for: ['me'] }),
  item({ id: 'dress', name: 'Dress', for: ['an'] }),
];
// Plans a trip from the draft form (all people are selected by default).
async function plan(page, days, who) {
  await page.goto('/');
  await page.locator('#tn').fill('Trip');
  await page.locator('#td').fill(String(days));
  await page.locator('#td').dispatchEvent('change');
  if (who) for (const n of who) await page.locator('.chip[data-act=dpeople]', { hasText: n }).click();
  await page.getByRole('button', { name: /Make packlist/ }).click();
}
const lines = async (api) => (await api.get()).data.trips[0].list.map((x) => `${x.id}:${x.qty}`).sort();

test('one traveller: per person, shared and only-for items', async ({ page, api }) => {
  await api.put({ tags: [], items: items(), trips: [] });
  await plan(page, 6);
  await expect(row(page, 'Passport').locator('.q')).toHaveText('1×');
  await expect(row(page, 'Socks').locator('.q')).toHaveText('3×');
  await expect(row(page, 'Tent').locator('.q')).toHaveText('1×');
  await expect(row(page, 'Razor')).toHaveCount(1);
  await expect(row(page, 'Dress')).toHaveCount(0);
  await settle(page);
  expect(await lines(api)).toEqual(['pass@me:1', 'razor@me:1', 'sock@me:3', 'tent:1']);
});

test('two travellers: sections, quantities per person, shared once', async ({ page, api }) => {
  await api.put({ people: P2, tags: [], items: items(), trips: [] });
  await plan(page, 10);
  await expect(sec(page, 'Me').locator('.li')).toHaveCount(3); // Passport, Socks, Razor
  await expect(sec(page, 'Anna').locator('.li')).toHaveCount(3); // Passport, Socks, Dress
  await expect(sec(page, 'Shared').locator('.li')).toHaveCount(1);
  await expect(sec(page, 'Me').locator('.li', { hasText: 'Socks' }).locator('.q')).toHaveText('5×'); // 10 days / 2, per person
  await expect(sec(page, 'Anna').locator('.li', { hasText: 'Socks' }).locator('.q')).toHaveText('5×');
  await expect(sec(page, 'Shared').locator('.li', { hasText: 'Tent' })).toContainText('Anna packs');
  await expect(row(page, 'Razor')).toHaveCount(1);
  await expect(row(page, 'Dress')).toHaveCount(1);
});

test('ticks are separate per traveller; a shared line is ticked once', async ({ page, api }) => {
  await api.put({ people: P2, tags: [], items: items(), trips: [] });
  await plan(page, 4);
  await sec(page, 'Me').locator('.li', { hasText: 'Passport' }).locator('input').check();
  await sec(page, 'Shared').locator('.li', { hasText: 'Tent' }).locator('input').check();
  await expect(sec(page, 'Anna').locator('.li', { hasText: 'Passport' }).locator('input')).not.toBeChecked();
  await settle(page);
  await page.reload();
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(sec(page, 'Me').locator('.li', { hasText: 'Passport' }).locator('input')).toBeChecked();
  await expect(sec(page, 'Anna').locator('.li', { hasText: 'Passport' }).locator('input')).not.toBeChecked();
  await expect(sec(page, 'Shared').locator('.li', { hasText: 'Tent' }).locator('input')).toBeChecked();
  expect(Object.keys((await api.get()).data.trips[0].checked).sort()).toEqual(['pass@me', 'tent']);
});

test('planning with only one of two people', async ({ page, api }) => {
  await api.put({ people: P2, tags: [], items: items(), trips: [] });
  await plan(page, 4, ['Me']); // untick Me, so only Anna comes
  await expect(page.locator('h2.who')).toHaveText(['Anna', 'Shared']);
  await expect(row(page, 'Razor')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  // at least one person must stay selected
  await page.locator('.chip[data-act=dpeople]', { hasText: 'Me' }).click();
  await page.locator('.chip[data-act=dpeople]', { hasText: 'Anna' }).click(); // ignored: last one left
  await expect(page.locator('.chip[data-act=dpeople][aria-pressed=true]')).toHaveCount(1);
});

test('changing who is coming keeps ticks, and asks before removing lines', async ({ page, api }) => {
  await api.put({ people: P2, tags: [], items: items(), trips: [] });
  await plan(page, 4);
  await sec(page, 'Me').locator('.li', { hasText: 'Passport' }).locator('input').check();
  await sec(page, 'Anna').locator('.li', { hasText: 'Passport' }).locator('input').check();

  await page.getByRole('button', { name: 'Edit trip' }).click();
  await page.locator('.chip[data-act=tpeople]', { hasText: 'Anna' }).click();
  let msg = '';
  page.once('dialog', (d) => { msg = d.message(); d.dismiss(); });
  await page.getByRole('button', { name: 'Save trip' }).click();
  expect(msg).toContain('Dress (Anna)');
  expect(msg).toContain('Passport (Anna)');
  await expect(sec(page, 'Anna')).toHaveCount(1); // dismissed: nothing changed

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(sec(page, 'Anna')).toHaveCount(0);
  await expect(row(page, 'Passport').locator('input')).toBeChecked();

  // Adding her back adds her lines, no dialog, Me's tick stays.
  await page.getByRole('button', { name: 'Edit trip' }).click();
  await page.locator('.chip[data-act=tpeople]', { hasText: 'Anna' }).click();
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(sec(page, 'Anna').locator('.li')).toHaveCount(3);
  await expect(sec(page, 'Me').locator('.li', { hasText: 'Passport' }).locator('input')).toBeChecked();
  await expect(sec(page, 'Anna').locator('.li', { hasText: 'Passport' }).locator('input')).not.toBeChecked();
  await settle(page);
  expect((await api.get()).data.trips[0].people).toEqual(['me', 'an']);
  expect(await waitLog((l) => l.action === 'trip_people_changed')).not.toHaveLength(0);
});

test('saved data from before this change loads as Me only, with ticks kept', async ({ page, api }) => {
  await api.put({
    tags: [], items: [item({ id: 'a', name: 'Passport' }), item({ id: 'b', name: 'Socks', mode: 'per', cap: 10 })],
    trips: [{ id: 't1', name: 'Old', days: 3, tags: [], list: [{ id: 'a', name: 'Passport', cat: 'Misc', qty: 1 }, { id: 'b', name: 'Socks', cat: 'Misc', qty: 3 }], checked: { a: true } }],
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('h2.who')).toHaveCount(0); // one traveller: looks as before
  await expect(row(page, 'Passport').locator('input')).toBeChecked();
  await expect(row(page, 'Socks').locator('input')).not.toBeChecked();
  await page.getByRole('button', { name: 'Edit trip' }).click();
  await expect(page.locator('.chip[data-act=tpeople][aria-pressed=true]')).toHaveText(['Me']);
  await page.getByRole('button', { name: 'Save trip' }).click(); // nothing removed, no dialog
  await expect(row(page, 'Passport').locator('input')).toBeChecked();
  await page.getByRole('button', { name: 'My items' }).click();
  await expect(page.getByRole('button', { name: /Me ✕/ })).toHaveCount(0); // the only person can't be removed
  await expect(page.getByRole('button', { name: 'Rename Me' })).toBeVisible();
});

test('migrate() is idempotent and converts old lines and ticks', async ({ page }) => {
  await page.goto('/');
  const r = await page.evaluate(() => {
    const d = { items: [], tags: [], trips: [{ id: 't', days: 2, tags: [], list: [{ id: 'a', name: 'A', cat: 'X', qty: 1 }], checked: { a: true } }] };
    const once = JSON.stringify(migrate(d));
    return [once, JSON.stringify(migrate(JSON.parse(once)))];
  });
  expect(r[0]).toBe(r[1]);
  const d = JSON.parse(r[0]);
  expect(d.people).toEqual([{ id: 'me', name: 'Me' }]);
  expect(d.trips[0].people).toEqual(['me']);
  expect(d.trips[0].list[0]).toMatchObject({ id: 'a@me', item: 'a', person: 'me' });
  expect(d.trips[0].checked).toEqual({ 'a@me': true });
});

test('people: add, rename, remove; adding a second suggests reviewing shared items', async ({ page, api }) => {
  await api.put({ tags: [], items: [item({ id: 'a', name: 'First aid kit' }), item({ id: 'b', name: 'Socks' }), item({ id: 'c', name: 'Dress', for: ['me'] })], trips: [] });
  await page.goto('/');
  await page.getByRole('button', { name: 'My items' }).click();
  await expect(page.locator('#review')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rename Me' }).click();
  await page.locator('#prn').fill('Koen');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('#np').fill('Anna');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.locator('#review')).toBeVisible();
  await page.locator('#review .li', { hasText: 'First aid kit' }).locator('input').check();
  await page.getByRole('button', { name: 'Mark ticked items as shared' }).click();
  await expect(page.locator('#review')).toHaveCount(0);
  await expect(page.locator('.item', { hasText: 'First aid kit' })).toContainText('shared');
  await expect(page.locator('.item', { hasText: 'Dress' })).toContainText('only for Koen');
  await settle(page);
  const d = (await api.get()).data;
  expect(d.people.map((p) => p.name)).toEqual(['Koen', 'Anna']);
  expect(d.items.find((i) => i.id === 'a').for).toBe('shared');
  expect(await waitLog((l) => l.action === 'person_added')).not.toHaveLength(0);

  // Plan a trip, then remove Anna: her lines go, a confirm is shown.
  await page.getByRole('button', { name: 'Trips' }).click();
  await page.locator('#tn').fill('X');
  await page.getByRole('button', { name: /Make packlist/ }).click();
  await expect(sec(page, 'Anna').locator('.li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'My items' }).click();
  page.once('dialog', (d2) => d2.accept());
  await page.getByRole('button', { name: /Anna ✕/ }).click();
  await settle(page);
  const d2 = (await api.get()).data;
  expect(d2.people).toHaveLength(1);
  expect(d2.trips[0].people).toEqual(['me']);
  expect(d2.trips[0].list.every((x) => x.person !== 'an')).toBe(true);
  expect(await waitLog((l) => l.action === 'person_removed')).not.toHaveLength(0);
});

test('item form: Who needs it, Only for and packer', async ({ page, api }) => {
  await api.put({ people: P2, tags: [], items: [], trips: [] });
  await page.goto('/');
  await page.getByRole('button', { name: 'My items' }).click();
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.locator('#in').fill('Tent');
  await page.locator('#if').selectOption('shared');
  await page.locator('#ip').selectOption('an');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.locator('.item', { hasText: 'Tent' })).toContainText('usually packed by Anna');
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.locator('#in').fill('Razor');
  await page.locator('#if').selectOption('only');
  await page.locator('.chip[data-act=efor]', { hasText: 'Anna' }).click();
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.locator('.item', { hasText: 'Razor' })).toContainText('only for Me');
  await settle(page);
  const d = (await api.get()).data.items;
  expect(d.find((i) => i.name === 'Tent')).toMatchObject({ for: 'shared', packer: 'an' });
  expect(d.find((i) => i.name === 'Razor').for).toEqual(['me']);
});
