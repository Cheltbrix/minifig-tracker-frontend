/* Keeps a complete copy of your data (and pictures) on this phone, so the app works with no signal.
   Online: the app talks to the live server as normal. Offline, or if the server is too slow: this file answers
   the same questions from the saved copy. */
(function (root) {
  'use strict';

  const REFRESH_MS = 6 * 3600 * 1000;           // refresh the saved copy at most every 6 hours when you open the app
  const IMG_CACHE = 'img-v1';
  const MEASURE_FIELD = { best: 'value_gbp', soldNew: 'v_sold_new', soldUsed: 'v_sold_used', askNew: 'v_ask_new', askUsed: 'v_ask_used', soldChain: 'v_sold_chain', askMixed: 'v_ask_mixed', be: 'be_value_new' };

  const nv = (x) => (x == null ? null : parseFloat(x));
  const lc = (s) => String(s == null ? '' : s).toLowerCase();
  const plain = (s) => lc(s).replace(/[^a-z0-9]+/g, '');
  const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const fail = (msg, status) => { const e = new Error(msg); e.status = status; return e; };

  // ======================= answers questions from a saved copy (same results as the server) =======================
  function engine(snap, byId, path) {
    const u = new URL(path, 'http://saved.local');
    const p = u.pathname, q = u.searchParams;
    if (p === '/api/dashboard') return snap.dashboard;
    if (p === '/api/highlights') return snap.highlights;
    if (p === '/api/years') return snap.years;
    if (p === '/api/minifigures') return list(snap, q);
    const m = /^\/api\/minifigures\/([^/]+)$/.exec(p);
    if (m) return detail(snap, byId, decodeURIComponent(m[1]).toLowerCase(), q);
    if (p === '/api/measure-list') return measureList(snap, q);
    if (p === '/api/deals') return deals(snap, q);
    throw fail('This page is not available offline', 404);
  }

  function numCmp(field, dir, tieDesc) {
    return (a, b) => {
      const x = nv(a[field]), y = nv(b[field]);
      if (x == null && y == null) return tieDesc ? cmpStr(b.catalog_id, a.catalog_id) : cmpStr(a.catalog_id, b.catalog_id);
      if (x == null) return 1;                                  // empty values last, whichever way round
      if (y == null) return -1;
      if (x !== y) return dir === 'desc' ? y - x : x - y;
      return tieDesc ? cmpStr(b.catalog_id, a.catalog_id) : cmpStr(a.catalog_id, b.catalog_id);
    };
  }
  const byName = (a, b) => cmpStr(plain(a.name), plain(b.name)) || cmpStr(lc(a.name), lc(b.name)) || cmpStr(a.catalog_id, b.catalog_id);

  function list(snap, q) {
    const prefix = q.get('prefix'), universe = q.get('universe'), search = q.get('search'), year = q.get('year');
    const owned = q.get('owned') || 'all', removed = q.get('removed'), nosale = q.get('nosale'), sortBy = q.get('sortBy') || 'number';
    const page = Math.max(parseInt(q.get('page'), 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(q.get('limit'), 10) || 30, 1), 100);
    let rows = snap.figures.filter((f) => (removed === 'only' ? !!f.removed : !f.removed));
    if (prefix) rows = rows.filter((f) => f.prefix === prefix);
    if (universe) rows = rows.filter((f) => f.universe === universe);
    if (year) rows = rows.filter((f) => f.year_released === parseInt(year, 10));
    if (owned === 'owned') rows = rows.filter((f) => f.quantity > 0);
    if (owned === 'not-owned') rows = rows.filter((f) => f.quantity === 0);
    if (nosale === '1') rows = rows.filter((f) => f.no_uk_sale === true);
    if (search) {
      const a = lc(search.trim()), b = lc(search.trim().replace(/\s+/g, ''));
      rows = rows.filter((f) => lc(f.name).includes(a) || lc(f.catalog_id).includes(b) || lc(f.bl_number).includes(b));
    }
    const measure = Object.prototype.hasOwnProperty.call(MEASURE_FIELD, q.get('measure')) ? MEASURE_FIELD[q.get('measure')] : 'value_gbp';
    const order = {
      'price-high': numCmp(measure, 'desc'), 'price-low': numCmp(measure, 'asc'), gain: numCmp('gain_pct', 'desc'),
      traded: numCmp('units_sold_6m', 'desc'), 'year-desc': numCmp('year_released', 'desc', true), 'year-asc': numCmp('year_released', 'asc'),
      name: byName, number: (a, b) => cmpStr(a.catalog_id, b.catalog_id), 'number-desc': (a, b) => cmpStr(b.catalog_id, a.catalog_id)
    }[sortBy] || ((a, b) => cmpStr(a.catalog_id, b.catalog_id));
    rows = rows.slice().sort(order);
    const total = rows.length;
    return { data: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  function detail(snap, byId, id, q) {
    const f = byId.get(id);
    if (!f) throw fail('Not found', 404);
    const days = Math.min(parseInt(q.get('days'), 10) || 365, 3650);
    const since = Date.now() - days * 864e5;
    const priceHistory = (snap.history[f.catalog_id] || []).filter((h) => new Date(h[0]).getTime() >= since).map((h) => ({ recorded_at: h[0], value_gbp: h[1] }));
    return { minifigure: f, priceHistory, sets: snap.sets[f.catalog_id] || [] };
  }

  function measureList(snap, q) {
    const key = Object.prototype.hasOwnProperty.call(MEASURE_FIELD, q.get('measure')) ? q.get('measure') : 'best';
    const prefix = q.get('prefix');
    const data = snap.figures.filter((f) => f.quantity > 0 && !f.removed && (!prefix || f.prefix === prefix)).sort(byName);
    return { measure: key, data };
  }

  function deals(snap, q) {
    const num = (v, d, lo, hi) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : d; };
    const discount = num(q.get('discount'), 20, 1, 95), minPrice = num(q.get('minprice'), 10, 0, 100000);
    const minSales = Math.round(num(q.get('minsales'), 2, 1, 1000)), minListings = Math.round(num(q.get('minlistings'), 1, 1, 3));
    const sc = q.get('scope'), scope = ['owned', 'not-owned'].includes(sc) ? sc : 'all';
    const out = [];
    for (const f of snap.figures) {
      const typical = nv(f.bricklink_avg_sold_new), listing = nv(f.uk_cheapest_new);
      if (f.removed || f.prefix === 'STAT' || listing == null || typical == null) continue;
      if (!(f.uk_units_sold_new >= minSales) || !(typical >= minPrice)) continue;
      if (scope === 'owned' && !(f.quantity > 0)) continue;
      if (scope === 'not-owned' && f.quantity !== 0) continue;
      const margin = Math.round((typical - listing) * 100) / 100;
      const pct = Math.round(((typical - listing) / typical) * 1000) / 10;
      if (!(pct >= discount)) continue;
      const listings = f.uk_new_listings || [];
      const dealCount = listings.filter((x) => ((typical - parseFloat(x)) / typical) * 100 >= discount).length;
      if (dealCount < minListings) continue;
      out.push({ catalog_id: f.catalog_id, name: f.name, prefix: f.prefix, image_url: f.image_url, quantity: f.quantity, price_recorded_at: f.price_recorded_at,
        typical: f.bricklink_avg_sold_new, listing: f.uk_cheapest_new, sales: f.uk_units_sold_new, margin: margin.toFixed(2), discount_pct: pct.toFixed(1),
        listings: f.uk_new_listings, last_new_price: f.last_sold_new_price, last_new_date: f.last_sold_new_date, deal_count: dealCount });
    }
    out.sort(q.get('sort') === 'discount' ? (a, b) => parseFloat(b.discount_pct) - parseFloat(a.discount_pct) : (a, b) => parseFloat(b.margin) - parseFloat(a.margin));
    return { data: out.slice(0, 200), params: { discount, minPrice, minSales, minListings, scope } };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { engine };
  if (typeof window === 'undefined') return;

  // ======================= storage, refresh, pictures and the on-screen bits (browser only) =======================
  const state = { api: '', snap: null, byId: new Map(), ready: null, busy: false, error: '', imgRunning: false, imgTotal: 0, imgDone: 0, editTimer: null, direct: undefined, directFails: 0 };

  const openDb = () => new Promise((res, rej) => {
    const r = indexedDB.open('minifig-offline', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const idbGet = async (k) => { const db = await openDb(); return new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); };
  const idbSet = async (k, v) => { const db = await openDb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); };

  const setSnap = (s) => { state.snap = s; state.byId = new Map(s.figures.map((f) => [f.catalog_id, f])); };
  const imgUrl = (f) => f.image_url || `https://img.bricklink.com/ItemImage/MN/0/${f.catalog_id}.png`;
  const fmtDate = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtN = (n) => Number(n).toLocaleString('en-GB');

  function render() {
    const el = document.getElementById('offlinebar');
    if (!el) return;
    const s = state.snap;
    const line1 = s ? `Offline copy saved ${fmtDate(s.generatedAt)} · ${fmtN(s.figures.length)} figures`
      : state.busy ? 'Saving an offline copy…' : 'No offline copy saved yet';
    const line2 = state.imgTotal ? `Pictures saved: ${fmtN(state.imgDone)} of ${fmtN(state.imgTotal)}${state.imgRunning ? '…' : ''}` : '';
    el.innerHTML = `<div>${line1}${state.busy && s ? ' · updating…' : ''}</div>${line2 ? `<div>${line2}</div>` : ''}${state.error ? `<div class="err">${state.error}</div>` : ''}<button type="button" id="ob-update"${state.busy ? ' disabled' : ''}>Update now</button>`;
    const b = document.getElementById('ob-update'); if (b) b.onclick = () => refresh(true);
  }

  async function refresh(force) {
    await state.ready;
    if (state.busy) return;
    if (navigator.onLine === false) return;
    const fresh = state.snap && Date.now() - Date.parse(state.snap.generatedAt) < REFRESH_MS;
    if (!force && fresh) { cacheImages(); return; }
    state.busy = true; state.error = ''; render();
    try {
      const res = await fetch(state.api + '/api/snapshot');
      if (!res.ok) throw new Error(`Server answered ${res.status}`);
      const snap = await res.json();
      if (!snap || !Array.isArray(snap.figures)) throw new Error('Unexpected answer');
      await idbSet('snapshot', snap);
      setSnap(snap);
    } catch (e) { state.error = 'Could not update the offline copy (' + e.message + ')'; }
    state.busy = false; render();
    if (!state.error) cacheImages();
  }

  async function cacheImages() {
    if (state.imgRunning || !state.snap || !('caches' in window)) return;
    state.imgRunning = true;
    try {
      const cache = await caches.open(IMG_CACHE);
      const have = new Set((await cache.keys()).map((r) => r.url));
      const all = [...new Set(state.snap.figures.filter((f) => !f.removed).map(imgUrl))];
      const todo = all.filter((u) => !have.has(u));
      state.imgTotal = all.length; state.imgDone = all.length - todo.length; render();
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          if (navigator.onLine === false) return;
          if (document.hidden) await new Promise((r) => document.addEventListener('visibilitychange', r, { once: true }));
          const u = todo[next++];
          try {
            let res = null;
            if (state.direct !== false) {                                   // straight from BrickLink if it allows websites to read pictures
              try { res = await fetch(u, { mode: 'cors' }); if (!res.ok) res = null; else state.direct = true; }
              catch (e) { if (state.direct === undefined && ++state.directFails >= 3) state.direct = false; }
            }
            if (!res) { res = await fetch(state.api + '/api/img?u=' + encodeURIComponent(u)); if (!res.ok) throw new Error('bad'); }   // otherwise via your own server
            await cache.put(u, res); state.imgDone++;
          } catch (e) { /* skip this one, try again next time */ }
          if (state.imgDone % 20 === 0) render();
          await new Promise((r) => setTimeout(r, 60));
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } catch (e) { /* ignore */ }
    state.imgRunning = false; render();
  }

  function banner(on) {
    let b = document.getElementById('savedbanner');
    if (!on) { if (b) b.hidden = true; return; }
    if (!b) {
      b = document.createElement('div'); b.id = 'savedbanner'; b.className = 'savedbanner';
      b.onclick = () => { b.hidden = true; if (typeof retryServer === 'function') retryServer(); if (typeof route === 'function') route(); };
      document.body.appendChild(b);
    }
    b.textContent = `Saved copy from ${state.snap ? fmtDate(state.snap.generatedAt) : 'earlier'} · tap to retry`;
    b.hidden = false;
  }

  function afterEdit(id, r) {                                   // keep the saved copy in step with changes you make while online
    const f = state.byId.get(String(id).toLowerCase());
    if (f && r) { if (r.quantity !== undefined) { f.quantity = r.quantity; f.owned = r.quantity > 0; } if (r.removed !== undefined) f.removed = r.removed; idbSet('snapshot', state.snap).catch(() => {}); }
    clearTimeout(state.editTimer); state.editTimer = setTimeout(() => refresh(true), 8000);   // totals are recalculated by the server
  }

  root.Offline = {
    init(apiBase) {
      state.api = apiBase;
      state.ready = (async () => { try { const s = await idbGet('snapshot'); if (s && Array.isArray(s.figures)) setSnap(s); } catch (e) { /* no saved copy */ } })();
      state.ready.then(() => { render(); refresh(false); });
      window.addEventListener('online', () => { banner(false); refresh(false); });
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
    },
    async available() { await state.ready; return !!state.snap; },
    get(path) { if (!state.snap) throw fail('No saved copy yet', 503); return engine(state.snap, state.byId, path); },
    savedAt() { return state.snap ? state.snap.generatedAt : null; },
    refresh, afterEdit, banner, cacheImages
  };
})(typeof window !== 'undefined' ? window : globalThis);
