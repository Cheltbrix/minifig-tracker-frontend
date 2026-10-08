// ---- Settings ----
const API = window.API_BASE || 'https://minifig-tracker-backend.onrender.com';
const PREFIX_NAMES = {
  SH: 'Super Heroes', BAT: 'Batman', SPD: 'Spider-Man (original)', DIM: 'Dimensions',
  COLSH: 'Collectible Super Heroes', COLTLB: 'Collectible Batman Movie',
  COLMAR: 'Collectible Marvel S1', COLMAR2: 'Collectible Marvel S2',
  MOF: 'Monster Fighters', COL: 'Toys R Us Marvel'
};
const PREFIXES = Object.keys(PREFIX_NAMES);
const app = document.getElementById('app');

// ---- Helpers ----
const gbp = (n) => n == null ? '–' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v == null ? null : parseFloat(v));
const imgUrl = (f) => f.image_url || `https://img.bricklink.com/ItemImage/MN/0/${f.catalog_id}.png`;
const dateStr = (d) => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never';
const gainHtml = (g) => g == null ? '' : `<span class="${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '▲' : '▼'} ${Math.abs(g).toFixed(1)}%</span>`;
const basisChip = (b) => b === 'asking' ? '<span class="chip warn" title="No sales in the last 6 months, so this is the average asking price">asking</span>' : '';

async function api(path, opts = {}) {
  let waitedNotice = setTimeout(() => {
    const el = document.getElementById('wake');
    if (el) el.hidden = false;
  }, 4000);
  try {
    const res = await fetch(API + path, opts);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const e = new Error(body.error || `Request failed (${res.status})`);
      e.status = res.status;
      throw e;
    }
    return await res.json();
  } finally { clearTimeout(waitedNotice); }
}

function loading() {
  app.innerHTML = `<p class="muted center pad">Loading…<br><span id="wake" hidden class="small">Waking the server up – this can take up to a minute the first time.</span></p>`;
}
function showError(e) {
  app.innerHTML = `<div class="card"><p class="err">Something went wrong: ${esc(e.message)}</p><p class="muted small">The server may still be waking up. Wait a few seconds and <a href="javascript:location.reload()">try again</a>.</p></div>`;
}

// ---- Owned toggle ----
async function setOwned(catalogId, owned) {
  const send = (key) => api(`/api/minifigures/${encodeURIComponent(catalogId)}/owned`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-admin-key': key } : {}) },
    body: JSON.stringify({ owned })
  });
  try {
    return await send(localStorage.getItem('adminKey'));
  } catch (e) {
    if (e.status === 401) {
      const key = prompt('Enter your admin key to change owned figures:');
      if (!key) throw e;
      const r = await send(key);
      localStorage.setItem('adminKey', key);
      return r;
    }
    throw e;
  }
}

