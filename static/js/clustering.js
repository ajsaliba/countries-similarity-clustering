/**
 * clustering.js  —  Clustering Wizard state machine
 * Steps: 0=Basis, 1=Dataset, 2=Algorithm, 3=Parameters, 4=Run, 5=Results
 */

/* ─────────────────────────────────────────────────────────────────
   State
───────────────────────────────────────────────────────────────── */
const CL = {
  step: 0,
  basis: null,       // 'structural' | 'semantic'
  selected: [],      // array of country names
  algo: null,        // 'agglomerative' | 'dbscan' | 'spectral' | 'kmedoids'
  params: {},
  allCountries: [],
  coordLookup: {},   // {name: [lat, lng]} for the step-1 map markers
  map: null,
  markers: [],       // Leaflet marker layer for selected countries on the step-1 map
  result: null,
  resultMap: null,
  jobId: null,
  pollTimer: null,
};

const CL_STEP_TITLES = [
  'Select Basis',
  'Select Dataset',
  'Choose Algorithm',
  'Set Parameters',
  'Run Clustering',
  'Results',
];

/* Cluster colour palette */
const CL_PALETTE = [
  'oklch(0.78 0.18 200)',  // teal
  'oklch(0.7 0.25 320)',   // purple
  'oklch(0.75 0.22 130)',  // green
  'oklch(0.8 0.2 60)',     // amber
  'oklch(0.7 0.22 20)',    // red-orange
  'oklch(0.8 0.18 260)',   // blue
  'oklch(0.75 0.2 180)',   // cyan
  'oklch(0.8 0.25 340)',   // pink
  'oklch(0.72 0.18 100)',  // yellow-green
  'oklch(0.75 0.15 230)',  // sky
];

/* ─────────────────────────────────────────────────────────────────
   Bootstrap
───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  clLoadCountries();
  clUpdateParamVisibility();

  if (clMaybeRestorePending()) return;
  clGoTo(0);
});

/* If saved.html / results.html stashed a clustering result under
   sessionStorage["similica_pending_view"], jump straight to step 5 with
   it rendered. */
function clMaybeRestorePending() {
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem('similica_pending_view') || 'null'); }
  catch (e) { pending = null; }
  if (!pending || pending.type !== 'clustering' || !pending.data) return false;

  sessionStorage.removeItem('similica_pending_view');
  const data = pending.data;

  CL.basis    = data.basis     || 'semantic';
  CL.algo     = data.algorithm || 'agglomerative';
  CL.selected = Array.isArray(data.names) ? data.names.slice()
              : (data.assignments ? Object.keys(data.assignments) : []);
  CL.result   = data;

  clGoTo(5);
  clRenderResults(data);
  showToast('Restored saved result', 'success');
  return true;
}

/* ─────────────────────────────────────────────────────────────────
   Navigation
───────────────────────────────────────────────────────────────── */
function clNext() {
  if (!clValidateStep(CL.step)) return;
  clGoTo(CL.step + 1);
}

function clBack() {
  if (CL.step > 0) clGoTo(CL.step - 1);
}

function clGoTo(n) {
  document.querySelectorAll('.cl-step-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.cl-step-item').forEach(item => {
    item.classList.remove('active');
    const s = parseInt(item.dataset.step);
    if (s < n) item.classList.add('done'); else item.classList.remove('done');
  });

  const panel = document.querySelector(`.cl-step-panel[data-step="${n}"]`);
  if (panel) panel.classList.add('active');
  const stepItem = document.querySelector(`.cl-step-item[data-step="${n}"]`);
  if (stepItem) stepItem.classList.add('active');

  CL.step = n;

  // Topbar
  const titleEl = document.getElementById('cl-step-title');
  const curEl   = document.getElementById('cl-step-cur');
  if (titleEl) titleEl.textContent = CL_STEP_TITLES[n] || '';
  if (curEl)   curEl.textContent   = n + 1;

  // Footer
  const backBtn = document.getElementById('cl-btn-back');
  const nextBtn = document.getElementById('cl-btn-next');
  if (backBtn) backBtn.style.display = n > 0 ? '' : 'none';
  if (nextBtn) {
    nextBtn.style.display = (n === 4 || n === 5) ? 'none' : '';
  }

  // Sidebar summary
  const sumEl = document.getElementById('cl-sidebar-summary');
  if (sumEl) sumEl.style.display = n > 0 ? '' : 'none';
  if (n >= 1) clUpdateSidebarSummary();

  // Step-specific
  if (n === 0) clSelectBasis('structural'); // single option — auto-select on entry
  if (n === 1) clInitMap();
  if (n === 3) { clUpdateParamVisibility(); clUpdateLinkageInfo(); }
  if (n === 4) clRenderRunSummary();
}

function clValidateStep(n) {
  if (n === 1 && CL.selected.length < 3) {
    const warn = document.getElementById('cl-min-warn');
    if (warn) warn.style.display = '';
    showToast('Select at least 3 countries', 'error');
    return false;
  }
  if (n === 2 && !CL.algo)   { showToast('Please select an algorithm', 'error'); return false; }
  return true;
}

/* ─────────────────────────────────────────────────────────────────
   Step 0: Basis (structural only)
───────────────────────────────────────────────────────────────── */
function clSelectBasis(_basis) {
  // Only one option supported; ignore the arg and force structural.
  CL.basis = 'structural';
  document.querySelectorAll('[data-basis]').forEach(el => {
    el.classList.toggle('selected', el.dataset.basis === 'structural');
  });
}

/* ─────────────────────────────────────────────────────────────────
   Step 1: Dataset
───────────────────────────────────────────────────────────────── */
async function clLoadCountries() {
  try {
    const res  = await fetch('/api/countries');
    const data = await res.json();
    const raw  = data.countries || [];

    CL.allCountries = raw.map(c => (typeof c === 'string' ? c : c.name));
    CL.coordLookup  = {};
    raw.forEach(c => {
      if (typeof c === 'object' && c.lat != null && c.lng != null) {
        CL.coordLookup[c.name] = [c.lat, c.lng];
      }
    });
    clRenderCountryList(CL.allCountries);
  } catch(e) {
    console.error('Failed to load countries', e);
  }
}

function clRenderCountryList(countries) {
  const container = document.getElementById('cl-country-scroll');
  if (!container) return;
  container.innerHTML = countries.map(name => {
    const sel = CL.selected.includes(name);
    return `<div class="cl-country-item${sel ? ' selected' : ''}" onclick="clToggleCountry('${name.replace(/'/g,"\\'")}')">
      <input type="checkbox" ${sel ? 'checked' : ''} readonly/>
      <span style="flex:1;">${escClHtml(name)}</span>
    </div>`;
  }).join('');
}

function clFilterCountries() {
  const q = (document.getElementById('cl-country-search')?.value || '').toLowerCase();
  const filtered = CL.allCountries.filter(n => n.toLowerCase().includes(q));
  clRenderCountryList(filtered);
}

function clToggleCountry(name) {
  const idx = CL.selected.indexOf(name);
  if (idx >= 0) CL.selected.splice(idx, 1);
  else CL.selected.push(name);
  clFilterCountries();
  clRenderSelectedTags();
  clUpdateKMax();
  clUpdateMapHighlights();
  const warn = document.getElementById('cl-min-warn');
  if (warn) warn.style.display = CL.selected.length < 3 && CL.selected.length > 0 ? '' : 'none';
}

