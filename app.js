// ---- Settings ----
function opt(v, label, cur) { return `<option value="${String(v).replace(/"/g, '&quot;')}" ${String(cur) === String(v) ? 'selected' : ''}>${String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</option>`; }
const API = window.API_BASE || 'https://minifig-tracker-backend.onrender.com';
const GROUPS = {
  SH: 'Super Heroes', BAT: 'Batman', SPD: 'Spider-Man (original)', DIM: 'Dimensions & friends',
  COLSH: 'Collectible Super Heroes', COLTLB: 'Collectible Batman Movie', COLMAR: 'Collectible Marvel S1',
  COLMAR2: 'Collectible Marvel S2', COLSPI: 'Collectible Spider-Verse', MOF: 'Monster Fighters',
  COL: 'Toys R Us Marvel', EVIL: 'Evil', MICRO: 'Microfigures', STAT: 'Statuettes'
};
const PREFIXES = Object.keys(GROUPS);
const app = document.getElementById('app');

// ---- Helpers ----
const gbp = (n) => n == null ? '–' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v == null ? null : parseFloat(v));
const imgUrl = (f) => f.image_url || `https://img.bricklink.com/ItemImage/MN/0/${f.catalog_id}.png`;
const dateStr = (d) => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';
const gainHtml = (g) => g == null ? '' : `<span class="${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '▲' : '▼'} ${Math.abs(g).toFixed(1)}%</span>`;
const basisChip = (b) => b === 'EU used' ? '<span class="chip eu" title="No UK sale, so this is the European used price">EU used</span>'
  : b === 'used' ? '<span class="chip" title="No UK new sale, so this is the UK used price">used</span>' : b === 'EU' ? '<span class="chip eu" title="No UK sale in 6 months, so this is the European price">EU</span>'
  : b === 'ask' ? '<span class="chip warn" title="No recent sales anywhere, so this is the average asking price">asking</span>' : '';

async function api(path, opts = {}) {
  const t = setTimeout(() => { const el = document.getElementById('wake'); if (el) el.hidden = false; }, 4000);
  try {
    const res = await fetch(API + path, opts);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const e = new Error(body.error || `Request failed (${res.status})`); e.status = res.status; throw e;
    }
    return await res.json();
  } finally { clearTimeout(t); }
}
const loading = () => { app.innerHTML = `<p class="muted center pad">Loading…<br><span id="wake" hidden class="small">Waking the server up – this can take up to a minute the first time.</span></p>`; };
const showError = (e) => { app.innerHTML = `<div class="card"><p class="err">Something went wrong: ${esc(e.message)}</p><p class="muted small">The server may still be waking up. Wait a few seconds and <a href="javascript:location.reload()">try again</a>.</p></div>`; };

