/**
 * similarity.js  —  Similarity Wizard state machine
 * Steps: 0=Mode, 1=Type, 2=Countries, 3=DocReview, 4=Compute, 5=Results
 */

/* ─────────────────────────────────────────────────────────────────
   State
───────────────────────────────────────────────────────────────── */
const SIM = {
  step: 0,
  mode: null,       // 'pairwise' | 'one_vs_all'
  simType: null,    // 'structural' | 'semantic' | 'combined'
  alpha: 0.5,
  selected: [],     // array of country names (max 2 for pairwise, 1+ for 1vAll)
  allCountries: [],
  map: null,
  markers: {},
  result: null,
  resultMap: null,
  resultMarkers: [],
};

const STEP_TITLES = [
  'Select Mode',
  'Similarity Type',
  'Select Countries',
  'Review Documents',
  'Compute',
  'Results',
];

/* ─────────────────────────────────────────────────────────────────
   Bootstrap
───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  simGoTo(0);
  simLoadCountries();
});

/* ─────────────────────────────────────────────────────────────────
   Navigation
───────────────────────────────────────────────────────────────── */
function simNext() {
  if (!simValidateStep(SIM.step)) return;
  simGoTo(SIM.step + 1);
}

function simBack() {
  if (SIM.step > 0) simGoTo(SIM.step - 1);
}

function simGoTo(n) {
  // Hide all panels
  document.querySelectorAll('.sim-step-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sim-step-item').forEach(item => {
    item.classList.remove('active');
    const s = parseInt(item.dataset.step);
    if (s < n) item.classList.add('done'); else item.classList.remove('done');
  });

  // Activate target
  const panel = document.querySelector(`.sim-step-panel[data-step="${n}"]`);
  if (panel) panel.classList.add('active');
  const stepItem = document.querySelector(`.sim-step-item[data-step="${n}"]`);
  if (stepItem) stepItem.classList.add('active');

  SIM.step = n;

  // Topbar
  const titleEl = document.getElementById('sim-step-title');
  const curEl   = document.getElementById('sim-step-cur');
  if (titleEl) titleEl.textContent = STEP_TITLES[n] || '';
  if (curEl)   curEl.textContent   = n + 1;

  // Footer buttons
  const backBtn = document.getElementById('sim-btn-back');
  const nextBtn = document.getElementById('sim-btn-next');
  if (backBtn) backBtn.style.display = n > 0 ? '' : 'none';
  if (nextBtn) {
    if (n === 5) {
      nextBtn.style.display = 'none';
    } else if (n === 4) {
      nextBtn.style.display = 'none'; // controlled by run button
    } else {
      nextBtn.style.display = '';
      nextBtn.textContent = n === 3 ? 'Continue →' : 'Next →';
    }
  }

  // Step-specific init
  if (n === 2) simInitMap();
  if (n === 3) simLoadDocReview();
  if (n === 4) simRenderRunSummary();
}