function clSelectAll() {
  CL.selected = [...CL.allCountries];
  clRenderCountryList(CL.allCountries);
  clRenderSelectedTags();
  clUpdateKMax();
  clUpdateMapHighlights();
}

function clClearAll() {
  CL.selected = [];
  clRenderCountryList(CL.allCountries);
  clRenderSelectedTags();
  clUpdateKMax();
  clUpdateMapHighlights();
}

function clRenderSelectedTags() {
  const container = document.getElementById('cl-selected-tags');
  const countEl   = document.getElementById('cl-sel-count');
  if (!container) return;
  if (countEl) countEl.textContent = CL.selected.length;

  // Only show first 20 tags + overflow
  const show = CL.selected.slice(0, 20);
  const more = CL.selected.length - show.length;
  container.innerHTML =
    show.map(name => `
      <div class="cl-tag">
        ${escClHtml(name)}
        <button onclick="clToggleCountry('${name.replace(/'/g,"\\'")}')">✕</button>
      </div>
    `).join('') +
    (more > 0 ? `<div class="cl-tag" style="background:var(--muted);border-color:var(--border);color:var(--muted-foreground);">+${more} more</div>` : '');
}

function clInitMap() {
  if (CL.map) {
    setTimeout(() => CL.map.invalidateSize(), 60);
    clUpdateMapHighlights();
    return;
  }
  CL.map = L.map('cl-map', { zoomControl: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 19,
  }).addTo(CL.map);
  setTimeout(() => CL.map.invalidateSize(), 60);
  clUpdateMapHighlights();
}

/* Drop existing markers, then add a marker for every selected country with
   known coords. For large selections (>30) tooltips are turned off so the
   map stays readable; you still get a popup on click. */
function clUpdateMapHighlights() {
  if (!CL.map) return;

  (CL.markers || []).forEach(m => CL.map.removeLayer(m));
  CL.markers = [];

  const pts  = [];
  const many = CL.selected.length > 30;

  CL.selected.forEach(name => {
    const coord = CL.coordLookup[name];
    if (!coord) return;
    const [lat, lng] = coord;
    pts.push([lat, lng]);

    const marker = L.circleMarker([lat, lng], {
      radius: many ? 5 : 7,
      color: '#fff', weight: 1.2,
      fillColor: '#22d3ee', fillOpacity: 0.85,
    }).addTo(CL.map);

    if (!many) {
      marker.bindTooltip(name, {
        permanent: true, direction: 'top', offset: [0, -8],
        className: 'cl-map-tooltip',
      });
    }
    marker.bindPopup(`<strong>${name}</strong>`);
    marker.on('click', () => clToggleCountry(name));

    CL.markers.push(marker);
  });

  if (pts.length >= 2) {
    CL.map.fitBounds(L.latLngBounds(pts).pad(0.4));
  } else if (pts.length === 1) {
    CL.map.setView(pts[0], 4);
  }
}

/* ─────────────────────────────────────────────────────────────────
   Step 2: Algorithm
───────────────────────────────────────────────────────────────── */
function clSelectAlgo(algo) {
  CL.algo = algo;
  document.querySelectorAll('[data-algo]').forEach(el => {
    el.classList.toggle('selected', el.dataset.algo === algo);
  });
  clUpdateParamVisibility();
}

/* ─────────────────────────────────────────────────────────────────
   Step 3: Parameters
───────────────────────────────────────────────────────────────── */
/* Short description for each linkage method — refreshed when the user
   changes the dropdown or enters the Parameters step. Grounded in Tekli
   Ch. 10 §5.2 (Inter-Cluster Similarity). */
const LINKAGE_DESCRIPTIONS = {
  average:
    "<strong>Average linkage (UPGMA)</strong> — cluster distance = average " +
    "of all pair distances between the two clusters. " +
    "Most robust against noise; the default for non-Euclidean data like TED.",
  single:
    "<strong>Single linkage (nearest)</strong> — cluster distance = " +
    "<em>minimum</em> pair distance. Can chain through outliers, producing " +
    "long, skinny clusters. Good at recovering non-globular shapes.",
  complete:
    "<strong>Complete linkage (farthest)</strong> — cluster distance = " +
    "<em>maximum</em> pair distance. Produces tight, compact clusters but " +
    "tends to break large ones; sensitive to outliers.",
  ward:
    "<strong>⚠ Ward linkage — disabled for this corpus.</strong> Ward " +
    "minimises within-cluster variance, which is only defined in Euclidean " +
    "geometry. Our TED distance is not Euclidean (it violates the parallelogram " +
    "law), so cluster.py blocks Ward to avoid silently meaningless merges. " +
    "Pick <em>Average</em>, <em>Single</em>, or <em>Complete</em> instead.",
};

function clUpdateLinkageInfo() {
  const sel = document.getElementById('param-linkage');
  const box = document.getElementById('param-linkage-info');
  if (!sel || !box) return;
  box.innerHTML = LINKAGE_DESCRIPTIONS[sel.value] || '';
}

function clUpdateParamVisibility() {
  const algo = CL.algo;
  const hide = (id, gone) => {
    const el = document.getElementById(id);
    if (el) el.style.display = gone ? 'none' : '';
  };

  // k — only spectral and kmedoids care. Agglomerative uses a distance
  // threshold; dbscan uses eps/min_samples; so k is completely hidden for both.
  const needsK = ['spectral', 'kmedoids'].includes(algo);
  hide('param-k-row', !needsK);

  // Distance threshold — agglomerative only.
  hide('param-thresh-row', algo !== 'agglomerative');

  // Linkage — agglomerative only.
  hide('param-linkage-row', algo !== 'agglomerative');

  // eps + min_samples — DBSCAN only.
  hide('param-eps-row',    algo !== 'dbscan');
  hide('param-minpts-row', algo !== 'dbscan');
}

function clUpdateKMax() {
  const input = document.getElementById('param-k');
  if (!input) return;
  const max = Math.max(2, CL.selected.length - 1);
  input.max = Math.min(max, 20);
  const cur = parseInt(input.value);
  if (cur > parseInt(input.max)) {
    input.value = input.max;
    const valEl = document.getElementById('param-k-val');
    if (valEl) valEl.textContent = input.max;
  }
}

function clGetParams() {
  const k        = parseInt(document.getElementById('param-k')?.value       || 5);
  const linkage  = document.getElementById('param-linkage')?.value          || 'average';
  const eps      = parseFloat(document.getElementById('param-eps')?.value   || 0.3);
  const minpts   = parseInt(document.getElementById('param-minpts')?.value  || 2);
  const thresh   = parseFloat(document.getElementById('param-thresh')?.value || 0.5);
  return {
    k, linkage, eps,
    min_samples:        minpts,
    distance_threshold: thresh,
  };
}

