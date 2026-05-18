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
  map: null,
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
  clGoTo(0);
  clLoadCountries();
  clUpdateParamVisibility();
});

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
  if (n === 1) clInitMap();
  if (n === 3) clUpdateParamVisibility();
  if (n === 4) clRenderRunSummary();
}

function clValidateStep(n) {
  if (n === 0 && !CL.basis)  { showToast('Please select a basis', 'error'); return false; }
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
   Step 0: Basis
───────────────────────────────────────────────────────────────── */
function clSelectBasis(basis) {
  CL.basis = basis;
  document.querySelectorAll('[data-basis]').forEach(el => {
    el.classList.toggle('selected', el.dataset.basis === basis);
  });
}

/* ─────────────────────────────────────────────────────────────────
   Step 1: Dataset
───────────────────────────────────────────────────────────────── */
async function clLoadCountries() {
  try {
    const res  = await fetch('/api/countries');
    const data = await res.json();
    CL.allCountries = data.countries || [];
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
  const warn = document.getElementById('cl-min-warn');
  if (warn) warn.style.display = CL.selected.length < 3 && CL.selected.length > 0 ? '' : 'none';
}

function clSelectAll() {
  CL.selected = [...CL.allCountries];
  clRenderCountryList(CL.allCountries);
  clRenderSelectedTags();
  clUpdateKMax();
}

function clClearAll() {
  CL.selected = [];
  clRenderCountryList(CL.allCountries);
  clRenderSelectedTags();
  clUpdateKMax();
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
  if (CL.map) return;
  CL.map = L.map('cl-map', { zoomControl: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 19,
  }).addTo(CL.map);
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
function clUpdateParamVisibility() {
  const algo = CL.algo;
  const show = (id, vis) => {
    const el = document.getElementById(id);
    if (el) el.style.display = vis ? '' : 'none';
  };
  const dim = (id, dimmed) => {
    const el = document.getElementById(id);
    if (el) el.style.opacity = dimmed ? '0.4' : '1';
  };

  // k — agglomerative, spectral, kmedoids
  const needsK = ['agglomerative','spectral','kmedoids'].includes(algo);
  dim('param-k-row', !needsK);

  // linkage — agglomerative only
  dim('param-linkage-row', algo !== 'agglomerative');

  // eps + minpts — dbscan only
  dim('param-eps-row', algo !== 'dbscan');
  dim('param-minpts-row', algo !== 'dbscan');
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
  const k        = parseInt(document.getElementById('param-k')?.value      || 5);
  const linkage  = document.getElementById('param-linkage')?.value         || 'average';
  const eps      = parseFloat(document.getElementById('param-eps')?.value  || 0.3);
  const minpts   = parseInt(document.getElementById('param-minpts')?.value  || 2);
  const thresh   = parseFloat(document.getElementById('param-thresh')?.value || 0);
  return { k, linkage, eps, min_samples: minpts, distance_threshold: thresh > 0 ? thresh : null };
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
  if (['agglomerative','spectral','kmedoids'].includes(CL.algo)) paramStr += `k=${p.k}`;
  if (CL.algo === 'agglomerative') paramStr += `, linkage=${p.linkage}`;
  if (CL.algo === 'dbscan') paramStr = `ε=${p.eps.toFixed(2)}, min_samples=${p.min_samples}`;
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
  clRenderClusterCards(data);
  clRenderTable(data);
  clRenderScatter(data);
  clRenderForceGraph(data);
  clInitResultMap(data);

  if (CL.algo === 'agglomerative' && data.dendrogram) {
    clRenderDendrogram(data.dendrogram, data.assignments || {});
    document.getElementById('cl-dendro-na')?.style && (document.getElementById('cl-dendro-na').style.display = 'none');
  } else {
    document.getElementById('cl-dendrogram-svg').innerHTML = '';
    const na = document.getElementById('cl-dendro-na');
    if (na) na.style.display = '';
  }

  // Init result viz tabs
  const tabList = document.getElementById('cl-viz-tabs');
  if (tabList) {
    tabList.querySelectorAll('.tab-trigger').forEach(t => {
      t.addEventListener('click', () => {
        tabList.querySelectorAll('.tab-trigger').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('#cl-tab-dendro,#cl-tab-scatter,#cl-tab-force,#cl-tab-map,#cl-tab-table').forEach(x => x.style.display = 'none');
        t.classList.add('active');
        const target = document.getElementById(t.dataset.tab);
        if (target) {
          target.style.display = '';
          // Refresh maps/SVGs on tab show
          if (t.dataset.tab === 'cl-tab-map' && CL.resultMap) {
            setTimeout(() => CL.resultMap.invalidateSize(), 100);
          }
        }
      });
    });
  }
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
  const medoids       = data.medoids || {};
  const nMedoids      = Object.keys(medoids).length;

  el.innerHTML = [
    { val: nCountries, name: 'Countries' },
    { val: nClusters,  name: 'Clusters' },
    { val: outliers,   name: 'Outliers' },
    { val: CL.algo || '—', name: 'Algorithm' },
    { val: CL.basis || '—', name: 'Basis' },
  ].map(m => `
    <div class="metric-cell">
      <div class="metric-val">${escClHtml(String(m.val))}</div>
      <div class="metric-name">${m.name}</div>
    </div>
  `).join('');
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

  const n = dendroData.leaves ? dendroData.leaves.length : 10;
  const width  = Math.max(600, n * 30);
  const height = 480;
  const margin = { top: 20, right: 20, bottom: 80, left: 20 };

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', 'transparent');

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const innerW = width  - margin.left - margin.right;
  const innerH = height - margin.top  - margin.bottom;

  // Build d3 hierarchy from {id, left, right, height, name} structure
  function buildHierarchy(node) {
    if (!node) return null;
    if (node.name) {
      // Leaf
      return { name: node.name, children: [] };
    }
    const left  = buildHierarchy(node.left);
    const right = buildHierarchy(node.right);
    return {
      name: `merge_${node.id ?? Math.random()}`,
      height: node.height || 0,
      children: [left, right].filter(Boolean),
    };
  }

  const hier = buildHierarchy(dendroData);
  if (!hier) { container.innerHTML = '<p style="color:var(--muted-foreground);font-size:13px;">No dendrogram data.</p>'; return; }

  const root = d3.hierarchy(hier)
    .sort((a, b) => d3.ascending(a.data.name, b.data.name));

  const cluster = d3.cluster().size([innerW, innerH - 40]);
  cluster(root);

  // Links
  g.selectAll('.dendro-link')
    .data(root.links())
    .enter().append('path')
    .attr('class', 'dendro-link')
    .attr('d', d => {
      return `M${d.source.x},${d.source.y}` +
             `V${d.target.y}` +
             `H${d.target.x}`;
    })
    .attr('fill', 'none')
    .attr('stroke', 'oklch(0.78 0.18 200 / 0.4)')
    .attr('stroke-width', 1.2);

  // Leaf nodes
  const leaves = root.leaves();
  leaves.forEach(leaf => {
    const name    = leaf.data.name;
    const cid     = assignments[name] !== undefined ? String(assignments[name]) : null;
    const isOut   = cid === '-1';
    const colorIdx = cid !== null && !isOut ? parseInt(cid) % CL_PALETTE.length : null;
    const color   = isOut ? 'oklch(0.7 0.25 320)' : (colorIdx !== null ? CL_PALETTE[colorIdx] : 'var(--muted-foreground)');

    g.append('circle')
      .attr('cx', leaf.x)
      .attr('cy', leaf.y)
      .attr('r', 3)
      .attr('fill', color);

    g.append('text')
      .attr('x', leaf.x)
      .attr('y', leaf.y + 14)
      .attr('transform', `rotate(90,${leaf.x},${leaf.y + 14})`)
      .attr('text-anchor', 'start')
      .attr('font-size', '10px')
      .attr('fill', color)
      .text(name);
  });
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

  const link = svg.append('g')
    .selectAll('line')
    .data(links)
    .enter().append('line')
    .attr('stroke', 'oklch(0.78 0.18 200 / 0.2)')
    .attr('stroke-width', 1);

  const node = svg.append('g')
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
  CL.basis    = null;
  CL.algo     = null;
  CL.selected = [];
  CL.result   = null;
  clGoTo(0);
  document.querySelectorAll('[data-basis],[data-algo]').forEach(el => el.classList.remove('selected'));
  clRenderSelectedTags();
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