function simValidateStep(n) {
  if (n === 0 && !SIM.mode)    { showToast('Please select a mode', 'error'); return false; }
  if (n === 1 && !SIM.simType) { showToast('Please select a similarity type', 'error'); return false; }
  if (n === 2) {
    const req = SIM.mode === 'pairwise' ? 2 : 1;
    if (SIM.selected.length < req) {
      showToast(SIM.mode === 'pairwise' ? 'Select exactly 2 countries' : 'Select at least 1 country', 'error');
      return false;
    }
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────────
   Step 0: Mode selection
───────────────────────────────────────────────────────────────── */
function simSelectMode(mode) {
  SIM.mode = mode;
  document.querySelectorAll('[data-mode]').forEach(el => {
    el.classList.toggle('selected', el.dataset.mode === mode);
  });
}

/* ─────────────────────────────────────────────────────────────────
   Step 1: Type selection
───────────────────────────────────────────────────────────────── */
function simSelectType(type) {
  SIM.simType = type;
  document.querySelectorAll('[data-sim-type]').forEach(el => {
    el.classList.toggle('selected', el.dataset.simType === type);
  });
  // Show/hide alpha slider
  const alphaRow = document.getElementById('sim-alpha-row');
  if (alphaRow) alphaRow.style.display = (type === 'combined') ? '' : 'none';
}

function simUpdateAlpha(val) {
  SIM.alpha = parseFloat(val);
  const display = document.getElementById('sim-alpha-val');
  if (display) display.textContent = SIM.alpha.toFixed(2);
}

/* ─────────────────────────────────────────────────────────────────
   Step 2: Country selection
───────────────────────────────────────────────────────────────── */
async function simLoadCountries() {
  try {
    const res  = await fetch('/api/countries');
    const data = await res.json();
    SIM.allCountries = data.countries || [];
    simRenderCountryList(SIM.allCountries);
  } catch(e) {
    console.error('Failed to load countries', e);
  }
}

function simRenderCountryList(countries) {
  const container = document.getElementById('sim-country-scroll');
  if (!container) return;
  if (!countries.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted-foreground);font-size:13px;">No countries found</div>';
    return;
  }
  container.innerHTML = countries.map(name => {
    const sel = SIM.selected.includes(name);
    return `<div class="country-item${sel ? ' selected' : ''}" onclick="simToggleCountry('${name.replace(/'/g,"\\'")}')">
      <span style="font-size:14px;">🌐</span>
      <span style="flex:1;font-size:13px;">${name}</span>
      ${sel ? '<span style="color:var(--primary);font-size:13px;">✓</span>' : ''}
    </div>`;
  }).join('');
}

function simFilterCountries() {
  const q = (document.getElementById('sim-country-search')?.value || '').toLowerCase();
  const filtered = SIM.allCountries.filter(n => n.toLowerCase().includes(q));
  simRenderCountryList(filtered);
}

function simToggleCountry(name) {
  const idx = SIM.selected.indexOf(name);
  if (idx >= 0) {
    SIM.selected.splice(idx, 1);
  } else {
    if (SIM.mode === 'pairwise' && SIM.selected.length >= 2) {
      showToast('Pairwise mode allows exactly 2 countries. Remove one first.', 'error');
      return;
    }
    SIM.selected.push(name);
  }
  simFilterCountries();
  simRenderSelectedTags();
  simUpdateMapHighlights();
}

function simRenderSelectedTags() {
  const container = document.getElementById('sim-selected-tags');
  const countEl   = document.getElementById('sim-sel-count');
  if (!container) return;
  if (countEl) countEl.textContent = SIM.selected.length;

  container.innerHTML = SIM.selected.map(name => `
    <div class="sim-tag">
      ${name}
      <button onclick="simToggleCountry('${name.replace(/'/g,"\\'")}')">✕</button>
    </div>
  `).join('');
}

function simInitMap() {
  if (SIM.map) return; // already inited
  SIM.map = L.map('sim-map', { zoomControl: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 19,
  }).addTo(SIM.map);
  // No per-marker data — we rely on the list for selection
}

function simUpdateMapHighlights() {
  // lightweight: just re-render tags; full map country outline would need GeoJSON
}

/* ─────────────────────────────────────────────────────────────────
   Step 3: Document review
───────────────────────────────────────────────────────────────── */
async function simLoadDocReview() {
  const panel = document.getElementById('sim-doc-review-area');
  if (!panel) return;

  const countries = SIM.mode === 'pairwise' ? SIM.selected.slice(0, 2) : SIM.selected.slice(0, 1);
  if (!countries.length) return;

  panel.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted-foreground);">Loading…</div>';

  try {
    const docs = await Promise.all(countries.map(async name => {
      const res  = await fetch(`/api/country/${encodeURIComponent(name)}`);
      return await res.json();
    }));

    panel.innerHTML = docs.map((doc, i) => renderDocCard(doc, i)).join('');
    // init tabs within each card
    panel.querySelectorAll('.tabs-list').forEach(tabList => {
      const triggers = tabList.querySelectorAll('.tab-trigger');
      triggers.forEach(t => {
        t.addEventListener('click', () => {
          const parent = t.closest('.doc-card-inner');
          parent.querySelectorAll('.tab-trigger').forEach(x => x.classList.remove('active'));
          parent.querySelectorAll('.tab-content').forEach(x => x.style.display = 'none');
          t.classList.add('active');
          const target = parent.querySelector(`#${t.dataset.tab}`);
          if (target) target.style.display = '';
        });
      });
    });
  } catch(e) {
    panel.innerHTML = `<div style="color:red;padding:20px;">Error loading document: ${e.message}</div>`;
  }
}