// ---- Changing quantity / removing (asks for your admin key if one is set) ----
async function patchItem(id, body) {
  const send = (key) => api(`/api/minifigures/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(key ? { 'x-admin-key': key } : {}) }, body: JSON.stringify(body) });
  try { return await send(localStorage.getItem('adminKey')); }
  catch (e) {
    if (e.status === 401) {
      const key = prompt('Enter your admin key to make changes:');
      if (!key) throw e;
      const r = await send(key); localStorage.setItem('adminKey', key); return r;
    }
    throw e;
  }
}

// ---- Landing page: six portrait cards ----
async function renderHome() {
  loading();
  const [h, d] = await Promise.all([api('/api/highlights'), api('/api/dashboard').catch(() => null)]);
  const tiles = [
    ['Most valuable', h.mostValuable, (f) => gbp(num(f.value_gbp)), 'Prices appear after the first sync'],
    ['Most traded', h.mostTraded, (f) => `${f.units_sold_6m} sold`, 'No sales data yet'],
    ['Biggest gainer', h.topGainer, (f) => gainHtml(num(f.gain_pct)), 'Needs a week of price history'],
    ['Biggest faller', h.topFaller, (f) => gainHtml(num(f.gain_pct)), 'Needs a week of price history'],
    ['Newest release', h.newest, (f) => String(f.year_released), 'No data yet'],
    ['Least traded', h.rarest, (f) => `${f.units_sold_6m} sold · ${gbp(num(f.value_gbp))}`, 'No data yet']
  ];
  app.innerHTML = `
    <h1>Your collection</h1>
    ${d ? `<p class="subtle">${d.ownedQty ?? d.ownedCount} figures across ${PREFIXES.filter((p) => (d.byPrefix[p]?.ownedCount || 0) > 0).length} ranges</p>` : ''}
    <div class="tiles">${tiles.map(([label, f, stat, empty]) => f ? `
      <a class="card tile" href="#/fig/${f.catalog_id}">
        <span class="tag">${label}</span>
        <div class="pic"><img loading="lazy" src="${imgUrl(f)}" alt=""></div>
        <div class="info"><div class="nm">${esc(f.name)}</div><div class="st">${stat(f)}</div></div>
      </a>` : `<div class="card tile empty"><div><b>${label}</b><br>${empty}</div></div>`).join('')}
    </div>`;
}

// ---- Values page ----
const MEASURES = {
  best:     { label: 'Best estimate',             note: 'UK sold prices, new and used pooled together over 6 months. If a figure has no UK sale, the European sold price is used (tagged EU); if it has no sales anywhere, the UK asking price (tagged asking).' },
  soldNew:  { label: 'Sold · new',                note: 'Average UK sold price, new, last 6 months. No UK sale: the European price is used and tagged EU.' },
  soldUsed: { label: 'Sold · used',               note: 'Average UK sold price, used, last 6 months. No UK sale: the European price is used and tagged EU.' },
  askNew:   { label: 'For sale · new',            note: 'Average UK asking price, new. Asking prices usually run higher than what figures actually sell for.' },
  askUsed:  { label: 'For sale · used',           note: 'Average UK asking price, used. Asking prices usually run higher than what figures actually sell for.' },
  soldChain: { label: 'Sold · UK new → used → Europe', note: 'Average sold price over 6 months: UK new; if none, UK used; if none, European new; if none, European used. Tags show which step was used (used, EU, EU used).' },
  askMixed: { label: 'For sale · new → used → Europe', note: 'UK asking price for new; if none, UK used; if none, a European asking price.' }
};
const MEASURE_FIELD = { best: 'value_gbp', soldNew: 'v_sold_new', soldUsed: 'v_sold_used', askNew: 'v_ask_new', askUsed: 'v_ask_used', soldChain: 'v_sold_chain', askMixed: 'v_ask_mixed' };
const curMeasure = () => (MEASURES[localStorage.getItem('measure')] ? localStorage.getItem('measure') : 'best');
// the price to show for an item under a measure, plus its EU / asking tag
function priceFor(f, key) {
  const v = num(f[MEASURE_FIELD[key]]);
  let basis = null;
  if (key === 'best') basis = f.value_basis;
  else if (key === 'soldNew') basis = f.sold_new_basis;
  else if (key === 'soldUsed') basis = f.sold_used_basis;
  else if (key === 'soldChain') basis = f.sold_chain_basis === 'UK' ? null : f.sold_chain_basis;
  else if (key === 'askMixed' && v != null && f.v_ask_new == null && f.v_ask_used == null) basis = 'EU';
  return { v, basis };
}
let dashData = null, showTotal = false;

async function renderValues() {
  loading();
  showTotal = false;                     // the headline figure always starts hidden
  dashData = await api('/api/dashboard');
  drawValues();
}
function drawValues() {
  const d = dashData;
  const sc = document.querySelector('.mchips')?.scrollLeft || 0, y = window.scrollY;   // keep the scroll position when re-drawing
  const key = curMeasure();
  const m = MEASURES[key], raw = d.measures?.[key] || { total: 0, count: 0 };
  const chips = Object.entries(MEASURES).map(([k, v]) => `<button class="mchip ${k === key ? 'on' : ''}" data-measure="${k}">${v.label}</button>`).join('');
  const cards = PREFIXES.map((p) => {
    const s = d.byPrefix[p] || {}; const v = s.values?.[key]?.total ?? 0;
    return `<a class="card pcard" href="#/browse?prefix=${p}&owned=owned"><div class="name">${p}</div><div class="sub">${esc(GROUPS[p])}</div>
      <div class="val">${gbp(v)}</div><div class="sub">${s.ownedQty ?? s.ownedCount ?? 0} owned</div></a>`;
  }).join('');
  const mini = (rows) => rows.map((f) => `
    <a class="card item" href="#/fig/${f.catalog_id}"><div class="thumb"><img loading="lazy" src="${imgUrl(f)}" alt=""></div>
      <div class="body"><div class="title">${esc(f.name)}</div><div class="meta">${esc(f.catalog_id.toUpperCase())}</div></div>
      <div class="price"><div class="p">${gbp(num(f.value_gbp))}</div><div class="meta">${f.bricklink_units_sold_6m ?? f.units_sold_6m ?? 0} sold</div></div></a>`).join('');
  const owned = d.ownedQty ?? d.ownedCount;
  const unpriced = d.ownedCount - d.pricedCount;
  app.innerHTML = `
    <h1>Values</h1>
    <div class="mchips">${chips}</div>
    <div class="hero"><div class="row" style="justify-content:space-between;margin:0"><span class="muted small">${m.label}</span>
        <button class="linkbtn" id="toggle-total" style="color:var(--accent)">${showTotal ? 'Hide value' : 'Show value'}</button></div>
      <div class="big">${showTotal ? gbp(raw.total) : '£ • • • • •'}</div>
      <div class="row"><span>Based on <b>${raw.count}</b> of <b>${d.ownedCount}</b> owned items (${owned} figures)</span>
      <span>Prices updated <b>${dateStr(d.lastPriceUpdate)}</b></span></div>
      <div style="margin-top:10px"><a href="#/measure/${key}">Which figures are included? →</a></div></div>
    ${unpriced > 0 ? `<div class="notice">Prices are still being collected: ${d.pricedCount} of ${d.ownedCount} owned items have one so far.</div>` : ''}
    <h2>By range</h2><div class="grid">${cards}</div>
    <p class="muted small" style="margin-top:14px"><b>${m.label}:</b> ${m.note} Quantities are included. Items you don't own are left out.</p>
    ${d.topTraded?.length ? `<h2>Top 5 most traded (6 months)</h2><div class="list">${mini(d.topTraded)}</div>` : ''}`;
  const chipsEl = document.querySelector('.mchips'); if (chipsEl) chipsEl.scrollLeft = sc;
  window.scrollTo(0, y);
  document.getElementById('toggle-total').onclick = () => { showTotal = !showTotal; drawValues(); };
  document.querySelectorAll('[data-measure]').forEach((b) => b.onclick = () => {
    if (b.dataset.measure === key) { location.hash = '#/measure/' + key; return; }   // tap the selected one again to see what's in it
    localStorage.setItem('measure', b.dataset.measure); drawValues();
  });
}

// ---- Which figures are included in a total ----
async function renderMeasure(key, prefix) {
  if (!MEASURES[key]) key = 'best';
  loading();
  const d = await api(`/api/measure-list?measure=${key}${prefix ? '&prefix=' + encodeURIComponent(prefix) : ''}`);
  const rows = d.data.map((f) => ({ ...f, ...priceFor(f, key) }));
  const inc = rows.filter((r) => r.v != null).sort((a, b) => b.v * b.quantity - a.v * a.quantity);
  const none = rows.filter((r) => r.v == null).sort((a, b) => a.name.localeCompare(b.name));
  const row = (r, why) => `<a class="card item" href="#/fig/${r.catalog_id}"><div class="thumb"><img loading="lazy" src="${imgUrl(r)}" alt=""></div>
    <div class="body"><div class="title">${esc(r.name)}</div><div class="meta">${esc(r.catalog_id.toUpperCase())}${r.quantity > 1 ? ' · ×' + r.quantity : ''}${why ? ' · ' + why : ''}</div></div>
    ${r.v != null ? `<div class="price"><div class="p">${gbp(r.v)}</div><div class="meta">${basisChip(r.basis)}${r.quantity > 1 ? ' ' + gbp(r.v * r.quantity) : ''}</div></div>` : ''}</a>`;
  app.innerHTML = `
    <a class="back" href="#/values">← Values</a>
    <h1>${MEASURES[key].label}</h1>
    <select id="m-prefix"><option value="">All ranges</option>${PREFIXES.map((p) => opt(p, `${p} – ${GROUPS[p]}`, prefix)).join('')}</select>
    <p class="subtle" style="margin-top:10px"><b>${inc.length}</b> included · <b>${none.length}</b> without a price (${rows.length} owned)</p>
    <details class="reveal"><summary><span>Included (${inc.length})</span><span class="arrow">▶</span></summary>
      <div class="inner"><div class="list">${inc.map((r) => row(r)).join('') || '<p class="muted small">None yet.</p>'}</div></div></details>
    <details class="reveal"><summary><span>No price (${none.length})</span><span class="arrow">▶</span></summary>
      <div class="inner"><div class="list">${none.map((r) => row(r, r.price_recorded_at ? 'no price for this measure' : 'not priced yet')).join('') || '<p class="muted small">Every owned item has a price.</p>'}</div></div></details>
    <p class="muted small">${MEASURES[key].note}</p>`;
  document.getElementById('m-prefix').onchange = (e) => { location.hash = `#/measure/${key}${e.target.value ? '?prefix=' + e.target.value : ''}`; };
}

// ---- Browse (endless scroll) ----
const DEFAULTS = { q: '', prefix: '', universe: '', year: '', owned: 'all', nosale: '', sort: 'price-high' };
let yearsCache = null, scrollObserver = null, browseGen = 0;
const val = (id) => document.getElementById(id).value;

function readFilters() {
  return { q: val('f-q').trim(), prefix: val('f-prefix'), universe: val('f-universe'), year: val('f-year'),
           owned: val('f-owned'), sort: val('f-sort'), nosale: document.getElementById('f-nosale').checked ? '1' : '' };
}
function goFilters(n) {
  const p = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS)) if (n[k] !== DEFAULTS[k] && n[k] !== '') p.set(k, n[k]);
  location.hash = '#/browse' + (p.toString() ? '?' + p : '');
}