// ---- Dashboard ----
async function renderHome() {
  loading();
  const d = await api('/api/dashboard');
  const prefixCards = PREFIXES.map((p) => {
    const s = d.byPrefix[p] || {};
    return `<a class="card pcard" href="#/browse?prefix=${p}&owned=owned">
      <div class="name">${p}</div><div class="sub">${esc(PREFIX_NAMES[p])}</div>
      <div class="val">${gbp(s.totalValue || 0)}</div>
      <div class="sub">${s.ownedCount || 0} owned${s.trackedCount > s.ownedCount ? ` · ${s.trackedCount} tracked` : ''}</div></a>`;
  }).join('');

  const miniList = (rows, kind) => rows.length ? rows.map((f) => `
    <a class="card item" href="#/fig/${f.catalog_id}">
      <div class="thumb"><img loading="lazy" src="${imgUrl(f)}" alt=""></div>
      <div class="body"><div class="title">${esc(f.name)}</div><div class="meta">${esc(f.catalog_id.toUpperCase())}</div></div>
      <div class="price"><div class="p">${gbp(num(f.value_gbp))}</div>
        <div class="meta">${kind === 'gain' ? gainHtml(num(f.gain_pct)) : `${f.bricklink_units_sold_6m} sold · ${f.brickeconomy_active_listings} UK listed`}</div></div>
    </a>`).join('') : '';

  const unpriced = d.ownedCount - d.pricedCount;
  app.innerHTML = `
    <div class="card hero">
      <div class="muted small">Collection value</div>
      <div class="big">${gbp(d.totalValue)}</div>
      <div class="row">
        <span><b>${d.ownedCount}</b> owned figures</span>
        <span><b>${d.trackedCount}</b> tracked</span>
        <span>Prices updated <b>${dateStr(d.lastPriceUpdate)}</b></span>
      </div>
    </div>
    ${unpriced > 0 ? `<div class="notice">Prices are still being collected: ${d.pricedCount} of ${d.ownedCount} owned figures have a price so far. Totals will grow as the daily updates run.</div>` : ''}
    <h2>By range</h2><div class="grid">${prefixCards}</div>
    <h2>Top 5 gainers</h2>
    <div class="list">${miniList(d.topGainers, 'gain') || '<p class="muted small">Gainers appear once a week of price history has been collected.</p>'}</div>
    <h2>Top 5 most traded (6 months)</h2>
    <div class="list">${miniList(d.topTraded, 'traded') || '<p class="muted small">No sales data yet.</p>'}</div>
    <p class="muted small" style="margin-top:20px">Values use BrickLink average sold price (new, GBP). Where a figure hasn't sold in 6 months, the average asking price is used and marked <span class="chip warn">asking</span>. Figures marked not owned are excluded from totals.</p>`;
}

// ---- Browse ----
const DEFAULTS = { q: '', prefix: '', universe: '', year: '', owned: 'all', sort: 'number', page: '1' };
let yearsCache = null;