function renderDocCard(doc, idx) {
  const name   = doc.name || `Country ${idx + 1}`;
  const json   = JSON.stringify(doc.data || {}, null, 2);
  const xml    = doc.xml  || '<error>Not available</error>';
  const treeHtml = renderTreeInspector(doc.data || {});
  const cardId = `doc-card-${idx}`;

  return `<div class="doc-card-inner card glass" style="border-radius:1rem;margin-bottom:20px;" id="${cardId}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <span class="badge badge-primary">${name}</span>
      <span style="font-size:12px;color:var(--muted-foreground);">Tree nodes: ${doc.tree_size ?? '—'}</span>
    </div>
    <div class="tabs-list" style="margin-bottom:14px;">
      <button class="tab-trigger active" data-tab="doc-rendered-${idx}">Rendered</button>
      <button class="tab-trigger" data-tab="doc-xml-${idx}">XML</button>
      <button class="tab-trigger" data-tab="doc-json-${idx}">JSON</button>
      <button class="tab-trigger" data-tab="doc-tree-${idx}">Tree Inspector</button>
    </div>
    <div id="doc-rendered-${idx}" class="tab-content" style="">
      ${renderInfoboxRendered(doc.data || {})}
    </div>
    <div id="doc-xml-${idx}" class="tab-content" style="display:none;">
      <pre style="font-family:'JetBrains Mono';font-size:11px;color:var(--muted-foreground);
        background:var(--muted);padding:16px;border-radius:0.5rem;overflow-x:auto;
        max-height:320px;overflow-y:auto;white-space:pre-wrap;">${escHtml(xml)}</pre>
    </div>
    <div id="doc-json-${idx}" class="tab-content" style="display:none;">
      <pre style="font-family:'JetBrains Mono';font-size:11px;color:var(--muted-foreground);
        background:var(--muted);padding:16px;border-radius:0.5rem;overflow-x:auto;
        max-height:320px;overflow-y:auto;white-space:pre-wrap;">${escHtml(json)}</pre>
    </div>
    <div id="doc-tree-${idx}" class="tab-content" style="display:none;">
      <div style="font-family:'JetBrains Mono';font-size:12px;line-height:1.9;
        max-height:320px;overflow-y:auto;">${treeHtml}</div>
    </div>
  </div>`;
}

function renderInfoboxRendered(data) {
  if (!data || typeof data !== 'object') return '<p style="color:var(--muted-foreground)">No data</p>';
  const sections = Object.keys(data);
  return sections.map(section => {
    const val = data[section];
    if (val === null || val === undefined) return '';
    return `<div style="margin-bottom:12px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;
        color:var(--primary);margin-bottom:6px;">${section}</div>
      <div style="font-size:13px;color:var(--muted-foreground);">${renderValue(val)}</div>
    </div>`;
  }).join('');
}

function renderValue(val) {
  if (val === null || val === undefined) return '<em>—</em>';
  if (typeof val === 'object' && !Array.isArray(val)) {
    return Object.entries(val).map(([k, v]) =>
      `<div><span style="color:var(--foreground);font-weight:500;">${k}:</span> ${renderValue(v)}</div>`
    ).join('');
  }
  if (Array.isArray(val)) return val.map(renderValue).join(', ');
  return String(val);
}

