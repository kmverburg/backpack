// Backpack: serves the app (static assets) and stores one shared state in KV.
const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});

// Structured log line for Workers Logs. console[level] sets the severity.
const log=(level,message,route,status,extra={})=>console[level](JSON.stringify({level,message,route,status,...extra}));
const MAX_REPORT=4096;
const cut=(v,n)=>typeof v==='string'?v.slice(0,n):undefined;

// Actions the app may report. Anything else is dropped, so no user text can reach the logs.
const ACTIONS=new Set(['trip_created','trip_edited','trip_deleted','item_added','item_edited','item_deleted','trip_type_added','trip_type_removed','list_updated_from_items','person_added','person_removed','trip_people_changed']);
const MAX_ACTIONS=20;

// POST /api/log (also the old /api/client-error): a browser error ({message,stack,path,version})
// and/or a batch of key actions ({actions:[name,...],version}).
async function clientLog(req, route) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (Number(req.headers.get('Content-Length')) > MAX_REPORT) return json({ error: 'too large' }, 413);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_REPORT) return json({ error: 'too large' }, 413);
  let b;
  try { b = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
  if (!b || typeof b !== 'object') return json({ error: 'bad body' }, 400);
  if (Array.isArray(b.actions)) {
    for (const a of b.actions.slice(0, MAX_ACTIONS))
      if (ACTIONS.has(a)) log('info', 'action', route, 200, { event: 'action', action: a, version: cut(b.version, 50) });
  }
  if (b.message !== undefined || !Array.isArray(b.actions))
    log('error', cut(b.message, 500) || 'unknown client error', route, 200,
      { source: 'client', stack: cut(b.stack, 2048), path: cut(b.path, 200), version: cut(b.version, 50) });
  return json({ ok: true });
}

// GET /api/places?q=: city/country suggestions from Photon (OpenStreetMap), so the phone only talks to Backpack.
// Results are cached per query (Photon asks for fair use). PHOTON_URL is only set for tests.
const PHOTON='https://photon.komoot.io/api/';
const UA='Backpack/1.0 (+https://backpack.kmverburg.nl)';
const PLACE_TYPES=new Set(['city','state','country']);
async function places(req, env, url, ctx) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const reply = (list, cc) => new Response(JSON.stringify({ places: list }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': cc } });
  if ([...q].length < 2) return reply([], 'no-store');
  const base = env.PHOTON_URL || PHOTON;
  const key = new Request('https://places.backpack.invalid/?q=' + encodeURIComponent(q.toLowerCase()));
  const hit = await caches.default.match(key);
  if (hit) return hit;
  let data;
  try {
    const r = await fetch(base + '?limit=8&lang=en&q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error('photon status ' + r.status);
    data = await r.json();
  } catch (e) {
    log('error', 'places search failed: ' + String(e && e.message || e), '/api/places', 502, { stack: e && e.stack });
    return json({ error: 'search unavailable' }, 502);
  }
  const seen = new Set(), list = [];
  for (const f of (data && Array.isArray(data.features) ? data.features : [])) {
    const p = f && f.properties || {}, c = f && f.geometry && f.geometry.coordinates || [];
    if (!PLACE_TYPES.has(p.type) || typeof p.name !== 'string' || typeof p.country !== 'string' || !isFinite(c[0]) || !isFinite(c[1])) continue;
    const place = { name: p.name.slice(0, 100), country: p.country.slice(0, 100), countryCode: String(p.countrycode || '').toUpperCase().slice(0, 2), lat: +c[1], lon: +c[0] };
    const k = place.name + '|' + place.country + '|' + p.type + '|' + (p.state || '');
    if (!seen.has(k)) { seen.add(k); list.push(place); }
  }
  const res = reply(list, 'public, max-age=86400');
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const route = url.pathname;
    if (!route.startsWith('/api/')) return env.ASSETS.fetch(req);
    const t0 = Date.now();
    let res;
    try {
      res = await handle(req, env, route, ctx);
      if (res.status >= 500) log('error', 'server error response', route, res.status);
    } catch (e) {
      log('error', String(e && e.message || e), route, 500, { stack: e && e.stack });
      res = json({ error: 'server error' }, 500);
    }
    log('info', 'request', route, res.status, { event: 'request', method: req.method, path: route, ms: Date.now() - t0 });
    return res;
  }
};

async function handle(req, env, route, ctx) {
  {
    // Cloudflare Access adds this header after login. Without it, refuse.
    if (!req.headers.get('Cf-Access-Jwt-Assertion')) { log('info', 'missing login header', route, 403); return new Response('Forbidden', { status: 403 }); }
    if (route === '/api/log' || route === '/api/client-error') return clientLog(req, route);
    if (route === '/api/places') return places(req, env, new URL(req.url), ctx);
    if (route !== '/api/state') return json({ error: 'not found' }, 404);

    const raw = await env.BACKPACK.get('state');
    const current = raw ? JSON.parse(raw) : { rev: 0, data: null };

    if (req.method === 'GET') return json(current);

    if (req.method === 'PUT') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!body || typeof body.data !== 'object') return json({ error: 'bad body' }, 400);
      if (body.rev !== current.rev) { log('warn', 'save conflict', route, 409, { event: 'state_conflict', clientRev: body.rev, serverRev: current.rev }); return json(current, 409); } // someone saved in between
      const next = { rev: current.rev + 1, data: body.data };
      await env.BACKPACK.put('state', JSON.stringify(next));
      return json({ rev: next.rev });
    }
    return new Response('Method not allowed', { status: 405 });
  }
}
