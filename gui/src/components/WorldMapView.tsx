import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from 'react-simple-maps';
import { Check, ArrowRight, Globe, Map, RotateCcw } from 'lucide-react';
import {
  Country,
  SimilarityConfig,
  SimilarityCategory,
  TedMethod,
  NormalizationFormula,
  ApproxMethod,
  RepresentationVariant,
  SetMeasure,
  VectorMeasure,
  TFVariant,
} from '../types';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

interface WorldMapViewProps {
  selectedCountries: Country[];
  similarityConfig: SimilarityConfig;
  onSetSimilarityConfig: (cfg: SimilarityConfig) => void;
  onNext: () => void;
  onPrev: () => void;
}

// ── Pill button helper ─────────────────────────────────────────────────────
const Pill: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: 'primary' | 'accent';
}> = ({ active, onClick, children, color = 'primary' }) => (
  <button
    onClick={onClick}
    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
      active
        ? color === 'accent'
          ? 'bg-accent-700 border-accent-500 text-white'
          : 'bg-primary-700 border-primary-500 text-white'
        : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700'
    }`}
  >
    {children}
  </button>
);

// ── Section header ─────────────────────────────────────────────────────────
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
    {children}
  </p>
);

// ── Method info ────────────────────────────────────────────────────────────
const METHOD_INFO: Record<string, { time: string; space: string; desc: string }> = {
  chawathe:        { time: 'O(N²)',    space: 'O(N²)',    desc: 'Converts trees to (label,depth) LD-pair strings, then applies Wagner–Fisher DP. Efficient but heuristic depth condition can miss some structural matches.' },
  nierman:         { time: 'O(N²)',    space: 'O(N²)',    desc: 'Recursive FLS-based TED that detects sub-tree containment. More accurate than Chawathe for trees with repeated sub-structure.' },
  'zhang-shasha':  { time: 'O(N·M)',   space: 'O(N·M)',   desc: 'Classic 1989 algorithm. Uses postorder numbering, leftmost-leaf descendants, and keyroots to reduce TED to a series of forest-distance DP sub-problems. Provably optimal worst-case.' },
  tag:         { time: 'O(kN)', space: 'O(N)',   desc: 'Represent each tree as a bag of node labels. Fast and simple filter; ignores structural relationships between labels.' },
  edge:        { time: 'O(kN)', space: 'O(N)',   desc: 'Represent each tree as a bag of "parent/child" edge strings. Captures direct parent–child structure; misses deeper structural patterns.' },
  'path-root': { time: 'O(kN)', space: 'O(N)',   desc: 'Bag of root-to-leaf paths. Strong structural signal; every leaf is uniquely addressed.' },
  'path-all':  { time: 'O(kNl²)', space: 'O(N)', desc: 'Bag of root-to-every-node paths. More features than root paths; approaches TED accuracy as l grows.' },
  'path-xpath':{ time: 'O(kN)', space: 'O(N)',   desc: 'XPaths augmented with sibling-position index (e.g. gov[1]/president[1]). Captures some sibling ordering beyond plain paths.' },
  fft:         { time: 'O(N log N)', space: 'O(N)', desc: 'Build an open/close-tag time series, apply DFT, then compare magnitude spectra with cosine. Fast in theory but higher error rate in practice.' },
};

export const WorldMapView: React.FC<WorldMapViewProps> = ({
  selectedCountries,
  similarityConfig,
  onSetSimilarityConfig,
  onNext,
  onPrev,
}) => {
  const [mapMode, setMapMode] = useState<'2d' | '3d'>('2d');
  const [rotation, setRotation] = useState<[number, number, number]>([0, -20, 0]);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const dragStart = useRef<{ x: number; y: number; rot: [number, number, number] } | null>(null);
  const animRef = useRef<number | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);

  // Auto-rotate 3-D globe
  useEffect(() => {
    if (mapMode !== '3d' || !autoRotate || dragging) return;
    animRef.current = requestAnimationFrame(function tick() {
      setRotation(r => [r[0] - 0.15, r[1], r[2]]);
      animRef.current = requestAnimationFrame(tick);
    });
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [mapMode, autoRotate, dragging]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (mapMode !== '3d') return;
    setDragging(true);
    setAutoRotate(false);
    dragStart.current = { x: e.clientX, y: e.clientY, rot: rotation };
  }, [mapMode, rotation]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setRotation([
      dragStart.current.rot[0] + dx * 0.3,
      Math.max(-90, Math.min(90, dragStart.current.rot[1] - dy * 0.3)),
      0,
    ]);
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  // ── Config helpers ───────────────────────────────────────────────────────
  const set = (patch: Partial<SimilarityConfig>) =>
    onSetSimilarityConfig({ ...similarityConfig, ...patch });

  const setCategory = (category: SimilarityCategory) => {
    if (category === 'ted') {
      // Default to formula3 (Rule 6 normalized distance) — gives meaningful [0,1] scores
      onSetSimilarityConfig({ category, tedMethod: 'zhang-shasha', tedNormalization: 'formula3' });
    } else {
      onSetSimilarityConfig({
        category,
        approxMethod: 'tag',
        approxVariant: 'set',
        approxMeasure: 'jaccard',
        tfVariant: 'raw',
      });
    }
  };

  const cfg = similarityConfig;
  const isTED   = cfg.category === 'ted';
  const isApprox = cfg.category === 'approximation';
  const isFFT   = cfg.approxMethod === 'fft';
  const isVector = cfg.approxVariant === 'vector';

  const currentInfoKey = isTED
    ? (cfg.tedMethod ?? 'chawathe')
    : (cfg.approxMethod ?? 'tag');
  const info = METHOD_INFO[currentInfoKey] ?? METHOD_INFO['tag'];

  // Is the configuration complete enough to proceed?
  const canProceed = isTED
    ? !!cfg.tedMethod && !!cfg.tedNormalization
    : !!cfg.approxMethod && (isFFT || !!cfg.approxVariant && !!cfg.approxMeasure);

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-3 shrink-0">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">World Map &amp; Similarity Method</h2>
        <p className="text-gray-500 text-sm">
          Selected countries are highlighted on the globe. Choose the structural similarity method.
        </p>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">

        {/* ── Map panel ───────────────────────────────────────────── */}
        <div className="flex-1 glass-card flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 shrink-0">
            <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">View:</span>
            <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
              {(['2d', '3d'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setMapMode(m); if (m === '3d') setAutoRotate(true); }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    mapMode === m ? 'bg-primary-600 text-white' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {m === '2d' ? <Map size={12} /> : <Globe size={12} />}
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
            {mapMode === '3d' && (
              <>
                <button
                  onClick={() => setAutoRotate(v => !v)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    autoRotate ? 'bg-accent-700 text-accent-200' : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {autoRotate ? '⟳ Auto' : '⟳ Paused'}
                </button>
                <button onClick={() => { setRotation([0,-20,0]); setAutoRotate(true); }}
                  title="Reset" className="p-1 text-gray-500 hover:text-gray-300">
                  <RotateCcw size={13} />
                </button>
                <span className="text-[10px] text-gray-400 ml-1">Drag to rotate</span>
              </>
            )}
            <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-primary-500 inline-block" />
              {selectedCountries.length} selected
            </div>
          </div>

          <div
            className="flex-1 overflow-hidden bg-[#060d1a]"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: mapMode === '3d' ? (dragging ? 'grabbing' : 'grab') : 'default' }}
          >
            {mapMode === '2d' ? (
              <ComposableMap
                projectionConfig={{ scale: 145, center: [0, 10] }}
                style={{ width: '100%', height: '100%' }}
              >
                <ZoomableGroup zoom={zoom} onMoveEnd={({ zoom: z }) => setZoom(z)}>
                  <Geographies geography={GEO_URL}>
                    {({ geographies }) =>
                      geographies.map(geo => {
                        const iso3 = geoToIso3(geo.id);
                        const sel  = selectedCountries.some(c => c.code === iso3);
                        return (
                          <Geography key={geo.rsmKey} geography={geo} style={{
                            default: { fill: sel ? '#2563eb' : '#1e293b', stroke: sel ? '#60a5fa' : '#334155', strokeWidth: sel ? 0.8 : 0.4, outline: 'none' },
                            hover:   { fill: sel ? '#3b82f6' : '#2d3f55', stroke: sel ? '#93c5fd' : '#475569', strokeWidth: 0.6, outline: 'none' },
                            pressed: { fill: '#1d4ed8', outline: 'none' },
                          }} />
                        );
                      })
                    }
                  </Geographies>
                  {selectedCountries.map(c => (
                    <Marker key={c.code} coordinates={[c.lon, c.lat]}>
                      <circle r={4} fill="#3b82f6" stroke="#93c5fd" strokeWidth={1.5} />
                      <text textAnchor="middle" y={-8} style={{ fontSize: 6, fill: '#bfdbfe', fontWeight: 600 }}>
                        {c.name.length > 12 ? c.code : c.name}
                      </text>
                    </Marker>
                  ))}
                </ZoomableGroup>
              </ComposableMap>
            ) : (
              <ComposableMap
                projection="geoOrthographic"
                projectionConfig={{ rotate: rotation, scale: 230 }}
                style={{ width: '100%', height: '100%' }}
              >
                <circle cx="50%" cy="50%" r="230" fill="#0c1a2e" />
                <Geographies geography={GEO_URL}>
                  {({ geographies }) =>
                    geographies.map(geo => {
                      const iso3 = geoToIso3(geo.id);
                      const sel  = selectedCountries.some(c => c.code === iso3);
                      return (
                        <Geography key={geo.rsmKey} geography={geo} style={{
                          default: { fill: sel ? '#2563eb' : '#1e3a5f', stroke: sel ? '#60a5fa' : '#1e40af', strokeWidth: sel ? 0.8 : 0.3, outline: 'none' },
                          hover:   { fill: sel ? '#3b82f6' : '#264d7a', outline: 'none' },
                          pressed: { fill: '#1d4ed8', outline: 'none' },
                        }} />
                      );
                    })
                  }
                </Geographies>
                {selectedCountries.map(c => (
                  <Marker key={c.code} coordinates={[c.lon, c.lat]}>
                    <circle r={5} fill="#3b82f6" stroke="#93c5fd" strokeWidth={1.5} opacity={0.9} />
                  </Marker>
                ))}
              </ComposableMap>
            )}
          </div>

          <div className="px-4 py-2 border-t border-gray-200 flex items-center gap-4 text-[10px] text-gray-500 shrink-0">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm inline-block bg-primary-600 border border-primary-400" />Selected
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm inline-block bg-gray-200 border border-gray-300" />Other
            </span>
            {mapMode === '2d' && <span className="ml-auto">Scroll to zoom · drag to pan</span>}
          </div>
        </div>

        {/* ── Similarity Method selector ───────────────────────────── */}
        <div className="w-[380px] flex flex-col gap-3 min-h-0 overflow-y-auto">

          {/* Category tabs */}
          <div className="shrink-0">
            <SectionLabel>Category</SectionLabel>
            <div className="flex gap-2">
              <button
                onClick={() => setCategory('ted')}
                className={`flex-1 py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                  isTED
                    ? 'bg-primary-50 border-primary-500 text-primary-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                TED-based (Ch.5)
              </button>
              <button
                onClick={() => setCategory('approximation')}
                className={`flex-1 py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                  isApprox
                    ? 'bg-accent-50 border-accent-500 text-accent-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                Approx. Filter (Ch.6)
              </button>
            </div>
          </div>

          {/* ── TED section ─────────────────────────────────────────── */}
          {isTED && (
            <div className="glass-card p-3 space-y-3 shrink-0">
              <div>
                <SectionLabel>Algorithm</SectionLabel>
                <div className="space-y-1.5">
                  {([
                    ['chawathe',     'Chawathe (1999)',           'LD-pair string + Wagner–Fisher DP'],
                    ['nierman',      'Nierman & Jagadish (2002)', 'Recursive FLS TED with contained-in detection'],
                    ['zhang-shasha', 'Zhang & Shasha (1989)',     'Keyroot forest-distance DP — provably optimal O(N·M)'],
                  ] as [TedMethod, string, string][]).map(([val, name, sub]) => (
                    <button
                      key={val}
                      onClick={() => set({ tedMethod: val })}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all flex items-start gap-2 ${
                        cfg.tedMethod === val
                          ? 'bg-primary-50 border-primary-600'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${
                        cfg.tedMethod === val ? 'border-primary-400 bg-primary-600' : 'border-gray-300'
                      }`}>
                        {cfg.tedMethod === val && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-900">{name}</div>
                        <div className="text-[10px] text-gray-500">{sub}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel>Normalisation Formula</SectionLabel>
                <div className="space-y-1">
                  {([
                    ['formula3', 'Formula 3 ★', 'Sim = 1 − TED / max(|A|,|B|)', '→ [0,1], Rule 6 recommended'],
                    ['formula2', 'Formula 2',   'Sim = 1 − TED / (|A|+|B|)',    '→ [0,1], bounded'],
                    ['formula1', 'Formula 1',   'Sim = 1 / (1 + TED)',           '→ ]0,1], unbounded'],
                  ] as [NormalizationFormula, string, string, string][]).map(([val, name, formula, range]) => (
                    <button
                      key={val}
                      onClick={() => set({ tedNormalization: val })}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-all flex items-center gap-2 ${
                        cfg.tedNormalization === val
                          ? 'bg-primary-50 border-primary-600'
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                        cfg.tedNormalization === val ? 'border-primary-400 bg-primary-600' : 'border-gray-300'
                      }`}>
                        {cfg.tedNormalization === val && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-gray-900">{name}: </span>
                        <span className="font-mono text-[10px] text-yellow-600">{formula}</span>
                        <span className="text-[10px] text-gray-500 ml-1">{range}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Approximation section ────────────────────────────────── */}
          {isApprox && (
            <div className="glass-card p-3 space-y-3 shrink-0">
              {/* Method */}
              <div>
                <SectionLabel>Method</SectionLabel>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    ['tag',        'Tag',        'Set of labels'],
                    ['edge',       'Edge',       'Parent/child pairs'],
                    ['path-root',  'Path Root',  'Root-to-leaf paths'],
                    ['path-all',   'Path All',   'Root-to-any-node'],
                    ['path-xpath', 'XPath',      'Paths with indices'],
                    ['fft',        'FFT',        'Frequency spectrum'],
                  ] as [ApproxMethod, string, string][]).map(([val, name, sub]) => (
                    <button
                      key={val}
                      onClick={() => {
                        const patch: Partial<SimilarityConfig> = { approxMethod: val };
                        if (val === 'fft') {
                          patch.approxVariant = undefined;
                          patch.approxMeasure = undefined;
                        } else if (!cfg.approxVariant) {
                          patch.approxVariant = 'set';
                          patch.approxMeasure = 'jaccard';
                        }
                        set(patch);
                      }}
                      className={`flex flex-col items-center py-2 px-1 rounded-lg border text-center transition-all ${
                        cfg.approxMethod === val
                          ? 'bg-accent-50 border-accent-500 text-accent-700'
                          : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {cfg.approxMethod === val && <Check size={10} className="mb-0.5" />}
                      <span className="text-[10px] font-semibold">{name}</span>
                      <span className="text-[8px] text-gray-400 leading-tight">{sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Representation */}
              {!isFFT && (
                <div>
                  <SectionLabel>Representation</SectionLabel>
                  <div className="flex gap-2">
                    {(['set', 'multiset', 'vector'] as RepresentationVariant[]).map(v => (
                      <Pill
                        key={v}
                        active={cfg.approxVariant === v}
                        color="accent"
                        onClick={() => {
                          const defaultMeasure: SetMeasure | VectorMeasure =
                            v === 'vector' ? 'cosine' : 'jaccard';
                          set({ approxVariant: v, approxMeasure: defaultMeasure, tfVariant: 'raw' });
                        }}
                      >
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                      </Pill>
                    ))}
                  </div>
                </div>
              )}

              {/* Measure */}
              {!isFFT && (
                <div>
                  <SectionLabel>
                    {isVector ? 'Vector Measure' : 'Set Measure'}
                  </SectionLabel>
                  {!isVector ? (
                    <div className="flex gap-2 flex-wrap">
                      {(['intersection', 'jaccard', 'dice'] as SetMeasure[]).map(m => (
                        <Pill key={m} active={cfg.approxMeasure === m} color="accent"
                          onClick={() => set({ approxMeasure: m })}>
                          {m.charAt(0).toUpperCase() + m.slice(1)}
                        </Pill>
                      ))}
                    </div>
                  ) : (
                    <div className="flex gap-1.5 flex-wrap">
                      {(['cosine', 'pcc', 'euclidean', 'manhattan', 'tanimoto', 'dice'] as VectorMeasure[]).map(m => (
                        <Pill key={m} active={cfg.approxMeasure === m} color="accent"
                          onClick={() => set({ approxMeasure: m })}>
                          {m.charAt(0).toUpperCase() + m.slice(1)}
                        </Pill>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TF weighting for vector */}
              {isVector && !isFFT && (
                <div>
                  <SectionLabel>TF Weighting (Ch.7)</SectionLabel>
                  <div className="flex gap-2">
                    {([
                      ['raw',        'Raw',        'TF = freq(t)'],
                      ['normalized', 'Normalised', 'TF = freq/max'],
                      ['log',        'Log',        'TF = log(freq+1)'],
                    ] as [TFVariant, string, string][]).map(([val, label, formula]) => (
                      <button
                        key={val}
                        onClick={() => set({ tfVariant: val })}
                        className={`flex-1 py-1.5 px-2 rounded-lg border text-center text-[10px] transition-all ${
                          cfg.tfVariant === val
                            ? 'bg-accent-50 border-accent-500 text-accent-700'
                            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        <div className="font-semibold">{label}</div>
                        <div className="font-mono text-[8px] text-gray-400">{formula}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Method info card ─────────────────────────────────────── */}
          <div className="glass-card p-3 shrink-0">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[10px] font-mono px-2 py-0.5 bg-gray-100 rounded text-yellow-600 border border-gray-200">
                T: {info.time}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 bg-gray-100 rounded text-cyan-600 border border-gray-200">
                S: {info.space}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 leading-relaxed">{info.desc}</p>
          </div>

          {/* ── Current selection summary ────────────────────────────── */}
          {canProceed && (
            <div className="glass-card p-3 border border-accent-200 bg-accent-50 shrink-0">
              <div className="flex items-center gap-2 text-accent-600 mb-1">
                <Check size={13} />
                <span className="text-xs font-semibold">Ready</span>
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                {isTED
                  ? `${cfg.tedMethod === 'nierman' ? 'Nierman & Jagadish' : cfg.tedMethod === 'zhang-shasha' ? 'Zhang-Shasha' : 'Chawathe'} TED with ${cfg.tedNormalization === 'formula1' ? 'Formula 1 (1/(1+TED))' : cfg.tedNormalization === 'formula2' ? 'Formula 2 (1−TED/(|A|+|B|))' : 'Formula 3 (1−TED/max(|A|,|B|))'}`
                  : isFFT
                    ? 'FFT spectrum cosine similarity'
                    : `${cfg.approxMethod} · ${cfg.approxVariant}/${cfg.approxMeasure}${cfg.approxVariant === 'vector' ? `/${cfg.tfVariant}` : ''}`
                }
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200 shrink-0">
        <button onClick={onPrev} className="btn-secondary">Back</button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="btn-primary flex items-center gap-2"
        >
          Continue to Data Source
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

function geoToIso3(numericId: string | number): string {
  return numericToIso3[String(numericId)] ?? '';
}

const numericToIso3: Record<string, string> = {
  '004':'AFG','008':'ALB','012':'DZA','020':'AND','024':'AGO','028':'ATG',
  '032':'ARG','051':'ARM','036':'AUS','040':'AUT','031':'AZE','044':'BHS',
  '048':'BHR','050':'BGD','052':'BRB','112':'BLR','056':'BEL','084':'BLZ',
  '204':'BEN','064':'BTN','068':'BOL','070':'BIH','072':'BWA','076':'BRA',
  '096':'BRN','100':'BGR','854':'BFA','108':'BDI','132':'CPV','116':'KHM',
  '120':'CMR','124':'CAN','140':'CAF','148':'TCD','152':'CHL','156':'CHN',
  '170':'COL','174':'COM','178':'COG','180':'COD','188':'CRI','384':'CIV',
  '191':'HRV','192':'CUB','196':'CYP','203':'CZE','208':'DNK','262':'DJI',
  '212':'DMA','214':'DOM','218':'ECU','818':'EGY','222':'SLV','226':'GNQ',
  '232':'ERI','233':'EST','748':'SWZ','231':'ETH','242':'FJI','246':'FIN',
  '250':'FRA','266':'GAB','270':'GMB','268':'GEO','276':'DEU','288':'GHA',
  '300':'GRC','308':'GRD','320':'GTM','324':'GIN','624':'GNB','328':'GUY',
  '332':'HTI','340':'HND','348':'HUN','352':'ISL','356':'IND','360':'IDN',
  '364':'IRN','368':'IRQ','372':'IRL','376':'ISR','380':'ITA','388':'JAM',
  '392':'JPN','400':'JOR','398':'KAZ','404':'KEN','296':'KIR','408':'PRK',
  '410':'KOR','414':'KWT','417':'KGZ','418':'LAO','428':'LVA','422':'LBN',
  '426':'LSO','430':'LBR','434':'LBY','438':'LIE','440':'LTU','442':'LUX',
  '450':'MDG','454':'MWI','458':'MYS','462':'MDV','466':'MLI','470':'MLT',
  '584':'MHL','478':'MRT','480':'MUS','484':'MEX','583':'FSM','498':'MDA',
  '492':'MCO','496':'MNG','499':'MNE','504':'MAR','508':'MOZ','104':'MMR',
  '516':'NAM','520':'NRU','524':'NPL','528':'NLD','554':'NZL','558':'NIC',
  '562':'NER','566':'NGA','807':'MKD','578':'NOR','512':'OMN','586':'PAK',
  '585':'PLW','591':'PAN','598':'PNG','600':'PRY','604':'PER','608':'PHL',
  '616':'POL','620':'PRT','634':'QAT','642':'ROU','643':'RUS','646':'RWA',
  '659':'KNA','662':'LCA','670':'VCT','882':'WSM','674':'SMR','678':'STP',
  '682':'SAU','686':'SEN','688':'SRB','690':'SYC','694':'SLE','702':'SGP',
  '703':'SVK','705':'SVN','090':'SLB','706':'SOM','710':'ZAF','728':'SSD',
  '724':'ESP','144':'LKA','729':'SDN','740':'SUR','752':'SWE','756':'CHE',
  '760':'SYR','762':'TJK','834':'TZA','764':'THA','626':'TLS','768':'TGO',
  '776':'TON','780':'TTO','788':'TUN','792':'TUR','795':'TKM','798':'TUV',
  '800':'UGA','804':'UKR','784':'ARE','826':'GBR','840':'USA','858':'URY',
  '860':'UZB','548':'VUT','336':'VAT','862':'VEN','704':'VNM','887':'YEM',
  '894':'ZMB','716':'ZWE',
};