function browseShell(f) {
  app.innerHTML = `
    <h1>Browse</h1>
    <form class="filters" id="filters" onsubmit="return false">
      <input class="full" id="f-q" type="search" placeholder="Search name or number (e.g. sh0042, Batman)" value="${esc(f.q)}" autocomplete="off">
      <select id="f-prefix"><option value="">All ranges</option>${PREFIXES.map((p) => opt(p, `${p} – ${GROUPS[p]}`, f.prefix)).join('')}</select>
      <select id="f-universe">${opt('', 'All universes', f.universe)}${opt('Marvel', 'Marvel', f.universe)}${opt('DC', 'DC', f.universe)}${opt('Other', 'Other', f.universe)}</select>
      <select id="f-year"><option value="">Any year</option>${yearsCache.map((y) => opt(y, y, f.year)).join('')}</select>
      <select id="f-owned">${opt('all', 'All figures', f.owned)}${opt('owned', 'Owned only', f.owned)}${opt('not-owned', 'Not owned', f.owned)}${opt('removed', 'Removed', f.owned)}</select>
      <select id="f-sort" class="full">
        ${opt('number', 'Sort: number', f.sort)}${opt('price-high', 'Price: high to low', f.sort)}${opt('price-low', 'Price: low to high', f.sort)}
        ${opt('gain', '% gain', f.sort)}${opt('traded', 'Most sold (6m)', f.sort)}${opt('year-desc', 'Year: newest', f.sort)}${opt('year-asc', 'Year: oldest', f.sort)}${opt('name', 'Name A–Z', f.sort)}
      </select>
      <select id="f-measure" class="full">${Object.entries(MEASURES).map(([k, v]) => opt(k, 'Prices shown: ' + v.label, curMeasure())).join('')}</select>
      <label class="check full"><input type="checkbox" id="f-nosale" ${f.nosale === '1' ? 'checked' : ''}> No UK sale in the last 6 months</label>
    </form>
    <p class="muted small" id="count"></p><div class="list" id="results"></div><div class="sentinel" id="sentinel"></div>`;
  for (const id of ['prefix', 'universe', 'year', 'owned', 'sort', 'nosale']) document.getElementById('f-' + id).onchange = () => goFilters(readFilters());
  document.getElementById('f-measure').onchange = (e) => { localStorage.setItem('measure', e.target.value); renderBrowse(location.hash.split('?')[1] || ''); };
  let t; document.getElementById('f-q').oninput = () => { clearTimeout(t); t = setTimeout(() => goFilters(readFilters()), 700); };
}