async function renderBrowse(query) {
  const f = { ...DEFAULTS, ...Object.fromEntries(new URLSearchParams(query)) };
  loading();
  yearsCache = yearsCache || await api('/api/years').catch(() => []);
  const qs = new URLSearchParams({
    page: f.page, limit: 24, sortBy: f.sort, owned: f.owned,
    ...(f.q && { search: f.q }), ...(f.prefix && { prefix: f.prefix }),
    ...(f.universe && { universe: f.universe }), ...(f.year && { year: f.year })
  });
  const r = await api('/api/minifigures?' + qs);
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;

  app.innerHTML = `
    <h1>Browse</h1>
    <form class="filters" id="filters" onsubmit="return false">
      <input class="full" id="f-q" type="search" placeholder="Search name or number (e.g. sh0042, Batman)" value="${esc(f.q)}">
      <select id="f-prefix"><option value="">All ranges</option>${PREFIXES.map((p) => opt(p, `${p} – ${PREFIX_NAMES[p]}`, f.prefix)).join('')}</select>
      <select id="f-universe">${opt('', 'All universes', f.universe)}${opt('Marvel', 'Marvel', f.universe)}${opt('DC', 'DC', f.universe)}${opt('Other', 'Other', f.universe)}</select>
      <select id="f-year"><option value="">Any year</option>${yearsCache.map((y) => opt(y, y, f.year)).join('')}</select>
      <select id="f-owned">${opt('all', 'All figures', f.owned)}${opt('owned', 'Owned only', f.owned)}${opt('not-owned', 'Not owned', f.owned)}</select>
      <select id="f-sort" class="full">
        ${opt('number', 'Sort: number', f.sort)}${opt('price-high', 'Price: high to low', f.sort)}${opt('price-low', 'Price: low to high', f.sort)}
        ${opt('gain', '% gain', f.sort)}${opt('traded', 'Most sold (6m)', f.sort)}${opt('year-desc', 'Year: newest', f.sort)}${opt('year-asc', 'Year: oldest', f.sort)}${opt('name', 'Name A–Z', f.sort)}
      </select>
    </form>
    <p class="muted small">${r.pagination.total} figure${r.pagination.total === 1 ? '' : 's'}</p>
    <div class="list">${r.data.map(itemHtml).join('') || '<p class="muted center pad">Nothing matches those filters.</p>'}</div>
    <div class="pager">
      <button id="prev" ${r.pagination.page <= 1 ? 'disabled' : ''}>← Prev</button>
      <span class="muted small">Page ${r.pagination.page} of ${Math.max(r.pagination.pages, 1)}</span>
      <button id="next" ${r.pagination.page >= r.pagination.pages ? 'disabled' : ''}>Next →</button>
    </div>`;

  const go = (patch) => {
    const n = { ...f, ...patch };
    const p = new URLSearchParams();
    for (const k of Object.keys(DEFAULTS)) if (n[k] !== DEFAULTS[k] && n[k] !== '') p.set(k, n[k]);
    location.hash = '#/browse' + (p.toString() ? '?' + p : '');
  };
  for (const id of ['prefix', 'universe', 'year', 'owned', 'sort']) {
    document.getElementById('f-' + id).onchange = (e) => go({ [id]: e.target.value, page: '1' });
  }
  let t; document.getElementById('f-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => go({ q: e.target.value, page: '1' }), 600); };
  document.getElementById('prev').onclick = () => go({ page: String(r.pagination.page - 1) });
  document.getElementById('next').onclick = () => go({ page: String(r.pagination.page + 1) });
  wireToggles();
}

function itemHtml(f) {
  const v = num(f.value_gbp);
  return `<div class="card item ${f.owned ? '' : 'off'}" data-id="${f.catalog_id}">
    <a class="thumb" href="#/fig/${f.catalog_id}"><img loading="lazy" src="${imgUrl(f)}" alt=""></a>
    <a class="body" href="#/fig/${f.catalog_id}" style="color:inherit">
      <div class="title">${esc(f.name)}</div>
      <div class="meta">${esc(f.catalog_id.toUpperCase())} · ${f.year_released || '–'}${f.owned ? '' : ' · not owned'}</div>
    </a>
    <div class="price"><div class="p">${gbp(v)}</div><div class="meta">${basisChip(f.value_basis)}${gainHtml(num(f.gain_pct)) || (f.bricklink_units_sold_6m != null && !f.value_basis ? '' : (f.value_basis === 'sold' ? f.bricklink_units_sold_6m + ' sold' : ''))}</div></div>
    <button class="switch ${f.owned ? 'on' : ''}" title="Owned" aria-label="Owned" data-toggle="${f.catalog_id}"></button>
  </div>`;
}

function wireToggles() {
  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.preventDefault();
      const id = btn.dataset.toggle;
      const next = !btn.classList.contains('on');
      try {
        await setOwned(id, next);
        btn.classList.toggle('on', next);
        const row = btn.closest('.item');
        if (row) row.classList.toggle('off', !next);
      } catch (err) { alert('Could not update: ' + err.message); }
    };
  });
}

