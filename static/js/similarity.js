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
  coordLookup: {},  // {name: [lat, lng]} for the map markers
  map: null,
  markers: [],      // Leaflet marker layer for selected countries (step 2 map)
  result: null,
  resultMap: null,
  resultMarkers: [],

  // ── Patching playback state ─────────────────────────────────────
  patching: null,        // backend bundle: {steps, source_doc, target_doc, artifacts, ...}
  patchStep: 0,          // current step index
  patchPlaying: false,
  patchTimer: null,
  patchStepDelayMs: 700, // delay between auto-steps

  // ── One-vs-all drill-in state ───────────────────────────────────
  onevallData: null,     // the 1vAll API response we came from
  drillData:   null,     // active pairwise drill-in response, if any

  // ── Label picker state ──────────────────────────────────────────
  // labels[section] = { enabled: bool, fields: { fieldName: bool } }
  // The section bool is the master toggle; field bools are the drill-in.
  labels: null,          // populated by simInitLabels()
  expandedLabelSections: new Set(),
};

const STEP_TITLES = [
  'Select Mode',
  'Similarity Type',
  'Select Countries',
  'Select Labels',
  'Review Documents',
  'Compute',
  'Results',
];

/* Schema for the "Select Labels" step.  Top-level sections + their leaf
   labels. Keep these in sync with ted/tree_builder.py.  Anything listed
   here can be excluded from the TED tree / Jaccard tokens. */
const LABEL_SCHEMA = {
  general:    ['capital', 'demonym', 'official_language', 'religion', 'ethnic_groups'],
  government: ['type', 'legislature', 'lower_house', 'upper_house'],
  economy:    ['currency_code', 'gdp_ppp', 'gdp_nominal', 'gini', 'hdi'],
  population: ['total', 'density_per_km2'],
  area:       ['total_km2', 'water_pct', 'rank'],
  codes:      ['calling_code', 'internet_tld', 'iso_3166_code'],
  time:       ['timezone_utc', 'timezone_dst'],
  history:    [],
};
const LABEL_SECTIONS = Object.keys(LABEL_SCHEMA);

/* ─────────────────────────────────────────────────────────────────
   Bootstrap
───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Always preload the country list — needed for both fresh runs and
  // for restoring documents when a saved/recent result is opened.
  simLoadCountries();

  if (simMaybeRestorePending()) return;
  simGoTo(0);
});

/* If saved.html / results.html stashed a result under
   sessionStorage["similica_pending_view"], skip the wizard, restore the
   selection state, and render the result panel directly. */