async function renderBrowse(query) {
  const f = { ...DEFAULTS, ...Object.fromEntries(new URLSearchParams(query)) };
  const gen = ++browseGen;
  if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }

  if (!document.getElementById('filters')) {
    loading();
    yearsCache = yearsCache || await api('/api/years').catch(() => []);
    if (gen !== browseGen) return;
    browseShell(f);
  } else {
    for (const id of ['prefix', 'universe', 'year', 'owned', 'sort']) document.getElementById('f-' + id).value = f[id];
    document.getElementById('f-nosale').checked = f.nosale === '1';
    document.getElementById('f-measure').value = curMeasure();
    const q = document.getElementById('f-q'); if (document.activeElement !== q) q.value = f.q;
  }
  const results = document.getElementById('results'), sentinel = document.getElementById('sentinel'), count = document.getElementById('count');
  results.innerHTML = ''; sentinel.textContent = 'Loading…';
  let page = 0, done = false, busy = false;

  const loadMore = async () => {
    if (busy || done || gen !== browseGen) return;
    busy = true;
    try {
      const qs = new URLSearchParams({ page: page + 1, limit: 30, sortBy: f.sort, measure: curMeasure(),
        owned: f.owned === 'removed' ? 'all' : f.owned, ...(f.owned === 'removed' && { removed: 'only' }),
        ...(f.q && { search: f.q }), ...(f.prefix && { prefix: f.prefix }), ...(f.universe && { universe: f.universe }),
        ...(f.year && { year: f.year }), ...(f.nosale && { nosale: '1' }) });
      const r = await api('/api/minifigures?' + qs);
      if (gen !== browseGen) return;
      page++;
      count.textContent = `${r.pagination.total} item${r.pagination.total === 1 ? '' : 's'}`;
      results.insertAdjacentHTML('beforeend', r.data.map(itemHtml).join(''));
      wireQty(results);
      done = page >= r.pagination.pages;
      sentinel.textContent = done ? (r.pagination.total ? '' : 'Nothing matches those filters.') : '';
    } catch (e) { sentinel.textContent = 'Could not load: ' + e.message; done = true; }
    busy = false;
  };
  await loadMore();
  scrollObserver = new IntersectionObserver((es) => { if (es[0].isIntersecting) loadMore(); }, { rootMargin: '600px' });
  scrollObserver.observe(sentinel);
}