/* ─────────────────────────────────────────────────────────────────
   Step 4: Run
───────────────────────────────────────────────────────────────── */
function clRenderRunSummary() {
  const p = clGetParams();
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  set('run-basis', CL.basis || '—');
  set('run-algo',  CL.algo  || '—');
  set('run-n',     CL.selected.length);

  // Params summary
  let paramStr = '';
  if (CL.algo === 'agglomerative') {
    paramStr = `threshold=${p.distance_threshold.toFixed(2)}, linkage=${p.linkage}`;
  } else if (CL.algo === 'dbscan') {
    paramStr = `ε=${p.eps.toFixed(2)}, min_samples=${p.min_samples}`;
  } else if (['spectral', 'kmedoids'].includes(CL.algo)) {
    paramStr = `k=${p.k}`;
  }
  set('run-params', paramStr || '—');

  // Large dataset warning
  const n = CL.selected.length;
  const largWarn = document.getElementById('cl-large-warn');
  const largeN   = document.getElementById('cl-large-n');
  const largePairs = document.getElementById('cl-large-pairs');
  if (largWarn) {
    const isLarge = CL.basis === 'structural' && n > 20;
    largWarn.style.display = isLarge ? '' : 'none';
    if (largeN)    largeN.textContent    = n;
    if (largePairs) largePairs.textContent = `${Math.round(n*(n-1)/2)}`;
  }
}

async function clRunClustering() {
  const btn = document.getElementById('cl-run-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Running…'; }

  const progressWrap = document.getElementById('cl-progress-wrap');
  if (progressWrap) progressWrap.style.display = '';
  clSetProgress(5, 'Submitting job…');

  const params = clGetParams();
  const payload = {
    basis:     CL.basis,
    algorithm: CL.algo,
    countries: CL.selected,
    params,
  };

  try {
    const res  = await fetch('/api/clustering', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.job_id) {
      // Async job — poll
      CL.jobId = data.job_id;
      clSetProgress(15, 'Computing similarity matrix…');
      clPollJob(data.job_id, btn);
    } else if (data.error) {
      throw new Error(data.error);
    } else {
      // Synchronous result
      clSetProgress(95, 'Rendering…');
      CL.result = data;
      clSaveToHistory(data);
      setTimeout(() => {
        if (progressWrap) progressWrap.style.display = 'none';
        clGoTo(5);
        clRenderResults(data);
        if (btn) { btn.disabled = false; btn.textContent = '◎ Run Clustering'; }
      }, 400);
    }
  } catch(e) {
    if (progressWrap) progressWrap.style.display = 'none';
    showToast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '◎ Run Clustering'; }
  }
}

function clPollJob(jobId, btn) {
  if (CL.pollTimer) clearInterval(CL.pollTimer);
  let ticks = 0;
  CL.pollTimer = setInterval(async () => {
    ticks++;
    try {
      const res  = await fetch(`/api/job/${jobId}`);
      const data = await res.json();

      if (data.status === 'done') {
        clearInterval(CL.pollTimer);
        clSetProgress(95, 'Rendering…');
        CL.result = data.result;
        clSaveToHistory(data.result);
        const progressWrap = document.getElementById('cl-progress-wrap');
        setTimeout(() => {
          if (progressWrap) progressWrap.style.display = 'none';
          clGoTo(5);
          clRenderResults(data.result);
          if (btn) { btn.disabled = false; btn.textContent = '◎ Run Clustering'; }
        }, 400);
      } else if (data.status === 'error') {
        clearInterval(CL.pollTimer);
        const progressWrap = document.getElementById('cl-progress-wrap');
        if (progressWrap) progressWrap.style.display = 'none';
        showToast('Clustering failed: ' + (data.error || 'Unknown error'), 'error');
        if (btn) { btn.disabled = false; btn.textContent = '◎ Run Clustering'; }
      } else {
        // running — animate progress
        const pct = Math.min(15 + ticks * 4, 88);
        const phase = pct < 40 ? 'Building similarity matrix…' : pct < 70 ? 'Running algorithm…' : 'Computing MDS projection…';
        clSetProgress(pct, phase);
      }
    } catch(e) {
      console.warn('Poll error', e);
    }
  }, 1500);
}

function clSetProgress(pct, label) {
  const fill  = document.getElementById('cl-progress-fill');
  const lbl   = document.getElementById('cl-phase-label');
  const pctEl = document.getElementById('cl-pct-label');
  if (fill)  fill.style.width  = pct + '%';
  if (lbl)   lbl.textContent   = label;
  if (pctEl) pctEl.textContent = pct + '%';
}

/* ─────────────────────────────────────────────────────────────────
   Sidebar summary
───────────────────────────────────────────────────────────────── */
function clUpdateSidebarSummary() {
  const showEl = (id, val, parentId) => {
    const el = document.getElementById(id);
    const par = document.getElementById(parentId);
    if (val !== null && val !== undefined && val !== '') {
      if (el) el.textContent = val;
      if (par) par.style.display = '';
    }
  };
  showEl('cl-sum-basis-val', CL.basis, 'cl-sum-basis');
  showEl('cl-sum-n-val',     CL.selected.length || null, 'cl-sum-n');
  showEl('cl-sum-algo-val',  CL.algo, 'cl-sum-algo');
}

/* ─────────────────────────────────────────────────────────────────
   Step 5: Render results
───────────────────────────────────────────────────────────────── */
function clRenderResults(data) {
  if (!data) return;

  clRenderMetrics(data);
  clRenderSummary(data);
  clRenderClusterExplainer(data);
  clRenderClusterCards(data);
  clRenderTable(data);
  clRenderScatter(data);
  clRenderForceGraph(data);
  clInitResultMap(data);
  clRenderSimilarityMatrix(data);

  if (CL.algo === 'agglomerative' && data.dendrogram) {
    clRenderDendrogram(data.dendrogram, data.assignments || {});
    document.getElementById('cl-dendro-na')?.style && (document.getElementById('cl-dendro-na').style.display = 'none');
  } else {
    document.getElementById('cl-dendrogram-svg').innerHTML = '';
    const na = document.getElementById('cl-dendro-na');
    if (na) na.style.display = '';
  }

  /* ── Per-algorithm default viz tab ──────────────────────────────────
     Each algorithm has a "natural" visualisation. Activating the right
     tab automatically saves the user a click and avoids the dendrogram
     showing a "not available" message for non-agglomerative runs. */
  const DEFAULT_TAB_BY_ALGO = {
    agglomerative: 'cl-tab-dendro',
    dbscan:        'cl-tab-scatter',  // density patterns + outliers read best in 2D
    spectral:      'cl-tab-force',    // graph-Laplacian → graph view
    kmedoids:      'cl-tab-table',    // medoid-centric → table
  };

  const ALL_TAB_IDS = ['cl-tab-dendro','cl-tab-matrix','cl-tab-scatter',
                       'cl-tab-force','cl-tab-map','cl-tab-table'];

  const setActiveTab = (tabId) => {
    const tabList = document.getElementById('cl-viz-tabs');
    if (!tabList) return;
    tabList.querySelectorAll('.tab-trigger').forEach(x => x.classList.remove('active'));
    ALL_TAB_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const trigger = tabList.querySelector(`[data-tab="${tabId}"]`);
    const content = document.getElementById(tabId);
    if (trigger) trigger.classList.add('active');
    // 'block' (not '') so the base.html `.tab-content { display: none; }`
    // class rule doesn't re-win after clearing the inline override.
    if (content) content.style.display = 'block';
    if (tabId === 'cl-tab-map' && CL.resultMap) {
      setTimeout(() => CL.resultMap.invalidateSize(), 100);
    }
  };

  const tabList = document.getElementById('cl-viz-tabs');
  if (tabList) {
    tabList.querySelectorAll('.tab-trigger').forEach(t => {
      t.addEventListener('click', () => setActiveTab(t.dataset.tab));
    });
  }

  setActiveTab(DEFAULT_TAB_BY_ALGO[CL.algo] || 'cl-tab-dendro');
}