function simMaybeRestorePending() {
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem('similica_pending_view') || 'null'); }
  catch (e) { pending = null; }
  if (!pending || pending.type !== 'similarity' || !pending.data) return false;

  sessionStorage.removeItem('similica_pending_view');
  const data = pending.data;

  // Restore wizard state from the saved API response.
  // Backend returns mode as "1v1" / "1vall"; the UI uses "pairwise" / "one_vs_all".
  SIM.mode    = data.mode === '1vall' ? 'one_vs_all' : 'pairwise';
  SIM.simType = data.type   || 'structural';
  SIM.alpha   = (typeof data.alpha === 'number') ? data.alpha : 0.5;
  SIM.selected = Array.isArray(data.countries) ? data.countries.slice() : [];
  SIM.result   = data;

  simGoTo(6);
  simRenderResults(data);
  showToast('Restored saved result', 'success');
  return true;
}

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
    if (n === 6) {
      nextBtn.style.display = 'none';        // Results page — no Next
    } else if (n === 5) {
      nextBtn.style.display = 'none';        // Compute page — Run button drives it
    } else {
      nextBtn.style.display = '';
      nextBtn.textContent = (n === 3 || n === 4) ? 'Continue →' : 'Next →';
    }
  }

  // Step-specific init
  if (n === 1) simSelectType('structural');   // single option — auto-select on entry
  if (n === 2) simInitMap();
  if (n === 3) simRenderLabelsPanel();
  if (n === 4) simLoadDocReview();
  if (n === 5) simRenderRunSummary();
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
  if (n === 3) {
    const anySection = LABEL_SECTIONS.some(s => SIM.labels && SIM.labels[s] && SIM.labels[s].enabled);
    if (!anySection) {
      showToast('At least one section must be included in the comparison.', 'error');
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
  // Trim a stale selection if the new mode is stricter than the old one.
  const cap = mode === 'one_vs_all' ? 1 : 2;
  if (SIM.selected.length > cap) {
    SIM.selected = SIM.selected.slice(0, cap);
    simRenderSelectedTags();
    simFilterCountries();
    simUpdateMapHighlights();
  }
}

/* ─────────────────────────────────────────────────────────────────
   Step 1: Type selection
───────────────────────────────────────────────────────────────── */
function simSelectType(type) {
  // Only structural is supported now — keep the function for the click
  // handler in case the user clicks the single card, but force the value.
  SIM.simType = 'structural';
  document.querySelectorAll('[data-sim-type]').forEach(el => {
    el.classList.toggle('selected', el.dataset.simType === 'structural');
  });
}

// Alpha is no longer user-facing (no Combined option); kept as a stub so
// any legacy call sites don't blow up.
function simUpdateAlpha(_val) {}

/* ─────────────────────────────────────────────────────────────────
   Step 2: Country selection
───────────────────────────────────────────────────────────────── */
async function simLoadCountries() {
  try {
    const res  = await fetch('/api/countries');
    const data = await res.json();
    const raw  = data.countries || [];

    // Keep names only for the list/search, but build a coord lookup for the map.
    SIM.allCountries = raw.map(c => (typeof c === 'string' ? c : c.name));
    SIM.coordLookup  = {};
    raw.forEach(c => {
      if (typeof c === 'object' && c.lat != null && c.lng != null) {
        SIM.coordLookup[c.name] = [c.lat, c.lng];
      }
    });
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
    if (SIM.mode === 'one_vs_all' && SIM.selected.length >= 1) {
      showToast('One-vs-All mode takes exactly 1 source country. Remove the current one first.', 'error');
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
  if (SIM.map) {
    // map already exists — Leaflet sometimes mis-sizes when the container was hidden
    setTimeout(() => SIM.map.invalidateSize(), 60);
    simUpdateMapHighlights();
    return;
  }
  SIM.map = L.map('sim-map', { zoomControl: true }).setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 19,
  }).addTo(SIM.map);
  // Render any markers that already exist (e.g. user returned to step 2).
  setTimeout(() => SIM.map.invalidateSize(), 60);
  simUpdateMapHighlights();
}

/* Drop existing markers, then drop a labelled pin for every selected country
   we have coordinates for, and fit the view to encompass them. */
function simUpdateMapHighlights() {
  if (!SIM.map) return;

  (SIM.markers || []).forEach(m => SIM.map.removeLayer(m));
  SIM.markers = [];

  const pts = [];
  SIM.selected.forEach((name, idx) => {
    const coord = SIM.coordLookup[name];
    if (!coord) return;
    const [lat, lng] = coord;
    pts.push([lat, lng]);

    // Source = first selected (in pairwise mode); use a different colour.
    const isSource = SIM.mode === 'pairwise' && idx === 0;
    const fill     = isSource ? '#a855f7' /* secondary */ : '#22d3ee' /* primary */;

    const marker = L.circleMarker([lat, lng], {
      radius: 8,
      color: '#fff', weight: 1.5,
      fillColor: fill, fillOpacity: 0.9,
    }).addTo(SIM.map);

    marker.bindTooltip(`${name}${isSource ? ' · source' : ''}`, {
      permanent: true, direction: 'top', offset: [0, -8],
      className: 'sim-map-tooltip',
    });
    marker.bindPopup(`<strong>${name}</strong>${isSource ? '<br/><em>source</em>' : ''}`);
    marker.on('click', () => simToggleCountry(name));

    SIM.markers.push(marker);
  });

  if (pts.length >= 2) {
    SIM.map.fitBounds(L.latLngBounds(pts).pad(0.4));
  } else if (pts.length === 1) {
    SIM.map.setView(pts[0], 4);
  }
}

/* ─────────────────────────────────────────────────────────────────
   Step 3: Select Labels
───────────────────────────────────────────────────────────────── */

/* Initialise SIM.labels from LABEL_SCHEMA with everything enabled. Called
   the first time the user enters step 3 (or via simLabelsReset / new analysis). */
function simInitLabels() {
  const labels = {};
  for (const section of LABEL_SECTIONS) {
    const fields = {};
    for (const f of LABEL_SCHEMA[section]) fields[f] = true;
    labels[section] = { enabled: true, fields };
  }
  SIM.labels = labels;
}

/* Render the step-3 panel. Builds 8 cards (one per section) with a
   master checkbox and a collapsible drill-in of leaf fields. */
function simRenderLabelsPanel() {
  if (!SIM.labels) simInitLabels();
  const wrap = document.getElementById('sim-labels-panel');
  if (!wrap) return;

  wrap.innerHTML = LABEL_SECTIONS.map(section => {
    const entry      = SIM.labels[section];
    const fieldNames = LABEL_SCHEMA[section];
    const onCount    = fieldNames.filter(f => entry.fields[f]).length;
    const total      = fieldNames.length;

    // Tri-state checkbox: on / off / indeterminate
    let cbCls = 'sim-label-checkbox';
    let cbMark = '';
    if (entry.enabled && (total === 0 || onCount === total)) {
      cbCls += ' on'; cbMark = '✓';
    } else if (entry.enabled && onCount > 0) {
      cbCls += ' indeterminate'; cbMark = '–';
    }

    const expanded = SIM.expandedLabelSections.has(section);
    const cardCls  = `sim-label-card ${entry.enabled ? 'included' : 'excluded'}${expanded ? ' expanded' : ''}`;
    const arrow    = total > 0 ? '▸' : '';
    const count    = total > 0 ? `${onCount}/${total} fields` : '— no drill-in —';

    const fieldsBlock = total > 0 ? `
      <div class="sim-label-card-body">
        ${fieldNames.map(f => {
          const isOn = entry.enabled && entry.fields[f];
          return `<div class="sim-label-leaf ${isOn ? '' : 'excluded'}"
            onclick="event.stopPropagation();simLabelsToggleField('${section}','${f}')">
            <span class="sim-label-checkbox ${isOn ? 'on' : ''}">${isOn ? '✓' : ''}</span>
            <span class="sim-label-leaf-name">${f}</span>
          </div>`;
        }).join('')}
      </div>` : '';

    return `<div class="${cardCls}" data-section="${section}">
      <div class="sim-label-card-head"
           onclick="simLabelsToggleExpand('${section}')">
        <span class="${cbCls}"
              onclick="event.stopPropagation();simLabelsToggleSection('${section}')">${cbMark}</span>
        <span class="sim-label-card-title">${section}</span>
        <span class="sim-label-card-count">${count}</span>
        ${arrow ? `<span class="sim-label-card-arrow">${arrow}</span>` : ''}
      </div>
      ${fieldsBlock}
    </div>`;
  }).join('');

  simLabelsUpdateSummary();
}

function simLabelsUpdateSummary() {
  const summary = document.getElementById('sim-label-summary');
  if (!summary) return;
  const onSections = LABEL_SECTIONS.filter(s => SIM.labels[s].enabled);
  const totalFields = LABEL_SECTIONS.reduce((sum, s) => sum + LABEL_SCHEMA[s].length, 0);
  const onFields = LABEL_SECTIONS.reduce((sum, s) => {
    if (!SIM.labels[s].enabled) return sum;
    return sum + LABEL_SCHEMA[s].filter(f => SIM.labels[s].fields[f]).length;
  }, 0);
  summary.textContent = `${onSections.length} / ${LABEL_SECTIONS.length} sections · ${onFields} / ${totalFields} fields`;
}

function simLabelsToggleExpand(section) {
  if (LABEL_SCHEMA[section].length === 0) return;
  if (SIM.expandedLabelSections.has(section)) SIM.expandedLabelSections.delete(section);
  else SIM.expandedLabelSections.add(section);
  simRenderLabelsPanel();
}

function simLabelsToggleSection(section) {
  const entry = SIM.labels[section];
  // If currently on (any state), flip everything off; if off, flip all fields on.
  const newOn = !entry.enabled || LABEL_SCHEMA[section].some(f => !entry.fields[f]) === false
                ? !entry.enabled
                : true;
  // Simplified: hard toggle — enabled controls everything, fields all match.
  entry.enabled = !entry.enabled;
  for (const f of LABEL_SCHEMA[section]) entry.fields[f] = entry.enabled;
  simRenderLabelsPanel();
}

function simLabelsToggleField(section, field) {
  const entry = SIM.labels[section];
  entry.fields[field] = !entry.fields[field];
  // Auto-update section enabled flag based on whether any field is on
  entry.enabled = LABEL_SCHEMA[section].some(f => entry.fields[f]);
  simRenderLabelsPanel();
}

function simLabelsSelectAll() {
  for (const s of LABEL_SECTIONS) {
    SIM.labels[s].enabled = true;
    for (const f of LABEL_SCHEMA[s]) SIM.labels[s].fields[f] = true;
  }
  simRenderLabelsPanel();
}

function simLabelsClearAll() {
  for (const s of LABEL_SECTIONS) {
    SIM.labels[s].enabled = false;
    for (const f of LABEL_SCHEMA[s]) SIM.labels[s].fields[f] = false;
  }
  simRenderLabelsPanel();
}

function simLabelsReset() {
  simInitLabels();
  SIM.expandedLabelSections.clear();
  simRenderLabelsPanel();
}

/* Build the flat excluded-labels list that goes into the API payload. */
function simBuildExcludedLabels() {
  if (!SIM.labels) return [];
  const excluded = [];
  for (const section of LABEL_SECTIONS) {
    const entry = SIM.labels[section];
    if (!entry.enabled) {
      // Whole section out — emit the section label.
      excluded.push(section);
      continue;
    }
    for (const f of LABEL_SCHEMA[section]) {
      if (!entry.fields[f]) excluded.push(f);
    }
  }
  return excluded;
}

/* ─────────────────────────────────────────────────────────────────
   Step 4: Document review
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
    // init tabs within each card (scoped: each card has its own active tab)
    panel.querySelectorAll('.tabs-list').forEach(tabList => {
      const triggers = tabList.querySelectorAll('.tab-trigger');
      triggers.forEach(t => {
        t.addEventListener('click', () => {
          const parent = t.closest('.doc-card-inner');
          parent.querySelectorAll('.tab-trigger').forEach(x => x.classList.remove('active'));
          parent.querySelectorAll('.tab-content').forEach(x => x.style.display = 'none');
          t.classList.add('active');
          const target = parent.querySelector(`#${t.dataset.tab}`);
          // 'block' (not '') so the base.html `.tab-content { display: none; }`
          // class rule doesn't re-win after we clear the inline override.
          if (target) target.style.display = 'block';
        });
      });
    });
  } catch(e) {
    panel.innerHTML = `<div style="color:red;padding:20px;">Error loading document: ${e.message}</div>`;
  }
}

function renderDocCard(doc, idx) {
  const name     = doc.name || `Country ${idx + 1}`;
  const json     = JSON.stringify(doc.data || {}, null, 2);
  const excluded = new Set(simBuildExcludedLabels());
  const treeHtml = renderTreeInspector(doc.data || {}, excluded);
  const cardId   = `doc-card-${idx}`;

  // Show a tiny banner at the top of each card so the user can see which
  // labels are currently excluded from the comparison.
  const excludedBanner = excluded.size > 0
    ? `<div style="margin-bottom:12px;padding:8px 12px;border-radius:0.5rem;
          background:oklch(0.82 0.17 80 / 0.08);border:1px solid oklch(0.82 0.17 80 / 0.25);
          font-size:11px;font-family:'JetBrains Mono';color:var(--muted-foreground);">
        <span style="color:var(--warning);font-weight:700;">EXCLUDED:</span>
        ${[...excluded].map(l => `<span style="text-decoration:line-through;margin:0 4px;">${escHtml(l)}</span>`).join('')}
      </div>`
    : '';

  return `<div class="doc-card-inner card glass" style="border-radius:1rem;margin-bottom:20px;padding:16px;" id="${cardId}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <span class="badge badge-primary">${escHtml(name)}</span>
      <span style="font-size:12px;color:var(--muted-foreground);">Tree nodes: ${doc.tree_size ?? '—'}</span>
    </div>
    ${excludedBanner}
    <div class="tabs-list" style="margin-bottom:14px;">
      <button class="tab-trigger active" data-tab="doc-rendered-${idx}">Rendered</button>
      <button class="tab-trigger" data-tab="doc-json-${idx}">JSON</button>
      <button class="tab-trigger" data-tab="doc-tree-${idx}">Tree Inspector</button>
    </div>
    <div id="doc-rendered-${idx}" class="tab-content" style="display:block;">
      ${renderInfoboxRendered(doc.data || {}, name, excluded)}
    </div>
    <div id="doc-json-${idx}" class="tab-content" style="display:none;">
      <pre style="font-family:'JetBrains Mono';font-size:11px;color:var(--muted-foreground);
        background:var(--muted);padding:16px;border-radius:0.5rem;overflow-x:auto;
        max-height:380px;overflow-y:auto;white-space:pre-wrap;">${escHtml(json)}</pre>
    </div>
    <div id="doc-tree-${idx}" class="tab-content" style="display:none;">
      <div style="font-family:'JetBrains Mono';font-size:12px;line-height:1.9;
        max-height:380px;overflow-y:auto;padding:12px;background:var(--muted);border-radius:0.5rem;">${treeHtml}</div>
    </div>
  </div>`;
}

/* ─────────────────────────────────────────────────────────────────
   Wikipedia-style infobox renderer
───────────────────────────────────────────────────────────────── */
function renderInfoboxRendered(data, countryName, excluded = new Set()) {
  if (!data || typeof data !== 'object')
    return '<p style="color:var(--muted-foreground)">No data</p>';

  const fmt = {
    txt:     v => (v === null || v === undefined || v === '' || v === -1) ? '—' : String(v),
    big:     v => (v === null || v === undefined || v === -1) ? '—' : Number(v).toLocaleString(),
    money:   v => (v === null || v === undefined || v === -1) ? '—' : '$' + Math.round(Number(v)).toLocaleString(),
    moneyB:  v => (v === null || v === undefined || v === -1) ? '—' : '$' + Number(v).toFixed(1) + ' B',
    pct:     v => (v === null || v === undefined || v === -1) ? '—' : Number(v).toFixed(2).replace(/\.?0+$/, '') + '%',
    dec3:    v => (v === null || v === undefined || v === -1) ? '—' : Number(v).toFixed(3),
  };

  const code = data.codes?.iso_3166_code || '';
  const flag = code.length === 2
    ? String.fromCodePoint(
        0x1F1E6 + code.charCodeAt(0) - 65,
        0x1F1E6 + code.charCodeAt(1) - 65)
    : '🌐';

  // Each section/row carries its label key so the renderer can match it
  // against the excluded set and dim accordingly.
  const sections = [
    { title: 'General', key: 'general',
      rows: [
        ['Capital',            'capital',            fmt.txt(data.general?.capital)],
        ['Largest city',       'largest_city',       fmt.txt(data.general?.largest_city)],
        ['Official language',  'official_language',  fmt.txt(data.general?.official_language)],
        ['Regional languages', 'regional_languages', fmt.txt(data.general?.regional_languages)],
        ['Demonym',            'demonym',            fmt.txt(data.general?.demonym)],
      ],
    },
    { title: 'Codes', key: 'codes',
      rows: [
        ['ISO 3166',     'iso_3166_code', fmt.txt(data.codes?.iso_3166_code)],
        ['Calling code', 'calling_code',  fmt.txt(data.codes?.calling_code)],
        ['Internet TLD', 'internet_tld',  fmt.txt(data.codes?.internet_tld)],
      ],
    },
    { title: 'Government', key: 'government',
      rows: [
        ['Type',        'type',        fmt.txt(data.government?.type)],
        ['Legislature', 'legislature', fmt.txt(data.government?.legislature)],
        ['Lower house', 'lower_house', fmt.txt(data.government?.lower_house)],
        ['Upper house', 'upper_house', fmt.txt(data.government?.upper_house)],
      ],
    },
    { title: 'Area', key: 'area',
      rows: [
        ['Total',     'total_km2',
          data.area?.total_km2 != null && data.area.total_km2 !== -1
            ? fmt.big(data.area.total_km2) + ' km²' : '—'],
        ['Water',     'water_pct',
          data.area?.water_pct != null && data.area.water_pct !== -1
            ? fmt.pct(data.area.water_pct) : '—'],
        ['Area rank', 'rank', fmt.txt(data.area?.rank)],
      ],
    },
    { title: 'Economy', key: 'economy',
      rows: [
        ['Currency',                'currency_code', fmt.txt(data.economy?.currency_code)],
        ['GDP (PPP, total)',        'gdp_ppp',       fmt.moneyB(data.economy?.gdp_ppp?.total_billion_usd)],
        ['GDP (PPP) per capita',    'gdp_ppp',       fmt.money(data.economy?.gdp_ppp?.per_capita_usd)],
        ['GDP (nominal, total)',    'gdp_nominal',   fmt.moneyB(data.economy?.gdp_nominal?.total_billion_usd)],
        ['GDP (nominal) per capita','gdp_nominal',   fmt.money(data.economy?.gdp_nominal?.per_capita_usd)],
        ['Gini index',              'gini',
          data.economy?.gini?.value != null
            ? fmt.pct(data.economy.gini.value) +
              (data.economy.gini.category ? ` (${data.economy.gini.category})` : '')
            : '—'],
        ['HDI',                     'hdi',
          data.economy?.hdi?.value != null
            ? fmt.dec3(data.economy.hdi.value) +
              (data.economy.hdi.category ? ` (${data.economy.hdi.category})` : '')
            : '—'],
      ],
    },
    { title: 'Population', key: 'population',
      rows: [
        ['Total',   'total', fmt.big(data.population?.total)],
        ['Density', 'density_per_km2',
          data.population?.density_per_km2 != null && data.population.density_per_km2 > 0
            ? fmt.big(data.population.density_per_km2) + ' / km²' : '—'],
      ],
    },
    { title: 'Time', key: 'time',
      rows: [
        ['Timezone (UTC)', 'timezone_utc', fmt.txt(data.time?.timezone_utc)],
        ['Timezone (DST)', 'timezone_dst', fmt.txt(data.time?.timezone_dst)],
      ],
    },
  ];

  const religionDist = data.general?.religion?.groups;
  const ethnicDist   = data.general?.ethnic_groups?.groups;

  return `
    <div style="border:1px solid var(--border);border-radius:0.75rem;overflow:hidden;
                background:linear-gradient(180deg, oklch(0.22 0.04 260 / 0.6), oklch(0.18 0.03 260 / 0.4));">

      <div style="text-align:center;padding:20px 16px;
                  background:linear-gradient(135deg, oklch(0.78 0.18 200 / 0.18), oklch(0.7 0.25 320 / 0.12));
                  border-bottom:1px solid var(--border);">
        <div style="font-size:46px;line-height:1;margin-bottom:8px;">${flag}</div>
        <div style="font-family:'Space Grotesk';font-size:22px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">
          ${escHtml(countryName || data.country || '')}
        </div>
        ${code ? `<div style="font-family:'JetBrains Mono';font-size:11px;color:var(--muted-foreground);margin-top:4px;">
          ${escHtml(code)}  ·  ${escHtml(data.codes?.calling_code || '')}  ·  ${escHtml(data.codes?.internet_tld || '')}
        </div>` : ''}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
        ${sections.map((s, i) => renderInfoboxSection(s, i, sections.length, excluded)).join('')}
      </div>

      ${religionDist ? renderDistributionBlock('Religion', religionDist, excluded.has('general') || excluded.has('religion')) : ''}
      ${ethnicDist   ? renderDistributionBlock('Ethnic groups', ethnicDist, excluded.has('general') || excluded.has('ethnic_groups')) : ''}
    </div>
  `;
}

function renderInfoboxSection(section, i, total, excluded = new Set()) {
  if (!section.rows.length) return '';
  const sectionOff = excluded.has(section.key);
  const borderRight  = (i % 2 === 0) ? '1px solid var(--border)' : 'none';
  const borderBottom = (i < total - 1 && i < total - 2) ? '1px solid var(--border)' : 'none';
  const headerColor  = sectionOff ? 'var(--muted-foreground)' : 'var(--primary)';
  const sectionStyle = sectionOff ? 'opacity:0.45;' : '';
  const tag = sectionOff
    ? `<span style="font-family:'Space Grotesk';font-size:9px;color:var(--warning);
        background:oklch(0.82 0.17 80 / 0.15);padding:1px 5px;border-radius:3px;
        margin-left:8px;letter-spacing:0.06em;">EXCLUDED</span>` : '';

  return `
    <div style="padding:14px 16px;border-right:${borderRight};border-bottom:${borderBottom};${sectionStyle}">
      <div style="font-family:'JetBrains Mono';font-size:10px;font-weight:700;
                  letter-spacing:0.1em;text-transform:uppercase;color:${headerColor};
                  margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:6px;
                  display:flex;align-items:center;">
        <span style="${sectionOff ? 'text-decoration:line-through;' : ''}">${escHtml(section.title)}</span>${tag}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        ${section.rows.map(([label, fieldKey, value]) => {
          const fieldOff = sectionOff || excluded.has(fieldKey);
          const isEmpty  = value === '—';
          const valColor = fieldOff ? 'var(--muted-foreground)' : (isEmpty ? 'var(--muted-foreground)' : 'var(--foreground)');
          const rowStyle = fieldOff ? 'opacity:0.55;text-decoration:line-through;' : '';
          return `<tr style="${rowStyle}">
            <td style="padding:3px 0;color:var(--muted-foreground);width:48%;vertical-align:top;
                       font-family:'JetBrains Mono';font-size:11px;">${escHtml(label)}</td>
            <td style="padding:3px 0;color:${valColor};font-weight:500;vertical-align:top;
                       word-break:break-word;">${escHtml(value)}</td>
          </tr>`;
        }).join('')}
      </table>
    </div>
  `;
}

function renderDistributionBlock(title, groups, isExcluded = false) {
  if (!groups || typeof groups !== 'object') return '';
  const entries = Object.entries(groups)
    .filter(([_, v]) => typeof v === 'number')
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';

  const max = Math.max(...entries.map(([_, v]) => v));
  const PALETTE = [
    'oklch(0.78 0.18 200)', 'oklch(0.7 0.25 320)', 'oklch(0.75 0.22 130)',
    'oklch(0.8 0.2 60)',    'oklch(0.7 0.22 20)',  'oklch(0.8 0.18 260)',
    'oklch(0.75 0.2 180)',  'oklch(0.8 0.25 340)',
  ];

  const wrapStyle   = isExcluded ? 'opacity:0.5;' : '';
  const headerColor = isExcluded ? 'var(--muted-foreground)' : 'var(--primary)';
  const tag = isExcluded
    ? `<span style="font-family:'Space Grotesk';font-size:9px;color:var(--warning);
        background:oklch(0.82 0.17 80 / 0.15);padding:1px 5px;border-radius:3px;
        margin-left:8px;letter-spacing:0.06em;">EXCLUDED</span>` : '';

  return `
    <div style="padding:14px 16px;border-top:1px solid var(--border);${wrapStyle}">
      <div style="font-family:'JetBrains Mono';font-size:10px;font-weight:700;
                  letter-spacing:0.1em;text-transform:uppercase;color:${headerColor};
                  margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:6px;
                  display:flex;align-items:center;">
        <span style="${isExcluded ? 'text-decoration:line-through;' : ''}">${escHtml(title)}</span>${tag}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${entries.map(([label, value], i) => {
          const pct  = max > 0 ? (value / max * 100).toFixed(1) : 0;
          const disp = Number(value).toFixed(value % 1 === 0 ? 0 : 1);
          const color = PALETTE[i % PALETTE.length];
          return `<div style="display:grid;grid-template-columns:140px 1fr 50px;align-items:center;gap:10px;font-size:11px;">
            <span style="color:var(--muted-foreground);font-family:'JetBrains Mono';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(label)}</span>
            <div style="height:10px;background:var(--muted);border-radius:5px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:${color};border-radius:5px;transition:width 0.5s;"></div>
            </div>
            <span style="font-family:'JetBrains Mono';color:var(--foreground);text-align:right;">${disp}%</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function renderTreeInspector(data, excluded = new Set(), depth = 0, ancestorExcluded = false) {
  if (typeof data !== 'object' || data === null) {
    return `<span style="color:oklch(0.75 0.22 130);">${escHtml(String(data))}</span>`;
  }
  const indent = '&nbsp;'.repeat(depth * 4);
  const entries = Object.entries(data);
  return entries.map(([k, v]) => {
    const isLeaf      = typeof v !== 'object' || v === null;
    const icon        = isLeaf ? '◦' : '▸';
    const isExcluded  = ancestorExcluded || excluded.has(k);
    const strike      = isExcluded ? 'text-decoration:line-through;opacity:0.45;' : '';
    const mark        = isExcluded ? '<span style="color:var(--warning);font-size:10px;margin-left:6px;">[excluded]</span>' : '';
    const color       = isLeaf ? 'var(--muted-foreground)' : 'var(--foreground)';

    if (isLeaf) {
      return `<div style="${strike}">${indent}<span style="color:${color}">${icon} ${escHtml(k)}</span>: <span style="color:oklch(0.75 0.22 130);">${escHtml(String(v))}</span>${mark}</div>`;
    }
    return `<details ${isExcluded ? '' : 'open'} style="${strike}">
      <summary style="cursor:pointer;list-style:none;">${indent}<span style="color:var(--primary);">▸ ${escHtml(k)}</span>${mark}</summary>
      ${renderTreeInspector(v, excluded, depth + 1, isExcluded)}
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
  set('sim-run-type',    SIM.simType || 'structural');
  set('sim-run-countries', SIM.selected.join(' ↔ '));

  // Surface a tiny label-filter blurb under the summary card so the user
  // sees what got excluded right before pressing Run.
  if (SIM.labels) {
    const excluded = simBuildExcludedLabels();
    const card = document.querySelector('.sim-step-panel[data-step="5"] .card.glass');
    if (card) {
      card.querySelector('.sim-run-labels-line')?.remove();
      const line = document.createElement('div');
      line.className = 'sim-run-labels-line';
      line.style.cssText = 'margin-top:12px;font-size:11px;color:var(--muted-foreground);font-family:\'JetBrains Mono\';';
      line.innerHTML = excluded.length
        ? `Labels excluded (${excluded.length}): <span style="color:var(--foreground);">${excluded.join(', ')}</span>`
        : `All ${LABEL_SECTIONS.length} sections included.`;
      card.appendChild(line);
    }
  }
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
    excluded_labels: simBuildExcludedLabels(),
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
      simGoTo(6);
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
  // Any leftover back-to-leaderboard banner from a previous drill-in
  document.getElementById('sim-back-to-leaderboard')?.remove();
  SIM.drillData = null;

  if (SIM.mode === 'pairwise') {
    SIM.onevallData = null;
    simRenderPairwiseResults(data);
    document.getElementById('sim-results-pairwise')?.style && (document.getElementById('sim-results-pairwise').style.display = '');
    document.getElementById('sim-results-onevall')?.style  && (document.getElementById('sim-results-onevall').style.display  = 'none');
  } else {
    SIM.onevallData = data;
    simRenderOneVsAllResults(data);
    document.getElementById('sim-results-pairwise')?.style && (document.getElementById('sim-results-pairwise').style.display = 'none');
    document.getElementById('sim-results-onevall')?.style  && (document.getElementById('sim-results-onevall').style.display  = '');
  }
}

function simRenderPairwiseResults(data) {
  const countries = data.countries || [];
  const scores    = data.scores    || {};

  // ── Score panel ──────────────────────────────────────────────
  const scorePanel = document.getElementById('sim-score-panel');
  if (scorePanel) {
    const struct = scores.structural ?? null;
    const sem    = scores.semantic   ?? null;
    const comb   = scores.combined   ?? null;
    const main   = comb ?? struct ?? sem ?? 0;

    scorePanel.innerHTML = `
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:48px;font-weight:700;font-family:'JetBrains Mono';" class="text-gradient">
          ${(main * 100).toFixed(1)}<span style="font-size:24px;font-weight:400;">%</span>
        </div>
        <div style="font-size:12px;color:var(--muted-foreground);margin-top:4px;">
          Overall similarity
        </div>
      </div>
      ${struct !== null ? scoreRow('Structural (TED)', struct) : ''}
      ${sem    !== null ? scoreRow('Semantic (Jaccard)', sem)  : ''}
      ${comb   !== null ? scoreRow(`Combined (α=${SIM.alpha.toFixed(2)})`, comb) : ''}
      ${data.edit_distance !== undefined ? `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);font-size:11px;color:var(--muted-foreground);font-family:'JetBrains Mono';">
          TED distance: <span style="color:var(--foreground);font-weight:600;">${data.edit_distance.toFixed(3)}</span><br/>
          Operations: <span style="color:var(--foreground);font-weight:600;">${(data.edit_script||[]).length}</span>
        </div>` : ''}
      <div style="margin-top:14px;text-align:center;font-size:12px;color:var(--muted-foreground);">
        ${countries.join(' ↔ ')}
      </div>
    `;
  }

  // ── Tree diff tab — side-by-side comparison of source vs target ──
  const treeDiffEl = document.getElementById('sim-tab-tree-diff');
  if (treeDiffEl) {
    const src = data.patching?.source_doc || {};
    const tgt = data.patching?.target_doc || {};
    const aName = data.patching?.source_name || countries[0] || 'A';
    const bName = data.patching?.target_name || countries[1] || 'B';
    treeDiffEl.innerHTML = renderTreeDiff(src, tgt, aName, bName);
  }

  // ── Patching tab — step-by-step playback ────────────────────
  const patchEl = document.getElementById('sim-tab-patching');
  if (patchEl) {
    if (data.patching && data.patching.steps && data.patching.steps.length) {
      simInitPatchingTab(data.patching);
    } else {
      patchEl.innerHTML = `<p style="color:var(--muted-foreground);font-size:13px;">
        Patching artifacts are only generated for structural / combined comparisons in pairwise mode.</p>`;
    }
  }

  // ── Edit Script tab ─────────────────────────────────────────
  const scriptEl = document.getElementById('sim-tab-edit-script');
  if (scriptEl) {
    scriptEl.innerHTML = renderEditScriptPanel(data.edit_script || [], data.patching?.artifacts);
  }

  // ── Field Scores tab ────────────────────────────────────────
  const fieldEl = document.getElementById('sim-tab-field-level');
  if (fieldEl) {
    fieldEl.innerHTML = renderFieldScores(data.field_scores || []);
  }

  // ── Tokens tab ──────────────────────────────────────────────
  const tokEl = document.getElementById('sim-tab-tokens');
  if (tokEl) {
    tokEl.innerHTML = renderTokenAnalysis(data.token_analysis);
  }
}

function scoreRow(label, score) {
  const pct = (score * 100).toFixed(1);
  return `<div style="margin-bottom:12px;">
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;">
      <span>${label}</span>
      <span style="font-family:'JetBrains Mono';color:var(--primary);">${pct}%</span>
    </div>
    <div class="score-bar-wrap"><div class="score-bar-fill" style="width:${pct}%;"></div></div>
  </div>`;
}

/* ─────────────────────────────────────────────────────────────────
   Edit script panel
───────────────────────────────────────────────────────────────── */
function renderEditScriptPanel(ops, artifacts) {
  const fileBar = artifacts ? `
    <div class="patch-files-bar" style="margin-bottom:14px;">
      <span class="patch-files-title">Saved to VSCode</span>
      <span class="patch-file-pill">${escHtml(artifacts.folder)}/edit_script.json</span>
      <span class="patch-file-pill">${escHtml(artifacts.folder)}/edit_script.txt</span>
    </div>` : '';

  if (!ops || !ops.length) {
    return fileBar + '<p style="color:var(--muted-foreground);font-size:13px;">No edit operations — trees are identical.</p>';
  }

  const COUNTS = { insert: 0, delete: 0, update: 0 };
  ops.forEach(o => { COUNTS[o.op] = (COUNTS[o.op] || 0) + 1; });

  const counters = `
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
      <span class="badge badge-success">＋ ${COUNTS.insert} insert${COUNTS.insert===1?'':'s'}</span>
      <span class="badge badge-destructive">－ ${COUNTS.delete} delete${COUNTS.delete===1?'':'s'}</span>
      <span class="badge badge-warning">≈ ${COUNTS.update} update${COUNTS.update===1?'':'s'}</span>
    </div>`;

  const opList = ops.map(op => {
    const icon = op.op === 'insert' ? '＋' : op.op === 'delete' ? '－' : '≈';
    const node = escHtml(op.node || '');
    const path = escHtml(op.path || '');
    const fromVal = op.from ? `<span style="opacity:0.6;">${escHtml(op.from)}</span>` : '';
    const toVal   = op.to   ? `<span style="opacity:0.9;color:var(--foreground);">${escHtml(op.to)}</span>` : '';
    const arrow   = (op.from && op.to) ? '<span style="opacity:0.4;margin:0 6px;">→</span>' : '';
    return `<div class="edit-op" data-op="${op.op}">
      <span style="opacity:0.7;">${icon}</span>
      <span style="opacity:0.5;min-width:54px;">[${op.op}]</span>
      <span style="color:var(--primary);min-width:160px;">${path}</span>
      <span style="opacity:0.7;">${node}</span>
      <span style="margin-left:auto;">${fromVal}${arrow}${toVal}</span>
    </div>`;
  }).join('');

  return fileBar + counters +
    `<div style="max-height:420px;overflow-y:auto;border:1px solid var(--border);border-radius:0.5rem;padding:6px;">
      ${opList}
    </div>`;
}

/* ─────────────────────────────────────────────────────────────────
   Field scores (rich array shape from backend)
───────────────────────────────────────────────────────────────── */
function renderFieldScores(fields) {
  if (!fields || !fields.length)
    return '<p style="color:var(--muted-foreground);font-size:13px;">No field data.</p>';

  return `<div style="display:flex;flex-direction:column;gap:14px;">
    ${fields.map(f => {
      const pct = (f.score * 100).toFixed(1);
      const sharedPills = (f.shared || []).slice(0, 12).map(t =>
        `<span class="token-pill shared">${escHtml(t)}</span>`).join('');
      return `<div class="card" style="border-radius:0.6rem;padding:12px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:600;">${escHtml(f.label || f.field)}</span>
          <span style="font-family:'JetBrains Mono';color:var(--primary);font-size:13px;">${pct}%</span>
        </div>
        <div class="score-bar-wrap" style="margin-bottom:8px;"><div class="score-bar-fill" style="width:${pct}%;"></div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;font-family:'JetBrains Mono';color:var(--muted-foreground);margin-bottom:6px;">
          <div><span style="color:var(--secondary);">A:</span> ${escHtml(String(f.a_val))}</div>
          <div><span style="color:var(--success);">B:</span> ${escHtml(String(f.b_val))}</div>
        </div>
        ${sharedPills ? `<div style="margin-top:4px;">${sharedPills}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

/* ─────────────────────────────────────────────────────────────────
   Token analysis
───────────────────────────────────────────────────────────────── */
function renderTokenAnalysis(ta) {
  if (!ta) return '<p style="color:var(--muted-foreground);font-size:13px;">No token data.</p>';
  const { shared = [], only_a = [], only_b = [], jaccard = 0, total_a = 0, total_b = 0 } = ta;
  return `
    <div style="margin-bottom:14px;">
      <div style="font-size:14px;font-weight:600;">
        Jaccard: <span style="color:var(--primary);font-family:'JetBrains Mono';">${(jaccard*100).toFixed(1)}%</span>
        <span style="font-size:11px;color:var(--muted-foreground);margin-left:8px;font-family:'JetBrains Mono';">
          ${shared.length} shared / ${total_a} in A / ${total_b} in B
        </span>
      </div>
    </div>
    <div style="margin-bottom:14px;">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--primary);margin-bottom:6px;">
        Shared tokens (${shared.length})
      </div>
      <div>
        ${shared.slice(0,80).map(t => `<span class="token-pill shared">${escHtml(t)}</span>`).join('')}
        ${shared.length > 80 ? `<span style="color:var(--muted-foreground);font-size:11px;margin-left:6px;">+${shared.length-80}</span>` : ''}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--secondary);margin-bottom:6px;">
          Only in A (${only_a.length})
        </div>
        <div>
          ${only_a.slice(0,40).map(t => `<span class="token-pill only-a">${escHtml(t)}</span>`).join('')}
          ${only_a.length > 40 ? `<span style="color:var(--muted-foreground);font-size:11px;margin-left:6px;">+${only_a.length-40}</span>` : ''}
        </div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--success);margin-bottom:6px;">
          Only in B (${only_b.length})
        </div>
        <div>
          ${only_b.slice(0,40).map(t => `<span class="token-pill only-b">${escHtml(t)}</span>`).join('')}
          ${only_b.length > 40 ? `<span style="color:var(--muted-foreground);font-size:11px;margin-left:6px;">+${only_b.length-40}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

/* ─────────────────────────────────────────────────────────────────
   Tree diff — colour-coded source vs target tree (collapsible)
───────────────────────────────────────────────────────────────── */
function renderTreeDiff(srcObj, tgtObj, aName, bName) {
  const stats = { match: 0, diff: 0, onlyA: 0, onlyB: 0 };

  function diffNode(a, b, depth) {
    const indent = depth * 14;
    const aIsObj = a && typeof a === 'object' && !Array.isArray(a);
    const bIsObj = b && typeof b === 'object' && !Array.isArray(b);

    // Both dicts: recurse over union of keys
    if (aIsObj && bIsObj) {
      const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
      return keys.map(k => {
        const aHas = k in a, bHas = k in b;
        let cls = '', mark = '';
        if (aHas && bHas) {
          // Recurse
          const child = diffNode(a[k], b[k], depth + 1);
          return `<details ${depth < 1 ? 'open' : ''} style="margin-left:${indent}px;">
            <summary style="cursor:pointer;font-size:12px;font-family:'JetBrains Mono';">
              <span style="color:var(--primary);">${escHtml(k)}</span>
            </summary>
            ${child}
          </details>`;
        }
        if (aHas && !bHas) { cls = 'only-a'; mark = '−'; stats.onlyA++; return leafRow(k, a[k], cls, mark, indent); }
        if (!aHas && bHas) { cls = 'only-b'; mark = '+'; stats.onlyB++; return leafRow(k, b[k], cls, mark, indent); }
        return '';
      }).join('');
    }

    // Both lists or both scalars
    const same = JSON.stringify(a) === JSON.stringify(b);
    if (same) {
      stats.match++;
      return leafCmp(a, b, 'match', '=', indent);
    }
    stats.diff++;
    return leafCmp(a, b, 'diff', '~', indent);
  }

  function shortVal(v) {
    if (v === null || v === undefined) return '∅';
    if (typeof v === 'object') {
      const s = JSON.stringify(v);
      return s.length > 50 ? s.slice(0, 49) + '…' : s;
    }
    const s = String(v);
    return s.length > 50 ? s.slice(0, 49) + '…' : s;
  }

  function leafRow(key, val, cls, mark, indent) {
    const bg = cls === 'only-a' ? 'oklch(0.7 0.25 320 / 0.1)' :
               cls === 'only-b' ? 'oklch(0.75 0.18 155 / 0.1)' : 'transparent';
    return `<div style="margin-left:${indent}px;padding:3px 6px;border-radius:4px;background:${bg};
      font-family:'JetBrains Mono';font-size:11px;">
      <span style="opacity:0.6;">${mark}</span>
      <span style="color:var(--muted-foreground);">${escHtml(key)}:</span>
      <span style="color:var(--foreground);">${escHtml(shortVal(val))}</span>
    </div>`;
  }

  function leafCmp(a, b, cls, mark, indent) {
    const bg = cls === 'match' ? 'transparent' : 'oklch(0.82 0.17 80 / 0.1)';
    return `<div style="margin-left:${indent}px;padding:3px 6px;border-radius:4px;background:${bg};
      font-family:'JetBrains Mono';font-size:11px;display:flex;gap:8px;flex-wrap:wrap;">
      <span style="opacity:0.6;">${mark}</span>
      <span style="color:var(--secondary);">${escHtml(shortVal(a))}</span>
      <span style="opacity:0.4;">↔</span>
      <span style="color:var(--success);">${escHtml(shortVal(b))}</span>
    </div>`;
  }

  const body = diffNode(srcObj, tgtObj, 0);

  return `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;font-size:11px;font-family:'JetBrains Mono';">
      <span class="badge badge-muted">≡ ${stats.match} match</span>
      <span class="badge badge-warning">~ ${stats.diff} differ</span>
      <span class="badge badge-secondary">− ${stats.onlyA} only ${escHtml(aName)}</span>
      <span class="badge badge-success">+ ${stats.onlyB} only ${escHtml(bName)}</span>
    </div>
    <div style="max-height:460px;overflow-y:auto;padding:12px;border:1px solid var(--border);border-radius:0.5rem;">
      ${body}
    </div>
  `;
}

/* ─────────────────────────────────────────────────────────────────
   Patching tab — step-by-step playback
───────────────────────────────────────────────────────────────── */
function simInitPatchingTab(patching) {
  SIM.patching = patching;
  SIM.patchStep = 0;
  SIM.patchPlaying = false;
  if (SIM.patchTimer) { clearInterval(SIM.patchTimer); SIM.patchTimer = null; }

  const el = document.getElementById('sim-tab-patching');
  if (!el) return;

  const arts = patching.artifacts || {};
  const files = arts.files || {};
  const total = patching.steps.length - 1;   // step 0 = initial state

  el.innerHTML = `
    <div class="patch-files-bar">
      <span class="patch-files-title">Saved to VSCode:</span>
      <span class="patch-file-pill">${escHtml(arts.folder || '')}/</span>
      ${Object.entries(files).map(([k, p]) =>
        `<span class="patch-file-pill" title="${escHtml(p)}">${escHtml(k)}.${p.split('.').pop()}</span>`
      ).join('')}
      <span style="margin-left:auto;font-family:'Space Grotesk';font-size:11px;color:${arts.verification_ok ? 'var(--success)' : 'var(--destructive)'};">
        ${arts.verification_ok ? '✓ patched == target verified' : '⚠ verification failed'}
      </span>
    </div>

    <div class="patch-grid">
      <div class="patch-pane source">
        <div class="patch-pane-header">Source · ${escHtml(patching.source_name)}</div>
        <pre class="patch-doc" id="patch-doc-source"></pre>
      </div>
      <div class="patch-pane current">
        <div class="patch-pane-header">Live (Patched) · step <span id="patch-step-cur">0</span> / ${total}</div>
        <pre class="patch-doc" id="patch-doc-current"></pre>
      </div>
      <div class="patch-pane target">
        <div class="patch-pane-header">Target · ${escHtml(patching.target_name)}</div>
        <pre class="patch-doc" id="patch-doc-target"></pre>
      </div>
    </div>

    <div class="patch-controls">
      <button class="btn btn-sm btn-outline" onclick="simPatchReset()">⏮ Reset</button>
      <button class="btn btn-sm btn-outline" onclick="simPatchStepBack()">← Step</button>
      <button class="btn btn-sm btn-primary" id="sim-patch-play-btn" onclick="simPatchTogglePlay()">▶ Play</button>
      <button class="btn btn-sm btn-outline" onclick="simPatchStepForward()">Step →</button>
      <button class="btn btn-sm btn-outline" onclick="simPatchToEnd()">⏭ Finish</button>
      <input type="range" id="sim-patch-slider" min="0" max="${total}" value="0"
             oninput="simPatchStepTo(parseInt(this.value))"/>
      <span id="sim-patch-step-label" style="font-family:'JetBrains Mono';font-size:12px;color:var(--primary);min-width:60px;text-align:right;">
        0 / ${total}
      </span>
    </div>

    <div class="patch-step-summary" id="sim-patch-summary">
      Ready. Press <strong>▶ Play</strong> to apply the edit script one operation at a time, or use the slider to scrub through the ${total} operations.
    </div>
  `;

  // Render the static source / target documents
  document.getElementById('patch-doc-source').textContent = JSON.stringify(patching.source_doc, null, 2);
  document.getElementById('patch-doc-target').textContent = JSON.stringify(patching.target_doc, null, 2);
  simPatchStepTo(0);
}

function simPatchStepTo(idx) {
  if (!SIM.patching) return;
  const steps = SIM.patching.steps;
  if (!steps || !steps.length) return;
  idx = Math.max(0, Math.min(idx, steps.length - 1));
  SIM.patchStep = idx;

  const step = steps[idx];
  const cur  = document.getElementById('patch-doc-current');
  if (cur) cur.textContent = JSON.stringify(step.snapshot, null, 2);

  const slider = document.getElementById('sim-patch-slider');
  if (slider) slider.value = idx;

  const lbl = document.getElementById('sim-patch-step-label');
  if (lbl) lbl.textContent = `${idx} / ${steps.length - 1}`;

  const curStep = document.getElementById('patch-step-cur');
  if (curStep) curStep.textContent = idx;

  const summary = document.getElementById('sim-patch-summary');
  if (summary) {
    if (idx === 0) {
      summary.innerHTML = `<strong>Step 0:</strong> initial state (source document, no operations applied).`;
    } else {
      const opColor = step.op === 'insert' ? 'var(--success)' :
                      step.op === 'delete' ? 'var(--destructive)' : 'var(--warning)';
      summary.innerHTML = `<strong style="color:${opColor};">Step ${idx}/${steps.length - 1}:</strong> ${escHtml(step.summary)}`;
    }
  }

  // Auto-stop play at the end
  if (idx >= steps.length - 1 && SIM.patchPlaying) {
    simPatchPause();
  }
}

function simPatchStepForward() { simPatchStepTo(SIM.patchStep + 1); }
function simPatchStepBack()    { simPatchStepTo(SIM.patchStep - 1); }
function simPatchReset()       { simPatchPause(); simPatchStepTo(0); }
function simPatchToEnd()       { if (SIM.patching) simPatchStepTo(SIM.patching.steps.length - 1); }

function simPatchTogglePlay() {
  if (SIM.patchPlaying) simPatchPause();
  else simPatchPlay();
}

function simPatchPlay() {
  if (!SIM.patching) return;
  SIM.patchPlaying = true;
  const btn = document.getElementById('sim-patch-play-btn');
  if (btn) btn.innerHTML = '⏸ Pause';
  if (SIM.patchTimer) clearInterval(SIM.patchTimer);
  SIM.patchTimer = setInterval(() => {
    if (!SIM.patchPlaying) return;
    if (SIM.patchStep >= (SIM.patching?.steps.length || 1) - 1) {
      simPatchPause();
      return;
    }
    simPatchStepTo(SIM.patchStep + 1);
  }, SIM.patchStepDelayMs);
}

function simPatchPause() {
  SIM.patchPlaying = false;
  const btn = document.getElementById('sim-patch-play-btn');
  if (btn) btn.innerHTML = '▶ Play';
  if (SIM.patchTimer) { clearInterval(SIM.patchTimer); SIM.patchTimer = null; }
}

function simRenderOneVsAllResults(data) {
  const results = data.results || []; // [{name, structural, semantic, combined, rank}]
  const source  = data.source || '';

  // Ranked list — each row drills into a pairwise comparison on click.
  const listEl = document.getElementById('sim-onevall-list');
  if (listEl) {
    if (!results.length) {
      listEl.innerHTML = '<p style="color:var(--muted-foreground);font-size:13px;">No results.</p>';
    } else {
      const hint = source ? `<div style="font-size:11px;color:var(--muted-foreground);margin-bottom:8px;font-family:'JetBrains Mono';">
        Click any country to inspect the pairwise diff vs <strong style="color:var(--primary);">${escHtml(source)}</strong>.
      </div>` : '';

      listEl.innerHTML = hint + results.map((r, i) => {
        const score = r.combined ?? r.structural ?? r.semantic ?? 0;
        const pct   = (score * 100).toFixed(1);
        const safeName = r.name.replace(/'/g, "\\'");
        return `<div onclick="simDrillIntoPair('${safeName}')"
          style="display:flex;align-items:center;gap:12px;padding:10px 12px;
          border-radius:0.5rem;margin-bottom:6px;background:var(--card);border:1px solid var(--border);
          transition:background 0.1s;cursor:pointer;"
          onmouseover="this.style.background='oklch(0.78 0.18 200/0.07)'"
          onmouseout="this.style.background='var(--card)'">
          <span style="font-family:'JetBrains Mono';font-size:12px;color:var(--muted-foreground);
            min-width:24px;text-align:right;">${i+1}</span>
          <span style="flex:1;font-size:13px;font-weight:500;">${escHtml(r.name)}</span>
          <div class="score-bar-wrap" style="width:120px;margin:0;">
            <div class="score-bar-fill" style="width:${pct}%;"></div>
          </div>
          <span style="font-family:'JetBrains Mono';font-size:12px;color:var(--primary);min-width:44px;text-align:right;">${pct}%</span>
          <span style="color:var(--muted-foreground);font-size:12px;">→</span>
        </div>`;
      }).join('');
    }
  }

  // Heatmap Leaflet
  simInitResultMap(data);
}

/* ─────────────────────────────────────────────────────────────────
   Drill-in: from 1vAll leaderboard row → pairwise result view.
   Calls /api/similarity for {source, target} and swaps the result panel.
───────────────────────────────────────────────────────────────── */
async function simDrillIntoPair(targetName) {
  if (!SIM.onevallData) return;
  const source = SIM.onevallData.source;
  if (!source || !targetName || source === targetName) return;

  const listEl = document.getElementById('sim-onevall-list');
  const prev   = listEl ? listEl.innerHTML : '';
  if (listEl) {
    listEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted-foreground);font-size:13px;">
      <div class="spinner" style="margin:0 auto 14px;"></div>
      Computing pairwise diff <strong style="color:var(--foreground);">${escHtml(source)} ↔ ${escHtml(targetName)}</strong>…
    </div>`;
  }

  try {
    const res = await fetch('/api/similarity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode:      'pairwise',
        type:      SIM.simType,
        alpha:     SIM.alpha,
        countries: [source, targetName],
        excluded_labels: simBuildExcludedLabels(),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    SIM.drillData = data;

    // Render pairwise panel, hide leaderboard, and add a back banner.
    simRenderPairwiseResults(data);
    const pairPanel = document.getElementById('sim-results-pairwise');
    const ovaPanel  = document.getElementById('sim-results-onevall');
    if (pairPanel) pairPanel.style.display = '';
    if (ovaPanel)  ovaPanel.style.display  = 'none';
    simInjectBackToLeaderboard(source, targetName);

    if (listEl) listEl.innerHTML = prev;  // restore for when user returns
  } catch (e) {
    if (listEl) listEl.innerHTML = prev;
    showToast('Drill-in failed: ' + e.message, 'error');
  }
}

function simInjectBackToLeaderboard(source, target) {
  document.getElementById('sim-back-to-leaderboard')?.remove();

  const panel = document.getElementById('sim-results-pairwise');
  if (!panel) return;

  const banner = document.createElement('div');
  banner.id = 'sim-back-to-leaderboard';
  banner.style.cssText = `display:flex;align-items:center;gap:10px;
    padding:10px 14px;margin-bottom:14px;border-radius:0.75rem;
    background:oklch(0.78 0.18 200 / 0.06);
    border:1px solid oklch(0.78 0.18 200 / 0.25);`;
  banner.innerHTML = `
    <button class="btn btn-sm btn-outline" onclick="simBackToLeaderboard()">← Back to leaderboard</button>
    <span style="font-size:12px;color:var(--muted-foreground);">Drilled in from 1-vs-All:</span>
    <span style="font-size:13px;font-weight:600;color:var(--foreground);">${escHtml(source)}</span>
    <span style="opacity:0.6;">↔</span>
    <span style="font-size:13px;font-weight:600;color:var(--primary);">${escHtml(target)}</span>
  `;
  panel.insertBefore(banner, panel.firstChild);
}

function simBackToLeaderboard() {
  // Stop any patching playback that was running on the drill-in view.
  if (SIM.patchTimer) { clearInterval(SIM.patchTimer); SIM.patchTimer = null; }
  SIM.patchPlaying = false;

  document.getElementById('sim-back-to-leaderboard')?.remove();
  const pairPanel = document.getElementById('sim-results-pairwise');
  const ovaPanel  = document.getElementById('sim-results-onevall');
  if (pairPanel) pairPanel.style.display = 'none';
  if (ovaPanel)  ovaPanel.style.display  = '';
  SIM.drillData = null;
  // Re-render to refresh hover state on the rows
  if (SIM.onevallData) simRenderOneVsAllResults(SIM.onevallData);
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
  // ── Clear wizard state ──────────────────────────────────────────
  SIM.step      = 0;
  SIM.mode      = null;
  SIM.simType   = null;
  SIM.alpha     = 0.5;
  SIM.selected  = [];
  SIM.result    = null;
  SIM.patching  = null;
  SIM.patchStep = 0;
  SIM.patchPlaying = false;
  if (SIM.patchTimer) { clearInterval(SIM.patchTimer); SIM.patchTimer = null; }
  SIM.onevallData = null;
  SIM.drillData   = null;
  document.getElementById('sim-back-to-leaderboard')?.remove();

  // Reset the label picker to all-included defaults.
  simInitLabels();
  SIM.expandedLabelSections.clear();

  simGoTo(0);

  // ── Wipe lingering UI state from the previous run ───────────────
  document.querySelectorAll('[data-mode]').forEach(el => el.classList.remove('selected'));
  // Re-apply the structural-only auto-selection on the Type card
  document.querySelectorAll('[data-sim-type]').forEach(el =>
    el.classList.toggle('selected', el.dataset.simType === 'structural'));
  const search = document.getElementById('sim-country-search');
  if (search) search.value = '';

  // Re-render the country list and the map so the checkmarks / pins
  // from the previous selection actually disappear.
  simRenderCountryList(SIM.allCountries);
  simRenderSelectedTags();
  simUpdateMapHighlights();
}
