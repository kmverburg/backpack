// Stand-in for Photon in tests (recorded-style sample responses). GET /__hits?q=x tells how often q was searched.
const http = require('http');
const f = (type, name, country, cc, lon, lat, state) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { osm_type: 'R', osm_key: 'place', osm_value: type, type, name, country, countrycode: cc, ...(state ? { state } : {}) } });
const DATA = {
  valencia: [f('city', 'Valencia', 'Spain', 'ES', -0.3763, 39.4699, 'Valencian Community'), f('city', 'Valencia', 'Venezuela', 'VE', -68, 10.1620, 'Carabobo'),
    { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { type: 'street', name: 'Valencia Street', country: 'United States', countrycode: 'US' } }],
  lisbon: [f('city', 'Lisbon', 'Portugal', 'PT', -9.1393, 38.7223, 'Lisbon')],
  spain: [f('country', 'Spain', 'Spain', 'ES', -3.6, 40.2)],
};
const hits = {};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__hits') { res.end(JSON.stringify({ hits: hits[(u.searchParams.get('q') || '').toLowerCase()] || 0 })); return; }
  const q = (u.searchParams.get('q') || '').toLowerCase();
  hits[q] = (hits[q] || 0) + 1;
  res.setHeader('x-seen-ua', req.headers['user-agent'] || '');
  if (!/^backpack\//i.test(req.headers['user-agent'] || '')) { res.statusCode = 403; res.end('no user agent'); return; }
  if (q.startsWith('boom')) { res.statusCode = 500; res.end('oops'); return; }
  if (q.startsWith('junk')) { res.end('not json'); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ type: 'FeatureCollection', features: DATA[q] || [] }));
}).listen(8789);