/* ─────────────────────────────────────────────────────────────────
   Similarity Matrix — numeric table view.
   Rows/cols are reordered by cluster so well-formed clusters cluster
   visibly in the table; thicker borders mark cluster boundaries.
   Each cell shows the pairwise similarity as an integer percentage.
───────────────────────────────────────────────────────────────── */
function clRenderSimilarityMatrix(data) {
  const container = document.getElementById('cl-matrix-svg');
  if (!container) return;
  container.innerHTML = '';

  const matrix      = data.matrix || {};
  const assignments = data.assignments || {};
  const names0      = Object.keys(matrix);
  if (!names0.length) {
    container.innerHTML = '<p style="color:var(--muted-foreground);font-size:13px;">No matrix data.</p>';
    return;
  }

  // Sort by cluster (outliers last), then alphabetically — keeps cluster
  // members adjacent so block structure is visible.
  const names = names0.slice().sort((a, b) => {
    const ca = assignments[a] ?? 999, cb = assignments[b] ?? 999;
    const ka = ca === -1 ? 9999 : ca, kb = cb === -1 ? 9999 : cb;
    if (ka !== kb) return ka - kb;
    return a.localeCompare(b);
  });

  const n      = names.length;
  const colorFor = name => {
    const cid = assignments[name];
    if (cid === -1 || cid === undefined) return 'oklch(0.7 0.25 320)';
    return CL_PALETTE[cid % CL_PALETTE.length] || 'var(--muted-foreground)';
  };
  // Cell sizing scales with matrix dimension so values stay readable.
  const cellPx  = n <= 15 ? 50 : n <= 30 ? 38 : n <= 60 ? 28 : 22;
  const fontPx  = n <= 15 ? 12 : n <= 30 ? 11 : n <= 60 ? 10 : 9;
  const labelPx = Math.max(80, Math.min(140, cellPx * 3));

  // Boundary set — i is a boundary if its cluster differs from i-1.
  const boundary = new Set();
  for (let i = 1; i < n; i++) {
    if ((assignments[names[i]] ?? -2) !== (assignments[names[i - 1]] ?? -2)) {
      boundary.add(i);
    }
  }

  // Build the table HTML once for speed (38k DOM cells if all 195 selected).
  const rows = [];
  // Header row
  let header = `<tr><th class="cl-mat-corner"></th>`;
  names.forEach((name, j) => {
    const c = colorFor(name);
    const cls = boundary.has(j) ? 'cl-mat-col-boundary' : '';
    header += `<th class="cl-mat-colhead ${cls}" style="color:${c};"
                    title="${escClHtml(name)}">${escClHtml(name)}</th>`;
  });
  header += `</tr>`;
  rows.push(header);

  // Body rows
  for (let i = 0; i < n; i++) {
    const rowCls = boundary.has(i) ? 'cl-mat-row-boundary' : '';
    const rowName = names[i];
    let row = `<tr class="${rowCls}">`;
    row += `<th class="cl-mat-rowhead" style="color:${colorFor(rowName)};"
                  title="${escClHtml(rowName)}">${escClHtml(rowName)}</th>`;
    for (let j = 0; j < n; j++) {
      const v = matrix[rowName]?.[names[j]];
      const pct = (typeof v === 'number') ? Math.round(v * 100) : '';
      const isDiag = i === j;
      const cls = [
        isDiag ? 'cl-mat-diag' : '',
        boundary.has(j) ? 'cl-mat-col-boundary' : '',
      ].filter(Boolean).join(' ');
      const title = (typeof v === 'number')
        ? `${rowName} ↔ ${names[j]}: ${(v * 100).toFixed(2)}%`
        : '';
      row += `<td class="${cls}" title="${title}">${pct}</td>`;
    }
    row += `</tr>`;
    rows.push(row);
  }

  // Inject a one-off style block scoped to this matrix; cheaper than
  // assigning style="..." on tens of thousands of cells.
  container.innerHTML = `
    <style>
      .cl-mat-table {
        border-collapse: collapse;
        font-family: 'JetBrains Mono', monospace;
        font-size: ${fontPx}px;
        background: var(--card);
      }
      .cl-mat-table th, .cl-mat-table td {
        border: 1px solid var(--border);
        text-align: center;
        vertical-align: middle;
        white-space: nowrap;
      }
      .cl-mat-table td {
        width: ${cellPx}px;
        height: ${cellPx}px;
        color: var(--foreground);
        font-variant-numeric: tabular-nums;
      }
      .cl-mat-table th.cl-mat-rowhead {
        position: sticky; left: 0; z-index: 2;
        background: var(--card);
        max-width: ${labelPx}px;
        padding: 0 8px;
        text-align: right;
        font-weight: 600;
        overflow: hidden; text-overflow: ellipsis;
      }
      .cl-mat-table th.cl-mat-colhead {
        position: sticky; top: 0; z-index: 2;
        background: var(--card);
        height: ${labelPx}px;
        padding: 6px 0;
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        font-weight: 600;
        text-align: left;
      }
      .cl-mat-table th.cl-mat-corner {
        position: sticky; top: 0; left: 0; z-index: 3;
        background: var(--card);
        width: ${labelPx}px;
        height: ${labelPx}px;
      }
      .cl-mat-table td.cl-mat-diag {
        background: oklch(0.78 0.18 200 / 0.18);
        color: var(--primary);
        font-weight: 700;
      }
      .cl-mat-table .cl-mat-row-boundary > * {
        border-top: 2px solid var(--foreground) !important;
      }
      .cl-mat-table .cl-mat-col-boundary {
        border-left: 2px solid var(--foreground) !important;
      }
      .cl-mat-table tr:hover > td:not(.cl-mat-diag) {
        background: oklch(0.78 0.18 200 / 0.06);
      }
    </style>
    <table class="cl-mat-table">${rows.join('')}</table>
  `;
}

/* Metrics row */
function clRenderMetrics(data) {
  const el = document.getElementById('cl-metrics');
  if (!el) return;
  const assignments   = data.assignments || {};
  const clusterMembers = data.cluster_members || {};
  const nCountries    = Object.keys(assignments).length;
  const clusterIds    = Object.keys(clusterMembers).filter(k => k !== '-1');
  const nClusters     = clusterIds.length;
  const outliers      = clusterMembers['-1']?.length || 0;
  const evalMetrics   = data.eval || {};

  const tiles = [
    { val: nCountries, name: 'Countries' },
    { val: nClusters,  name: 'Clusters' },
    { val: outliers,   name: 'Outliers' },
    { val: CL.algo || '—', name: 'Algorithm' },
    { val: CL.basis || '—', name: 'Basis' },
  ];

  if (evalMetrics.silhouette !== undefined && evalMetrics.silhouette !== null) {
    tiles.push({
      val: evalMetrics.silhouette.toFixed(3),
      name: 'Silhouette',
      hint: 'Cluster separation quality. Range [-1,+1]; higher = better.',
    });
  }
  if (evalMetrics.davies_bouldin !== undefined && evalMetrics.davies_bouldin !== null) {
    tiles.push({
      val: evalMetrics.davies_bouldin.toFixed(3),
      name: 'Davies-Bouldin',
      hint: 'Within-vs-between ratio. Lower = better.',
    });
  }

  el.innerHTML = tiles.map(m => `
    <div class="metric-cell" ${m.hint ? `title="${escClHtml(m.hint)}"` : ''}>
      <div class="metric-val">${escClHtml(String(m.val))}</div>
      <div class="metric-name">${m.name}</div>
    </div>
  `).join('');
}

