# Backpack

Shared packing lists for two people (Koen and his partner). You plan a trip (name, days, trip types) and the app generates a packing list from "My items", which you tick off while packing. Live at https://backpack.kmverburg.nl, also wrapped as an Android app.

## Stack
- `public/index.html`: the whole app in one file. Vanilla JS, no framework, no build step, no dependencies.
- `src/worker.js`: Cloudflare Worker. Serves `public/` and stores one shared JSON state in KV at `/api/state` (GET, and PUT with a `rev` check that answers 409 on conflicting saves).
- `mobile/`: Capacitor shell for Android that loads the live site. Rarely changes.
- Cloudflare Access sits in front of the site in production. The Worker refuses `/api/state` without the `Cf-Access-Jwt-Assertion` header.

## Commands
- Install: nothing to install for the app itself.
- Install test tools (once): `npm ci` (dev-only: Playwright Test and wrangler; use `npm ci`, not `npm install`, so `package-lock.json` doesn't change), then `npx playwright install chromium`.
- Test: `npm test`. Starts `wrangler dev` itself on port 8788 with a throwaway local KV store (no Cloudflare login) and runs the API and Chromium tests in `tests/`. Each test resets state to empty first.
- Lint/syntax check: `node --check src/worker.js`
- Build: none. Deploy happens automatically on push to `main` (`.github/workflows/deploy.yml`).
- Run locally: `npx --yes wrangler@4 dev --port 8787`, then open http://localhost:8787. This uses a local KV store (in `.wrangler/`, gitignored) and needs no Cloudflare login.

## Checking UI changes in a browser
Locally there is no Cloudflare Access, so every request must send the header the Worker expects, or the app shows "Cannot reach the server":

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context(extra_http_headers={"Cf-Access-Jwt-Assertion": "local-test"}).new_page()
    page.goto("http://localhost:8787")
```

The first load shows the example items from `seed()`. Saves are debounced by 300 ms, so wait briefly after a change before reloading to check it was stored.

## Data model (stored as `data` in KV, must stay backwards compatible)
- `S.tags`: trip type names.
- `S.items[]`: `{id, name, cat, mode: 'fixed'|'per', qty, every, cap, tags[]}`.
- `S.trips[]`: `{id, name, days, tags[], list[{id, name, cat, qty}], checked{itemId: bool}}`. List entries reuse the id of the item they came from, which is what `checked` is keyed on.
Saved state from older versions must keep loading. When adding fields, handle them being missing.

## Conventions
- Keep everything in `public/index.html`; match its compact style. No new files, libraries or build tools for the app.
- Escape all user text with `esc()` before putting it in HTML.
- UI state lives in `ui`; call `grab()` before `render()` so typed form values survive a re-render, and call `save()` after changing `S`.
- Use `confirm()` before anything that deletes user data, as the existing code does.

## Off-limits
- `wrangler.toml` (routes, `workers_dev = false`, KV id) and the Access header check in `src/worker.js`.
- `mobile/` and `.github/`.

## Factory review rules
- Escalate any change to `src/worker.js` (auth check, PUT/409 conflict handling or storage).
- Escalate any change to the shape of saved data (renaming, removing or retyping fields of `S.items`, `S.trips` or `checked`). Normal edits to the data through the UI are fine, as long as data the user didn't choose to change is kept.