function qtyHtml(f, big) {
  return `<div class="qty ${big ? 'big' : ''}" data-qty="${f.catalog_id}"><button data-d="-1" aria-label="Fewer">−</button><span class="n">${f.quantity}</span><button data-d="1" aria-label="More">+</button></div>`;
}
function itemHtml(f) {
  const { v, basis } = priceFor(f, curMeasure());
  return `<div class="card item ${f.quantity > 0 ? '' : 'off'}" data-id="${f.catalog_id}">
    <a class="thumb" href="#/fig/${f.catalog_id}"><img loading="lazy" src="${imgUrl(f)}" alt=""></a>
    <a class="body" href="#/fig/${f.catalog_id}"><div class="title">${esc(f.name)}</div>
      <div class="meta">${esc(f.catalog_id.toUpperCase())} · ${f.year_released || '–'}${f.quantity > 0 ? '' : ' · not owned'}${f.removed ? ' · removed' : ''}</div></a>
    <div class="price"><div class="p">${gbp(v)}</div><div class="meta">${basisChip(basis)} ${gainHtml(num(f.gain_pct))}</div></div>
    ${f.removed ? '' : qtyHtml(f)}
  </div>`;
}
function wireQty(root) {
  root.querySelectorAll('[data-qty]').forEach((box) => {
    if (box.dataset.wired) return; box.dataset.wired = '1';
    box.querySelectorAll('button').forEach((btn) => btn.onclick = async (e) => {
      e.preventDefault();
      const n = box.querySelector('.n'); const next = Math.max(0, Math.min(99, parseInt(n.textContent) + parseInt(btn.dataset.d)));
      try {
        await patchItem(box.dataset.qty, { quantity: next }); n.textContent = next;
        const row = box.closest('.item'); if (row) row.classList.toggle('off', next === 0);
      } catch (err) { alert('Could not update: ' + err.message); }
    });
  });
}