/* ─────────────────────────────────────────────────────────────────
   "How to read this" workflow explainer
───────────────────────────────────────────────────────────────── */
function clRenderSummary(data) {
  // Insert after the metrics row, before the viz tabs
  const tabList = document.getElementById('cl-viz-tabs');
  if (!tabList) return;
  // Remove any old summary node
  const existing = document.getElementById('cl-workflow-summary');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'cl-workflow-summary';
  wrap.className = 'card glass';
  wrap.style.cssText = 'border-radius:1rem;margin-bottom:20px;padding:16px;';

  const summary    = data.summary || {};
  const algoLabel  = ({
    agglomerative: 'Hierarchical agglomerative clustering (UPGMA)',
    dbscan: 'DBSCAN density-based clustering',
    spectral: 'Spectral graph-Laplacian clustering',
    kmedoids: 'k-Medoids (PAM)',
  })[summary.algorithm] || summary.algorithm;

  const basisExplain = summary.basis === 'structural'
    ? 'Each pair of countries was compared via <strong>Tree Edit Distance (Zhang-Shasha)</strong> on their typed infobox trees. Distance = 1 − similarity.'
    : 'Each pair of countries was compared via <strong>Jaccard token overlap</strong> on every leaf-text token in their infoboxes. Distance = 1 − Jaccard.';

  const medoids = data.medoids || {};
  const medoidNote = Object.keys(medoids).length
    ? `<div style="margin-top:10px;font-size:12px;color:var(--muted-foreground);">
        <strong style="color:var(--foreground);">Cluster representatives (medoids):</strong>
        ${Object.entries(medoids).filter(([k]) => k !== '-1')
          .map(([cid, name]) => {
            const c = clPaletteFor(cid);
            return `<span class="badge" style="background:${c.replace(')','/0.15)')};border:none;color:${c};margin:0 4px 4px 0;">
              Cluster ${parseInt(cid)+1}: ${escClHtml(name)}
            </span>`;
          }).join('')}
      </div>` : '';

  const evalText = (summary.silhouette !== undefined && summary.silhouette !== null)
    ? `<div style="margin-top:10px;font-size:12px;color:var(--muted-foreground);">
        Silhouette = <strong style="color:var(--foreground);">${summary.silhouette.toFixed(3)}</strong>
        (closer to 1 means cleaner separation);
        Davies-Bouldin = <strong style="color:var(--foreground);">${(summary.davies_bouldin ?? 0).toFixed(3)}</strong>
        (lower = tighter clusters).
       </div>` : '';

  wrap.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px;">
      <span class="badge badge-primary" style="font-size:10px;">WORKFLOW</span>
      <span style="font-size:14px;font-weight:600;">${escClHtml(algoLabel)} · ${escClHtml(summary.basis || '—')} basis</span>
    </div>
    <div style="font-size:13px;color:var(--muted-foreground);line-height:1.6;">
      <strong style="color:var(--foreground);">Step 1.</strong> ${basisExplain}<br/>
      <strong style="color:var(--foreground);">Step 2.</strong> The resulting ${summary.n_countries}×${summary.n_countries} distance matrix was given to <strong style="color:var(--foreground);">${algoLabel}</strong>,
      which produced ${summary.n_clusters} cluster${summary.n_clusters === 1 ? '' : 's'}${summary.n_outliers ? ` plus ${summary.n_outliers} outlier${summary.n_outliers === 1 ? '' : 's'}` : ''}.<br/>
      <strong style="color:var(--foreground);">Step 3.</strong> The same distance matrix was projected to 2D via <strong style="color:var(--foreground);">MDS</strong> for the scatter / force / map views below.
    </div>
    ${medoidNote}
    ${evalText}
  `;

  // Insert right before the viz tabs
  tabList.parentNode.insertBefore(wrap, tabList);
}

function clPaletteFor(cid) {
  if (String(cid) === '-1') return 'oklch(0.7 0.25 320)';
  return CL_PALETTE[parseInt(cid) % CL_PALETTE.length] || CL_PALETTE[0];
}

/* "How to read the cluster cards" — algorithm-aware narrative with the
   intra-cluster average similarity per cluster, sized from data.matrix. */
function clRenderClusterExplainer(data) {
  const el = document.getElementById('cl-cluster-explainer');
  if (!el) return;

  const members  = data.cluster_members || {};
  const medoids  = data.medoids        || {};
  const matrix   = data.matrix         || {};
  const algoName = ({
    agglomerative: 'agglomerative hierarchical clustering',
    dbscan:        'DBSCAN (density-based)',
    spectral:      'spectral graph-Laplacian clustering',
    kmedoids:      'k-medoids (PAM)',
  })[data.algorithm] || data.algorithm;

  // Compute mean intra-cluster similarity for each non-outlier cluster.
  const cohesion = {};
  Object.entries(members).forEach(([cid, ms]) => {
    if (cid === '-1' || ms.length < 2) { cohesion[cid] = null; return; }
    let sum = 0, count = 0;
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const v = matrix[ms[i]]?.[ms[j]];
        if (typeof v === 'number') { sum += v; count++; }
      }
    }
    cohesion[cid] = count > 0 ? sum / count : null;
  });

  const cohesionLine = Object.entries(cohesion)
    .filter(([cid, v]) => cid !== '-1' && v !== null)
    .map(([cid, v]) => `Cluster ${parseInt(cid) + 1}: <strong style="color:var(--foreground);">${(v * 100).toFixed(1)}%</strong>`)
    .join(' · ');

  let algoNote = '';
  if (data.algorithm === 'dbscan') {
    const outliers = (members['-1'] || []).length;
    algoNote = outliers > 0
      ? ` <strong style="color:var(--secondary);">${outliers} country${outliers === 1 ? '' : 'ies'}</strong> in the purple "Outliers" card sat in a low-density region (no ε-neighbourhood with min_samples neighbours) and so DBSCAN refused to assign them to any cluster.`
      : ' DBSCAN found no outliers at the current ε / min_samples.';
  } else if (data.algorithm === 'agglomerative') {
    algoNote = ' Each card here is a subtree of the dendrogram below the chosen distance threshold cut.';
  } else if (data.algorithm === 'kmedoids') {
    algoNote = ' Each card shows the cluster\'s <em>medoid</em> — the country that minimises the total distance to every other member (the real-country analogue of a centroid).';
  } else if (data.algorithm === 'spectral') {
    algoNote = ' Clusters here are the partitions of the similarity graph found by the Laplacian eigen-decomposition; the medoid badge picks the most central country per cluster for labelling.';
  }

  el.innerHTML = `
    <strong style="color:var(--foreground);">How to read this:</strong>
    The cards below were produced by <strong style="color:var(--foreground);">${algoName}</strong>
    on the structural similarity (TED) matrix. Each card lists the member countries of one cluster;
    the highlighted badge marks the <em>medoid</em> — the country whose mean similarity to every other
    member is highest, so it best represents the group.${algoNote}
    ${cohesionLine ? `<br/><br/><strong style="color:var(--foreground);">Intra-cluster cohesion (mean pairwise similarity):</strong> ${cohesionLine}` : ''}
  `;
}

/* Cluster summary cards */
function clRenderClusterCards(data) {
  const el = document.getElementById('cl-cluster-cards');
  if (!el) return;
  const clusterMembers = data.cluster_members || {};
  const medoids        = data.medoids        || {};

  const clusterIds = Object.keys(clusterMembers).sort((a, b) => {
    if (a === '-1') return 1;
    if (b === '-1') return -1;
    return parseInt(a) - parseInt(b);
  });

  el.innerHTML = clusterIds.map((cid, i) => {
    const members  = clusterMembers[cid] || [];
    const isOutlier = cid === '-1';
    const color    = isOutlier ? 'oklch(0.7 0.25 320)' : (CL_PALETTE[i % CL_PALETTE.length] || CL_PALETTE[0]);
    const label    = isOutlier ? 'Outliers / Noise' : `Cluster ${parseInt(cid)+1}`;
    const medoid   = medoids[cid];

    return `<div class="cluster-card">
      <div class="cluster-card-header">
        <div class="cluster-dot" style="background:${color};"></div>
        <span style="font-size:14px;font-weight:600;">${label}</span>
        <span style="font-size:12px;color:var(--muted-foreground);margin-left:auto;">${members.length} ${members.length === 1 ? 'country' : 'countries'}</span>
        ${medoid ? `<span class="badge" style="font-size:10px;background:${color.replace(')', '/0.15)')};border:none;color:${color};">Medoid: ${escClHtml(medoid)}</span>` : ''}
      </div>
      <div class="cluster-members">
        ${members.map(m => `<span class="cluster-member-pill${isOutlier?' outlier-pill':''}">${escClHtml(m)}</span>`).join('')}
      </div>
    </div>`;
  }).join('');
}

/* Table view */
function clRenderTable(data) {
  const tbody = document.getElementById('cl-table-body');
  if (!tbody) return;
  const assignments = data.assignments || {};
  const medoids     = data.medoids     || {};

  // Build reverse medoids map: cluster -> medoid name
  const medoidNames = {};
  Object.entries(medoids).forEach(([cid, name]) => { medoidNames[cid] = name; });

  const rows = Object.entries(assignments).sort((a,b) => a[1]-b[1]);
  tbody.innerHTML = rows.map(([country, cid]) => {
    const isOutlier = cid === -1 || String(cid) === '-1';
    const label     = isOutlier ? 'Outlier' : `Cluster ${parseInt(cid)+1}`;
    const color     = isOutlier ? 'oklch(0.7 0.25 320)' : (CL_PALETTE[parseInt(cid) % CL_PALETTE.length] || CL_PALETTE[0]);
    const medoid    = medoidNames[String(cid)];
    const isMedoid  = medoid === country;
    return `<tr>
      <td>${escClHtml(country)}${isMedoid ? ' <span style="font-size:10px;color:var(--primary);">⬡ medoid</span>' : ''}</td>
      <td><span style="display:inline-flex;align-items:center;gap:6px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block;"></span>
        ${label}
      </span></td>
      <td style="color:var(--muted-foreground);">${medoid ? escClHtml(medoid) : '—'}</td>
    </tr>`;
  }).join('');
}

/* ─────────────────────────────────────────────────────────────────
   Dendrogram (D3)
───────────────────────────────────────────────────────────────── */
function clRenderDendrogram(dendroData, assignments) {
  const container = document.getElementById('cl-dendrogram-svg');
  if (!container || !dendroData) return;
  container.innerHTML = '';

  /* ── Build hierarchy from the backend's {name, left, right, height} ── */
  function buildHierarchy(node) {
    if (!node) return null;
    if (node.name) return { name: node.name, height: 0, children: [] };
    const left  = buildHierarchy(node.left);
    const right = buildHierarchy(node.right);
    return {
      name: `merge_${node.id ?? Math.random()}`,
      height: node.height || 0,
      children: [left, right].filter(Boolean),
    };
  }
  const hier = buildHierarchy(dendroData);
  if (!hier) {
    container.innerHTML = '<p style="color:var(--muted-foreground);font-size:13px;">No dendrogram data.</p>';
    return;
  }

  const root = d3.hierarchy(hier)
    .sort((a, b) => d3.ascending(a.data.name, b.data.name));
  const leaves = root.leaves();
  const n = leaves.length;

  /* ── Layout: HORIZONTAL — much more readable than vertical-with-rotated-text
     for many leaves. Leaves on the right, names horizontal, root on the left. */
  const ROW_H        = 18;            // vertical spacing per leaf
  const NAME_PAD     = 180;           // px reserved for country names on the right
  const margin       = { top: 24, right: NAME_PAD, bottom: 24, left: 12 };
  const innerH       = Math.max(240, n * ROW_H);
  const innerW       = Math.max(420, container.clientWidth - margin.left - margin.right - 40);
  const totalW       = innerW + margin.left + margin.right;
  const totalH       = innerH + margin.top  + margin.bottom;

  const svg = d3.select(container)
    .append('svg')
    .attr('width',  totalW)
    .attr('height', totalH)
    .style('background', 'transparent');

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  /* Position leaves evenly down the y axis; x is proportional to merge height. */
  const maxHeight = d3.max(root.descendants(), d => d.data.height || 0) || 1;
  const xScale    = d3.scaleLinear().domain([maxHeight, 0]).range([0, innerW]);

  leaves.forEach((leaf, i) => { leaf.y = i * ROW_H + ROW_H / 2; });
  // Internal nodes' y = mean of children's y; x = scaled by merge height
  function assign(node) {
    if (node.children && node.children.length) {
      node.children.forEach(assign);
      node.y = d3.mean(node.children, c => c.y);
    }
    node.x = xScale(node.data.height || 0);
  }
  assign(root);

  /* ── x-axis ticks: distance threshold gridlines */
  const ticks = xScale.ticks(6);
  g.selectAll('.grid')
    .data(ticks)
    .enter().append('line')
    .attr('x1', d => xScale(d)).attr('x2', d => xScale(d))
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', 'var(--border)')
    .attr('stroke-dasharray', '2,4')
    .attr('opacity', 0.4);
  g.selectAll('.grid-label')
    .data(ticks)
    .enter().append('text')
    .attr('x', d => xScale(d))
    .attr('y', -8)
    .attr('text-anchor', 'middle')
    .attr('font-family', "'JetBrains Mono'")
    .attr('font-size', '9px')
    .attr('fill', 'var(--muted-foreground)')
    .text(d => d.toFixed(2));
  g.append('text')
    .attr('x', innerW / 2).attr('y', -20)
    .attr('text-anchor', 'middle')
    .attr('font-family', "'JetBrains Mono'")
    .attr('font-size', '10px')
    .attr('fill', 'var(--muted-foreground)')
    .attr('letter-spacing', '0.08em')
    .text('MERGE DISTANCE');

  /* ── Links (right-angled): vertical segment between two children's y's,
     horizontal segment from parent.x to child.x */
  g.selectAll('.dendro-link')
    .data(root.links())
    .enter().append('path')
    .attr('d', d =>
      `M${d.source.x},${d.source.y}` +
      `V${d.target.y}` +
      `H${d.target.x}`)
    .attr('fill', 'none')
    .attr('stroke', 'oklch(0.78 0.18 200 / 0.55)')
    .attr('stroke-width', 1.1);

  /* ── Leaf markers + names ──────────────────────────────────────── */
  leaves.forEach(leaf => {
    const name    = leaf.data.name;
    const cid     = assignments[name] !== undefined ? String(assignments[name]) : null;
    const isOut   = cid === '-1';
    const colorIdx = (cid !== null && !isOut) ? parseInt(cid) % CL_PALETTE.length : null;
    const color   = isOut ? 'oklch(0.7 0.25 320)'
                          : (colorIdx !== null ? CL_PALETTE[colorIdx] : 'var(--muted-foreground)');

    g.append('circle')
      .attr('cx', leaf.x).attr('cy', leaf.y)
      .attr('r', 3.5)
      .attr('fill', color);

    g.append('text')
      .attr('x', leaf.x + 8).attr('y', leaf.y + 3)
      .attr('text-anchor', 'start')
      .attr('font-family', "'Space Grotesk'")
      .attr('font-size', '11px')
      .attr('fill', color)
      .text(name);
  });

  /* ── Threshold-cut marker (agglomerative uses this height to cut) ── */
  const thresh = parseFloat(document.getElementById('param-thresh')?.value);
  if (thresh && thresh > 0 && thresh <= maxHeight) {
    g.append('line')
      .attr('x1', xScale(thresh)).attr('x2', xScale(thresh))
      .attr('y1', 0).attr('y2', innerH)
      .attr('stroke', 'var(--warning)')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,3');
    g.append('text')
      .attr('x', xScale(thresh) + 4).attr('y', 12)
      .attr('font-family', "'JetBrains Mono'")
      .attr('font-size', '9px')
      .attr('fill', 'var(--warning)')
      .text(`cut @ ${thresh.toFixed(2)}`);
  }
}

/* ─────────────────────────────────────────────────────────────────
   2D Scatter (D3)
───────────────────────────────────────────────────────────────── */
function clRenderScatter(data) {
  const container = document.getElementById('cl-scatter-svg');
  if (!container) return;
  container.innerHTML = '';

  const mds         = data.mds_coords   || [];
  const assignments = data.assignments  || {};
  if (!mds.length) {
    container.innerHTML = '<p style="color:var(--muted-foreground);font-size:13px;padding:20px;">No MDS data available.</p>';
    return;
  }

  const width  = container.clientWidth || 700;
  const height = 420;
  const margin = { top: 20, right: 20, bottom: 20, left: 20 };

  const svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('background', 'transparent');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const iW = width  - margin.left - margin.right;
  const iH = height - margin.top  - margin.bottom;

  const xs = mds.map(d => d[1]);
  const ys = mds.map(d => d[2]);

  const xScale = d3.scaleLinear().domain([d3.min(xs)*1.1, d3.max(xs)*1.1]).range([0, iW]);
  const yScale = d3.scaleLinear().domain([d3.min(ys)*1.1, d3.max(ys)*1.1]).range([iH, 0]);

  // Voronoi tooltip
  const tooltip = d3.select(container).append('div')
    .style('position','absolute').style('pointer-events','none')
    .style('background','var(--card)').style('border','1px solid var(--border)')
    .style('border-radius','6px').style('padding','6px 10px')
    .style('font-size','12px').style('display','none');

  mds.forEach(([name, x, y]) => {
    const cid   = assignments[name] !== undefined ? String(assignments[name]) : null;
    const isOut = cid === '-1';
    const ci    = cid !== null && !isOut ? parseInt(cid) % CL_PALETTE.length : null;
    const color = isOut ? 'oklch(0.7 0.25 320)' : (ci !== null ? CL_PALETTE[ci] : 'var(--muted-foreground)');

    g.append('circle')
      .attr('cx', xScale(x))
      .attr('cy', yScale(y))
      .attr('r', 6)
      .attr('fill', color)
      .attr('fill-opacity', 0.85)
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.8)
      .style('cursor','pointer')
      .on('mouseover', function(event) {
        d3.select(this).attr('r', 9);
        tooltip.style('display','').html(`<strong>${escClHtml(name)}</strong><br/>Cluster ${cid === '-1' ? 'Outlier' : (parseInt(cid)+1)}`);
      })
      .on('mousemove', function(event) {
        const rect = container.getBoundingClientRect();
        tooltip.style('left', (event.clientX - rect.left + 10) + 'px')
               .style('top',  (event.clientY - rect.top  - 28) + 'px');
      })
      .on('mouseout', function() {
        d3.select(this).attr('r', 6);
        tooltip.style('display','none');
      });

    g.append('text')
      .attr('x', xScale(x) + 8)
      .attr('y', yScale(y) + 4)
      .attr('font-size', '9px')
      .attr('fill', color)
      .attr('fill-opacity', 0.8)
      .text(name.length > 10 ? name.slice(0,9)+'…' : name);
  });
}

/* ─────────────────────────────────────────────────────────────────
   Force-directed graph (D3)
───────────────────────────────────────────────────────────────── */
function clRenderForceGraph(data) {
  const svgEl = document.getElementById('cl-force-svg');
  if (!svgEl) return;
  d3.select(svgEl).selectAll('*').remove();

  const assignments    = data.assignments    || {};
  const clusterMembers = data.cluster_members || {};
  const mds            = data.mds_coords     || [];

  const names = Object.keys(assignments);
  if (!names.length) return;

  const width  = svgEl.clientWidth  || 700;
  const height = svgEl.clientHeight || 500;

  const svg = d3.select(svgEl)
    .attr('viewBox', `0 0 ${width} ${height}`);

  // ── Zoom/pan: everything in `root` is transformed by the zoom behaviour;
  //    the SVG itself stays put so the cursor / events still fire correctly.
  const zoom = d3.zoom()
    .scaleExtent([0.1, 8])
    .on('zoom', e => root.attr('transform', e.transform));
  svg.call(zoom).on('dblclick.zoom', null);   // disable double-click zoom; we use buttons
  CL._forceZoom = zoom;
  CL._forceSvg  = svg;

  const root = svg.append('g').attr('class', 'cl-force-root');

  const nodes = names.map(name => ({
    id:  name,
    cid: String(assignments[name]),
  }));

  // Edges: connect nodes within same cluster
  const links = [];
  Object.entries(clusterMembers).forEach(([cid, members]) => {
    if (cid === '-1' || members.length < 2) return;
    for (let i = 0; i < members.length - 1; i++) {
      links.push({ source: members[i], target: members[i+1] });
    }
    // Connect first to all (star)
    for (let i = 2; i < Math.min(members.length, 8); i++) {
      links.push({ source: members[0], target: members[i] });
    }
  });

  const sim = d3.forceSimulation(nodes)
    .force('link',   d3.forceLink(links).id(d => d.id).distance(60).strength(0.4))
    .force('charge', d3.forceManyBody().strength(-120))
    .force('center', d3.forceCenter(width/2, height/2))
    .force('collide', d3.forceCollide(14));
  CL._forceSim = sim;

  const link = root.append('g')
    .selectAll('line')
    .data(links)
    .enter().append('line')
    .attr('stroke', 'oklch(0.78 0.18 200 / 0.2)')
    .attr('stroke-width', 1);

  const node = root.append('g')
    .selectAll('g')
    .data(nodes)
    .enter().append('g')
    .call(d3.drag()
      .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
      .on('drag',  (event, d) => { d.fx=event.x; d.fy=event.y; })
      .on('end',   (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx=null; d.fy=null; })
    );

  node.append('circle')
    .attr('r', 7)
    .attr('fill', d => {
      const isOut = d.cid === '-1';
      if (isOut) return 'oklch(0.7 0.25 320)';
      return CL_PALETTE[parseInt(d.cid) % CL_PALETTE.length] || CL_PALETTE[0];
    })
    .attr('stroke', '#fff')
    .attr('stroke-width', 0.8);

  node.append('text')
    .attr('x', 10)
    .attr('y', 4)
    .attr('font-size', '9px')
    .attr('fill', 'var(--muted-foreground)')
    .text(d => d.id.length > 12 ? d.id.slice(0,11)+'…' : d.id);

  node.append('title').text(d => d.id);

  sim.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

/* ─────────────────────────────────────────────────────────────────
   Force-graph zoom controls (wired to the buttons in clustering.html)
───────────────────────────────────────────────────────────────── */
function clForceZoom(factor) {
  if (!CL._forceZoom || !CL._forceSvg) return;
  CL._forceSvg.transition().duration(220).call(CL._forceZoom.scaleBy, factor);
}

function clForceZoomReset() {
  if (!CL._forceZoom || !CL._forceSvg) return;
  CL._forceSvg.transition().duration(280).call(CL._forceZoom.transform, d3.zoomIdentity);
}

/* Pan/zoom the view so every node fits comfortably inside the SVG. */
function clForceZoomFit() {
  if (!CL._forceZoom || !CL._forceSvg) return;
  const svgEl = document.getElementById('cl-force-svg');
  const root  = CL._forceSvg.select('g.cl-force-root').node();
  if (!svgEl || !root) return;
  // bbox is in the *transformed* coordinate space — undo the current zoom first
  CL._forceSvg.call(CL._forceZoom.transform, d3.zoomIdentity);
  const bbox = root.getBBox();
  if (!bbox.width || !bbox.height) return;
  const w = svgEl.clientWidth  || 700;
  const h = svgEl.clientHeight || 500;
  const PAD = 60;
  const scale = Math.min((w - PAD) / bbox.width, (h - PAD) / bbox.height);
  const tx = (w - bbox.width  * scale) / 2 - bbox.x * scale;
  const ty = (h - bbox.height * scale) / 2 - bbox.y * scale;
  CL._forceSvg.transition().duration(360)
    .call(CL._forceZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

/* ─────────────────────────────────────────────────────────────────
   Result map (Leaflet choropleth)
───────────────────────────────────────────────────────────────── */
function clInitResultMap(data) {
  const mapEl = document.getElementById('cl-result-map');
  if (!mapEl) return;

  if (CL.resultMap) { CL.resultMap.remove(); CL.resultMap = null; }

  CL.resultMap = L.map('cl-result-map', { zoomControl: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 19,
  }).addTo(CL.resultMap);

  const assignments    = data.assignments    || {};
  const mds            = data.mds_coords     || [];

  // Place circle markers where MDS has coords; fallback to nothing
  mds.forEach(([name, x, y]) => {
    const cid   = assignments[name] !== undefined ? String(assignments[name]) : null;
    const isOut = cid === '-1';
    const ci    = cid !== null && !isOut ? parseInt(cid) % CL_PALETTE.length : null;
    const color = isOut ? '#a020f0' : (ci !== null ? oklchToHex(CL_PALETTE[ci]) : '#999');

    if (data.country_coords && data.country_coords[name]) {
      const [lat, lng] = data.country_coords[name];
      L.circleMarker([lat, lng], {
        radius: 8,
        fillColor: color,
        color: '#fff', weight: 1, fillOpacity: 0.85,
      }).addTo(CL.resultMap)
       .bindPopup(`<strong>${escClHtml(name)}</strong><br/>Cluster: ${cid === '-1' ? 'Outlier' : parseInt(cid)+1}`);
    }
  });
}

/* Very rough oklch string -> hex approximation for Leaflet */
function oklchToHex(oklchStr) {
  const map = {
    'oklch(0.78 0.18 200)': '#38bdf8',
    'oklch(0.7 0.25 320)':  '#a855f7',
    'oklch(0.75 0.22 130)': '#4ade80',
    'oklch(0.8 0.2 60)':    '#facc15',
    'oklch(0.7 0.22 20)':   '#f97316',
    'oklch(0.8 0.18 260)':  '#60a5fa',
    'oklch(0.75 0.2 180)':  '#22d3ee',
    'oklch(0.8 0.25 340)':  '#f472b6',
    'oklch(0.72 0.18 100)': '#a3e635',
    'oklch(0.75 0.15 230)': '#7dd3fc',
  };
  return map[oklchStr.trim()] || '#38bdf8';
}

/* ─────────────────────────────────────────────────────────────────
   Persistence
───────────────────────────────────────────────────────────────── */
function clSaveToHistory(data) {
  try {
    const history = JSON.parse(sessionStorage.getItem('similica_history') || '[]');
    const n = CL.selected.length;
    const cm = data.cluster_members || {};
    const k  = Object.keys(cm).filter(c => c !== '-1').length;
    history.push({
      type: 'clustering',
      title: `${CL.algo} · ${n} countries · k=${k}`,
      summary: `${CL.basis} basis, ${k} clusters`,
      timestamp: new Date().toISOString(),
      data,
    });
    sessionStorage.setItem('similica_history', JSON.stringify(history));
  } catch(e) { console.warn('Could not save to history', e); }
}

function clSaveResult() {
  if (!CL.result) return;
  try {
    const saved = JSON.parse(localStorage.getItem('similica_saved') || '[]');
    const n = CL.selected.length;
    const cm = CL.result.cluster_members || {};
    const k  = Object.keys(cm).filter(c => c !== '-1').length;
    saved.push({
      type: 'clustering',
      title: `${CL.algo} · ${n} countries · k=${k}`,
      summary: `${CL.basis} basis, ${k} clusters`,
      timestamp: new Date().toISOString(),
      data: CL.result,
    });
    localStorage.setItem('similica_saved', JSON.stringify(saved));
    showToast('Result saved!', 'success');
  } catch(e) { showToast('Could not save result', 'error'); }
}

function clExportJSON() {
  if (!CL.result) return;
  const blob = new Blob([JSON.stringify(CL.result, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `similica_clustering_${CL.algo}_${CL.selected.length}countries.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function clNewClustering() {
  CL.step     = 0;
  CL.basis    = 'structural';   // single option — re-apply default
  CL.algo     = null;
  CL.selected = [];
  CL.result   = null;
  if (CL.pollTimer) { clearInterval(CL.pollTimer); CL.pollTimer = null; }

  clGoTo(0);

  document.querySelectorAll('[data-algo]').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('[data-basis]').forEach(el =>
    el.classList.toggle('selected', el.dataset.basis === 'structural'));
  const search = document.getElementById('cl-country-search');
  if (search) search.value = '';

  // Re-render so the checkmarks, sidebar counter, and map pins from the
  // previous run all drop.
  clRenderCountryList(CL.allCountries);
  clRenderSelectedTags();
  clUpdateMapHighlights();
  clUpdateKMax();
  const warn = document.getElementById('cl-min-warn');
  if (warn) warn.style.display = 'none';
}

/* ─────────────────────────────────────────────────────────────────
   Utilities
───────────────────────────────────────────────────────────────── */
function escClHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