// ---- Figure detail ----
let chart;
async function renderFig(id) {
  loading();
  const d = await api(`/api/minifigures/${encodeURIComponent(id)}?days=1825`);
  const f = d.minifigure;
  const stat = (l, v) => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  app.innerHTML = `
    <a class="back" href="javascript:history.back()">← Back</a>
    <div class="card">
      <div class="detail-head">
        <div class="thumb"><img src="${imgUrl(f)}" alt=""></div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:18px">${esc(f.name)}</div>
          <div class="muted small">${esc(f.catalog_id.toUpperCase())} · ${f.year_released || '–'} · ${esc(f.prefix)}${f.universe ? ' · ' + esc(f.universe) : ''}</div>
          <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
            <button id="own" class="switch ${f.owned ? 'on' : ''}" aria-label="Owned"></button><span id="ownl" class="small">${f.owned ? 'Owned' : 'Not owned'}</span>
          </div>
          <div style="margin-top:6px"><a class="small" target="_blank" rel="noopener" href="https://www.bricklink.com/v2/catalog/catalogitem.page?M=${encodeURIComponent(f.catalog_id)}">View on BrickLink ↗</a></div>
        </div>
      </div>
      <div class="stats">
        ${stat('Value ' + (f.value_basis === 'asking' ? '(asking)' : '(sold avg)'), gbp(num(f.value_gbp)))}
        ${stat('BrickLink sold – new', gbp(num(f.bricklink_avg_sold_new)))}
        ${stat('BrickLink sold – used', gbp(num(f.bricklink_avg_sold_used)))}
        ${stat('BrickEconomy – new', gbp(num(f.brickeconomy_avg_new)))}
        ${stat('BrickEconomy – used', gbp(num(f.brickeconomy_avg_used)))}
        ${stat('Last sold', f.bricklink_last_sold_price ? `${gbp(num(f.bricklink_last_sold_price))}<div class="muted small">${f.bricklink_last_sold_date ? new Date(f.bricklink_last_sold_date).toLocaleDateString('en-GB') : ''}</div>` : '–')}
        ${stat('For sale now – new (avg)', gbp(num(f.bricklink_avg_asking_new)))}
        ${stat('6-month average', gbp(num(f.price_6m_avg)))}
        ${stat('Sold (6 months)', f.bricklink_units_sold_6m ?? '–')}
        ${stat('Active UK listings', f.brickeconomy_active_listings ?? '–')}
      </div>
      <div class="muted small" style="margin-top:8px">Prices updated ${dateStr(f.price_recorded_at)}</div>
    </div>
    <h2>Price history</h2>
    <div class="card"><div class="range"><button data-d="365" class="on">1 year</button><button data-d="1825">5 years</button></div>
      <div class="chartbox"><canvas id="chart"></canvas></div><p id="chartnote" class="muted small"></p></div>
    <h2>Appears in ${d.sets.length} set${d.sets.length === 1 ? '' : 's'}</h2>
    <div class="sets">${d.sets.map((s) => `<div><a target="_blank" rel="noopener" href="https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(s.set_id)}">${esc(s.set_id)}</a> – ${esc(s.set_name)}</div>`).join('') || '<p class="muted small">No set data.</p>'}</div>`;

  document.getElementById('own').onclick = async (e) => {
    const btn = e.currentTarget; const next = !btn.classList.contains('on');
    try { await setOwned(f.catalog_id, next); btn.classList.toggle('on', next); document.getElementById('ownl').textContent = next ? 'Owned' : 'Not owned'; }
    catch (err) { alert('Could not update: ' + err.message); }
  };

  const draw = (days) => {
    const since = Date.now() - days * 864e5;
    const pts = d.priceHistory.filter((p) => new Date(p.recorded_at).getTime() >= since && p.value_gbp != null);
    if (chart) chart.destroy();
    document.getElementById('chartnote').textContent = pts.length < 2
      ? `History builds up as the daily updates run (${pts.length} data point${pts.length === 1 ? '' : 's'} so far).` : '';
    if (!window.Chart) return;
    chart = new Chart(document.getElementById('chart'), {
      type: 'line',
      data: { labels: pts.map((p) => new Date(p.recorded_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })),
        datasets: [{ label: 'Value (£)', data: pts.map((p) => num(p.value_gbp)), borderColor: '#5b9bff', backgroundColor: 'rgba(91,155,255,.15)', fill: true, tension: .25, pointRadius: pts.length < 30 ? 3 : 0 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { ticks: { color: '#8e9bb8', maxTicksLimit: 6 }, grid: { color: '#1b2640' } }, y: { ticks: { color: '#8e9bb8', callback: (v) => '£' + v }, grid: { color: '#1b2640' } } } }
    });
  };
  draw(365);
  document.querySelectorAll('.range button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('.range button').forEach((x) => x.classList.toggle('on', x === b));
    draw(parseInt(b.dataset.d));
  });
}

// ---- Router ----
async function route() {
  const hash = location.hash || '#/';
  const [path, query = ''] = hash.slice(1).split('?');
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active',
    (a.dataset.nav === 'home' && path === '/') || (a.dataset.nav === 'browse' && path.startsWith('/browse'))));
  try {
    if (path.startsWith('/fig/')) await renderFig(path.slice(5));
    else if (path.startsWith('/browse')) await renderBrowse(query);
    else await renderHome();
    window.scrollTo(0, 0);
  } catch (e) { showError(e); }
}
window.addEventListener('hashchange', route);
route();