// ---- Figure page ----
let chart;
async function renderFig(id) {
  loading();
  const d = await api(`/api/minifigures/${encodeURIComponent(id)}?days=1825`);
  const f = d.minifigure;
  const stat = (l, v, cls = '') => `<div class="stat ${cls}"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  const ratio = (f.units_sold_6m || 0) / Math.max(f.uk_listings_count || 0, 1);
  const ease = f.price_recorded_at == null ? '–' : `${ratio >= 2 ? 'Fast' : ratio >= 0.5 ? 'Steady' : 'Slow'}<div class="muted small">${ratio.toFixed(1)} sales per listing</div>`;
  const link = f.item_type === 'PART' ? `P=${f.bl_number}` : f.item_type === 'GEAR' ? `G=${f.bl_number}` : `M=${f.bl_number}`;
  app.innerHTML = `
    <a class="back" href="javascript:history.back()">← Back</a>
    <div class="card">
      <div class="detail-head">
        <div class="thumb"><img src="${imgUrl(f)}" alt=""></div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:18px">${esc(f.name)}</div>
          <div class="muted small">${esc(f.catalog_id.toUpperCase())} · ${f.year_released || '–'} · ${esc(f.prefix)}${f.universe ? ' · ' + esc(f.universe) : ''}</div>
          <div style="margin-top:8px;display:flex;align-items:center;gap:10px">${f.removed ? '<span class="chip warn">removed</span>' : qtyHtml(f, true)}<span class="small muted">${f.removed ? '' : 'owned'}</span></div>
          <div style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap">
            <a class="small" target="_blank" rel="noopener" href="https://www.bricklink.com/v2/catalog/catalogitem.page?${link}">View on BrickLink ↗</a>
            <button class="linkbtn" id="rm">${f.removed ? 'Restore' : 'Remove from app'}</button></div>
        </div>
      </div>
      <div class="stats">
        ${stat('Value (best estimate) ' + basisChip(f.value_basis), gbp(num(f.value_gbp)))}
        ${stat('BrickLink sold – new ' + basisChip(f.sold_new_basis), gbp(num(f.v_sold_new)))}
        ${stat('BrickLink sold – used ' + basisChip(f.sold_used_basis), gbp(num(f.v_sold_used)))}
        ${stat('BrickEconomy – new', '–', 'dim')}
        ${stat('BrickEconomy – used', '–', 'dim')}
        ${stat('Last sold (UK)', f.bricklink_last_sold_price ? `${gbp(num(f.bricklink_last_sold_price))}<div class="muted small">${f.bricklink_last_sold_date ? new Date(f.bricklink_last_sold_date).toLocaleDateString('en-GB') : ''}</div>` : '–')}
        ${stat('Sold in 6 months (UK)', f.units_sold_6m ?? '–')}
        ${stat('Active UK listings', f.uk_listings_count ?? '–')}
        ${stat('For sale now – new (UK avg)', gbp(num(f.bricklink_avg_asking_new)))}
        ${stat('For sale now – used (UK avg)', gbp(num(f.bricklink_avg_asking_used)))}
        ${stat('Cheapest UK listing', gbp(num(f.uk_cheapest_listing)))}
        ${stat('Ease of selling', ease)}
      </div>
      <div class="muted small" style="margin-top:8px">Prices updated ${dateStr(f.price_recorded_at)}${f.quantity > 1 ? ` · you own ${f.quantity}` : ''}</div>
    </div>
    <h2>Price history</h2>
    <div class="card"><div class="range"><button data-d="365" class="on">1 year</button><button data-d="1825">5 years</button></div>
      <div class="chartbox"><canvas id="chart"></canvas></div><p id="chartnote" class="muted small"></p></div>
    ${d.sets.length ? `<h2>Appears in ${d.sets.length} set${d.sets.length === 1 ? '' : 's'}</h2>
    <div class="sets">${d.sets.map((s) => `<div><a target="_blank" rel="noopener" href="https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(s.set_id)}">${esc(s.set_id)}</a> – ${esc(s.set_name)}</div>`).join('')}</div>` : ''}`;

  wireQty(app);
  document.getElementById('rm').onclick = async () => {
    if (!f.removed && !confirm('Remove this from the app? You can restore it later from Browse → Removed.')) return;
    try { await patchItem(f.catalog_id, { removed: !f.removed }); renderFig(id); } catch (err) { alert('Could not update: ' + err.message); }
  };
  const draw = (days) => {
    const since = Date.now() - days * 864e5;
    const pts = d.priceHistory.filter((p) => new Date(p.recorded_at).getTime() >= since && p.value_gbp != null);
    if (chart) chart.destroy();
    document.getElementById('chartnote').textContent = pts.length < 2 ? `History builds up as the daily updates run (${pts.length} data point${pts.length === 1 ? '' : 's'} so far).` : '';
    if (!window.Chart) return;
    chart = new Chart(document.getElementById('chart'), { type: 'line',
      data: { labels: pts.map((p) => new Date(p.recorded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })),
        datasets: [{ data: pts.map((p) => num(p.value_gbp)), borderColor: '#5b9bff', backgroundColor: 'rgba(91,155,255,.15)', fill: true, tension: .25, pointRadius: pts.length < 30 ? 3 : 0 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: '#8e9bb8', maxTicksLimit: 6 }, grid: { color: '#1b2640' } }, y: { ticks: { color: '#8e9bb8', callback: (v) => '£' + v }, grid: { color: '#1b2640' } } } } });
  };
  draw(365);
  document.querySelectorAll('.range button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.range button').forEach((x) => x.classList.toggle('on', x === b)); draw(parseInt(b.dataset.d));
  });
}

// ---- Router ----
async function route() {
  const hash = location.hash || '#/';
  const [path, query = ''] = hash.slice(1).split('?');
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active',
    (a.dataset.nav === 'home' && path === '/') || (a.dataset.nav === 'values' && (path === '/values' || path.startsWith('/measure/'))) || (a.dataset.nav === 'browse' && path.startsWith('/browse'))));
  if (!path.startsWith('/browse') && scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; browseGen++; }
  try {
    if (path.startsWith('/fig/')) await renderFig(path.slice(5));
    else if (path.startsWith('/browse')) await renderBrowse(query);
    else if (path === '/values') await renderValues();
    else if (path.startsWith('/measure/')) await renderMeasure(path.slice(9), new URLSearchParams(query).get('prefix') || '');
    else await renderHome();
    if (!path.startsWith('/browse')) window.scrollTo(0, 0);
  } catch (e) { showError(e); }
}
window.addEventListener('hashchange', route);
route();
