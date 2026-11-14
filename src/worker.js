// Backpack: serves the app (static assets) and stores one shared state in KV.
const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});

// Structured log line for Workers Logs. console[level] sets the severity.
const log=(level,message,route,status,extra={})=>console[level](JSON.stringify({level,message,route,status,...extra}));
const MAX_REPORT=4096;
const cut=(v,n)=>typeof v==='string'?v.slice(0,n):undefined;

async function clientError(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (Number(req.headers.get('Content-Length')) > MAX_REPORT) return json({ error: 'too large' }, 413);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_REPORT) return json({ error: 'too large' }, 413);
  let b;
  try { b = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
  if (!b || typeof b !== 'object') return json({ error: 'bad body' }, 400);
  log('error', cut(b.message, 500) || 'unknown client error', '/api/client-error', 200,
    { source: 'client', stack: cut(b.stack, 2048), path: cut(b.path, 200), version: cut(b.version, 50) });
  return json({ ok: true });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const route = url.pathname;
    if (route !== '/api/state' && route !== '/api/client-error') return env.ASSETS.fetch(req);
    try {
      const res = await handle(req, env, route);
      if (res.status >= 500) log('error', 'server error response', route, res.status);
      return res;
    } catch (e) {
      log('error', String(e && e.message || e), route, 500, { stack: e && e.stack });
      return json({ error: 'server error' }, 500);
    }
  }
};

async function handle(req, env, route) {
  {
    // Cloudflare Access adds this header after login. Without it, refuse.
    if (!req.headers.get('Cf-Access-Jwt-Assertion')) { log('info', 'missing login header', route, 403); return new Response('Forbidden', { status: 403 }); }
    if (route === '/api/client-error') return clientError(req);

    const raw = await env.BACKPACK.get('state');
    const current = raw ? JSON.parse(raw) : { rev: 0, data: null };

    if (req.method === 'GET') return json(current);

    if (req.method === 'PUT') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!body || typeof body.data !== 'object') return json({ error: 'bad body' }, 400);
      if (body.rev !== current.rev) { log('warn', 'save conflict', route, 409); return json(current, 409); } // someone saved in between
      const next = { rev: current.rev + 1, data: body.data };
      await env.BACKPACK.put('state', JSON.stringify(next));
      return json({ rev: next.rev });
    }
    return new Response('Method not allowed', { status: 405 });
  }
}