function renderTreeInspector(data, depth = 0) {
  if (typeof data !== 'object' || data === null) {
    return `<span style="color:oklch(0.75 0.22 130);">${escHtml(String(data))}</span>`;
  }
  const indent = '&nbsp;'.repeat(depth * 4);
  const entries = Object.entries(data);
  return entries.map(([k, v]) => {
    const isLeaf = typeof v !== 'object' || v === null;
    const icon   = isLeaf ? '◦' : '▸';
    const color  = isLeaf ? 'var(--muted-foreground)' : 'var(--foreground)';
    if (isLeaf) {
      return `<div>${indent}<span style="color:${color}">${icon} ${escHtml(k)}</span>: <span style="color:oklch(0.75 0.22 130);">${escHtml(String(v))}</span></div>`;
    }
    return `<details open>
      <summary style="cursor:pointer;list-style:none;">${indent}<span style="color:var(--primary);">▸ ${escHtml(k)}</span></summary>
      ${renderTreeInspector(v, depth + 1)}
    </details>`;
  }).join('');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─────────────────────────────────────────────────────────────────
   Step 4: Run summary + compute
───────────────────────────────────────────────────────────────── */
function simRenderRunSummary() {
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  set('sim-run-mode',    SIM.mode === 'pairwise' ? '1 vs 1' : '1 vs All');
  set('sim-run-type',    SIM.simType || '—');
  set('sim-run-alpha',   SIM.simType === 'combined' ? SIM.alpha.toFixed(2) : 'N/A');
  set('sim-run-countries', SIM.selected.join(' ↔ '));
}

async function simRunSimilarity() {
  const btn = document.getElementById('sim-run-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Computing…'; }

  simShowProgress(true);
  simSetProgress(10, 'Sending request…');

  const payload = {
    mode:    SIM.mode,
    type:    SIM.simType,
    alpha:   SIM.alpha,
    countries: SIM.selected,
  };

  try {
    simSetProgress(30, 'Computing similarity…');
    const res  = await fetch('/api/similarity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }
    const data = await res.json();
    simSetProgress(90, 'Rendering results…');
    SIM.result = data;

    // Save to session history
    simSaveToHistory(data);

    setTimeout(() => {
      simShowProgress(false);
      simGoTo(5);
      simRenderResults(data);
      if (btn) { btn.disabled = false; btn.textContent = '▶ Run Similarity'; }
    }, 400);

  } catch(e) {
    simShowProgress(false);
    showToast('Error: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '▶ Run Similarity'; }
  }
}

function simShowProgress(show) {
  const el = document.getElementById('sim-progress-wrap');
  if (el) el.style.display = show ? '' : 'none';
}

function simSetProgress(pct, label) {
  const fill  = document.getElementById('sim-progress-fill');
  const lbl   = document.getElementById('sim-phase-label');
  const pctEl = document.getElementById('sim-pct-label');
  if (fill)  fill.style.width  = pct + '%';
  if (lbl)   lbl.textContent   = label;
  if (pctEl) pctEl.textContent = pct + '%';
}

/* ─────────────────────────────────────────────────────────────────
   Step 5: Results rendering
───────────────────────────────────────────────────────────────── */
function simRenderResults(data) {
  if (SIM.mode === 'pairwise') {
    simRenderPairwiseResults(data);
    document.getElementById('sim-results-pairwise')?.style && (document.getElementById('sim-results-pairwise').style.display = '');
    document.getElementById('sim-results-onevall')?.style  && (document.getElementById('sim-results-onevall').style.display  = 'none');
  } else {
    simRenderOneVsAllResults(data);
    document.getElementById('sim-results-pairwise')?.style && (document.getElementById('sim-results-pairwise').style.display = 'none');
    document.getElementById('sim-results-onevall')?.style  && (document.getElementById('sim-results-onevall').style.display  = '');
  }
}

function simRenderPairwiseResults(data) {
  const countries = data.countries || [];
  const scores    = data.scores    || {};

  // Score panel
  const scorePanel = document.getElementById('sim-score-panel');
  if (scorePanel) {
    const struct = scores.structural ?? null;
    const sem    = scores.semantic   ?? null;
    const comb   = scores.combined   ?? null;
    const main   = comb ?? struct ?? sem ?? 0;

    scorePanel.innerHTML = `
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:56px;font-weight:700;font-family:'JetBrains Mono';" class="text-gradient">
          ${(main * 100).toFixed(1)}<span style="font-size:28px;font-weight:400;">%</span>
        </div>
        <div style="font-size:13px;color:var(--muted-foreground);margin-top:4px;">
          Overall Similarity
        </div>
      </div>
      ${struct !== null ? `
      <div style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">
          <span>Structural (TED)</span>
          <span style="font-family:'JetBrains Mono';color:var(--primary);">${(struct*100).toFixed(1)}%</span>
        </div>
        <div class="score-bar-wrap"><div class="score-bar-fill" style="width:${struct*100}%;"></div></div>
      </div>` : ''}
      ${sem !== null ? `
      <div style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">
          <span>Semantic (Jaccard)</span>
          <span style="font-family:'JetBrains Mono';color:var(--primary);">${(sem*100).toFixed(1)}%</span>
        </div>
        <div class="score-bar-wrap"><div class="score-bar-fill" style="width:${sem*100}%;"></div></div>
      </div>` : ''}
      ${comb !== null ? `
      <div style="margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">
          <span>Combined (α=${SIM.alpha.toFixed(2)})</span>
          <span style="font-family:'JetBrains Mono';color:var(--primary);">${(comb*100).toFixed(1)}%</span>
        </div>
        <div class="score-bar-wrap"><div class="score-bar-fill" style="width:${comb*100}%;"></div></div>
      </div>` : ''}
      <div style="margin-top:20px;text-align:center;font-size:12px;color:var(--muted-foreground);">
        ${countries.join(' ↔ ')}
      </div>
    `;
  }

  // Tree diff tab
  const treeDiffEl = document.getElementById('sim-tab-tree-diff');
  if (treeDiffEl && data.edit_script) {
    treeDiffEl.innerHTML = `<div style="font-size:13px;color:var(--muted-foreground);margin-bottom:12px;">
        Edit distance: <strong style="color:var(--foreground);">${data.edit_distance ?? '—'}</strong> operations
      </div>` +
      renderEditScript(data.edit_script);
  }

  // Edit script tab
  const scriptEl = document.getElementById('sim-tab-edit-script');
  if (scriptEl && data.edit_script) {
    scriptEl.innerHTML = `<pre style="font-family:'JetBrains Mono';font-size:11px;
      color:var(--muted-foreground);background:var(--muted);padding:16px;
      border-radius:0.5rem;overflow-x:auto;max-height:380px;overflow-y:auto;white-space:pre-wrap;">${
      escHtml(JSON.stringify(data.edit_script, null, 2))
    }</pre>`;
  }

  // Field level tab
  const fieldEl = document.getElementById('sim-tab-field-level');
  if (fieldEl && data.field_scores) {
    fieldEl.innerHTML = renderFieldScores(data.field_scores);
  }

  // Tokens tab
  const tokEl = document.getElementById('sim-tab-tokens');
  if (tokEl && data.token_analysis) {
    tokEl.innerHTML = renderTokenAnalysis(data.token_analysis);
  }
}

function renderEditScript(ops) {
  if (!ops || !ops.length) return '<p style="color:var(--muted-foreground);font-size:13px;">No edit operations.</p>';
  const COLORS = { insert: 'oklch(0.75 0.22 130)', delete: 'oklch(0.7 0.25 320)', rename: 'oklch(0.8 0.2 60)' };
  return `<div style="font-family:'JetBrains Mono';font-size:12px;line-height:1.9;max-height:340px;overflow-y:auto;">` +
    ops.map(op => {
      const color = COLORS[op.op] || 'var(--muted-foreground)';
      const icon  = op.op === 'insert' ? '＋' : op.op === 'delete' ? '－' : '≈';
      return `<div class="edit-op" data-op="${op.op}" style="color:${color};">
        <span>${icon}</span>
        <span style="opacity:0.7;">[${op.op}]</span>
        ${escHtml(op.node || op.from || '')}
        ${op.to ? `<span style="opacity:0.5;"> → </span>${escHtml(op.to)}` : ''}
        ${op.cost !== undefined ? `<span style="opacity:0.4;margin-left:6px;">(cost ${op.cost})</span>` : ''}
      </div>`;
    }).join('') +
    '</div>';
}

function renderFieldScores(fields) {
  if (!fields || !Object.keys(fields).length)
    return '<p style="color:var(--muted-foreground);font-size:13px;">No field data.</p>';
  return Object.entries(fields).map(([section, score]) => {
    const pct = (score * 100).toFixed(1);
    return `<div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">
        <span style="font-weight:500;">${escHtml(section)}</span>
        <span style="font-family:'JetBrains Mono';color:var(--primary);">${pct}%</span>
      </div>
      <div class="score-bar-wrap"><div class="score-bar-fill" style="width:${pct}%;"></div></div>
    </div>`;
  }).join('');
}

function renderTokenAnalysis(ta) {
  if (!ta) return '<p style="color:var(--muted-foreground);font-size:13px;">No token data.</p>';
  const { shared = [], only_a = [], only_b = [], jaccard = 0 } = ta;
  return `
    <div style="margin-bottom:16px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px;">
        Jaccard: <span style="color:var(--primary);font-family:'JetBrains Mono';">${(jaccard*100).toFixed(1)}%</span>
        <span style="font-size:11px;color:var(--muted-foreground);margin-left:8px;">
          (${shared.length} shared / ${shared.length + only_a.length + only_b.length} total unique)
        </span>
      </div>
    </div>
    <div style="margin-bottom:14px;">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;
        color:oklch(0.75 0.22 130);margin-bottom:8px;">Shared tokens (${shared.length})</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">
        ${shared.slice(0,80).map(t => `<span class="token-pill shared">${escHtml(t)}</span>`).join('')}
        ${shared.length > 80 ? `<span style="color:var(--muted-foreground);font-size:11px;align-self:center;">+${shared.length-80} more</span>` : ''}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;
          color:var(--primary);margin-bottom:8px;">Only in A (${only_a.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          ${only_a.slice(0,40).map(t => `<span class="token-pill only-a">${escHtml(t)}</span>`).join('')}
          ${only_a.length > 40 ? `<span style="color:var(--muted-foreground);font-size:11px;">+${only_a.length-40}</span>` : ''}
        </div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;
          color:var(--secondary);margin-bottom:8px;">Only in B (${only_b.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          ${only_b.slice(0,40).map(t => `<span class="token-pill only-b">${escHtml(t)}</span>`).join('')}
          ${only_b.length > 40 ? `<span style="color:var(--muted-foreground);font-size:11px;">+${only_b.length-40}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function simRenderOneVsAllResults(data) {
  const results = data.results || []; // [{name, structural, semantic, combined, rank}]

  // Ranked list
  const listEl = document.getElementById('sim-onevall-list');
  if (listEl) {
    if (!results.length) {
      listEl.innerHTML = '<p style="color:var(--muted-foreground);font-size:13px;">No results.</p>';
    } else {
      listEl.innerHTML = results.map((r, i) => {
        const score = r.combined ?? r.structural ?? r.semantic ?? 0;
        const pct   = (score * 100).toFixed(1);
        return `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;
          border-radius:0.5rem;margin-bottom:6px;background:var(--card);border:1px solid var(--border);
          transition:background 0.1s;" onmouseover="this.style.background='oklch(0.78 0.18 200/0.07)'"
          onmouseout="this.style.background='var(--card)'">
          <span style="font-family:'JetBrains Mono';font-size:12px;color:var(--muted-foreground);
            min-width:24px;text-align:right;">${i+1}</span>
          <span style="flex:1;font-size:13px;font-weight:500;">${escHtml(r.name)}</span>
          <div class="score-bar-wrap" style="width:120px;margin:0;">
            <div class="score-bar-fill" style="width:${pct}%;"></div>
          </div>
          <span style="font-family:'JetBrains Mono';font-size:12px;color:var(--primary);min-width:44px;text-align:right;">${pct}%</span>
        </div>`;
      }).join('');
    }
  }

  // Heatmap Leaflet
  simInitResultMap(data);
}

function simInitResultMap(data) {
  const mapEl = document.getElementById('sim-result-map');
  if (!mapEl) return;

  if (SIM.resultMap) {
    SIM.resultMap.remove();
    SIM.resultMap = null;
  }

  SIM.resultMap = L.map('sim-result-map', { zoomControl: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 19,
  }).addTo(SIM.resultMap);

  const results  = data.results || [];
  const maxScore = Math.max(...results.map(r => r.combined ?? r.structural ?? r.semantic ?? 0), 0.001);

  results.forEach(r => {
    const score = r.combined ?? r.structural ?? r.semantic ?? 0;
    const norm  = score / maxScore;
    const hue   = Math.round(norm * 200); // 0=red..200=teal
    const color = `hsl(${hue},80%,55%)`;
    if (r.lat && r.lng) {
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 8 + norm * 8,
        fillColor: color,
        color: '#fff',
        weight: 1,
        fillOpacity: 0.85,
      }).addTo(SIM.resultMap);
      marker.bindPopup(`<strong>${escHtml(r.name)}</strong><br/>Similarity: ${(score*100).toFixed(1)}%`);
      SIM.resultMarkers.push(marker);
    }
  });
}

/* ─────────────────────────────────────────────────────────────────
   Session history
───────────────────────────────────────────────────────────────── */
function simSaveToHistory(data) {
  try {
    const history = JSON.parse(sessionStorage.getItem('similica_history') || '[]');
    const title   = SIM.mode === 'pairwise'
      ? SIM.selected.join(' ↔ ')
      : `${SIM.selected[0]} vs All`;
    const scores  = data.scores || {};
    const main    = scores.combined ?? scores.structural ?? scores.semantic ?? null;
    const summary = main !== null
      ? `${(main*100).toFixed(1)}% similarity · ${SIM.simType}`
      : `${SIM.simType} analysis`;

    history.push({
      type: 'similarity',
      title,
      summary,
      timestamp: new Date().toISOString(),
      data,
    });
    sessionStorage.setItem('similica_history', JSON.stringify(history));
  } catch(e) {
    console.warn('Could not save to history', e);
  }
}

function simSaveResult() {
  if (!SIM.result) return;
  try {
    const saved = JSON.parse(localStorage.getItem('similica_saved') || '[]');
    const title = SIM.mode === 'pairwise' ? SIM.selected.join(' ↔ ') : `${SIM.selected[0]} vs All`;
    saved.push({
      type: 'similarity',
      title,
      summary: `${SIM.simType} analysis`,
      timestamp: new Date().toISOString(),
      data: SIM.result,
    });
    localStorage.setItem('similica_saved', JSON.stringify(saved));
    showToast('Result saved!', 'success');
  } catch(e) {
    showToast('Could not save result', 'error');
  }
}

function simExportJSON() {
  if (!SIM.result) return;
  const blob = new Blob([JSON.stringify(SIM.result, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `similica_similarity_${SIM.selected.join('_').replace(/\s+/g,'_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function simNewAnalysis() {
  SIM.step      = 0;
  SIM.mode      = null;
  SIM.simType   = null;
  SIM.selected  = [];
  SIM.result    = null;
  simGoTo(0);
  // Clear selections
  document.querySelectorAll('[data-mode],[data-sim-type]').forEach(el => el.classList.remove('selected'));
  simRenderSelectedTags();
}
