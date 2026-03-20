import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from 'react-simple-maps';
import { Check, Zap, ArrowRight, Globe, Map, RotateCcw } from 'lucide-react';
import { Country, AlgorithmConfig } from '../types';
import { algorithms } from '../data/algorithms';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

interface WorldMapViewProps {
  selectedCountries: Country[];
  selectedAlgorithm: AlgorithmConfig | null;
  onSelectAlgorithm: (algo: AlgorithmConfig) => void;
  onNext: () => void;
  onPrev: () => void;
}

export const WorldMapView: React.FC<WorldMapViewProps> = ({
  selectedCountries,
  selectedAlgorithm,
  onSelectAlgorithm,
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

  const resetGlobe = () => {
    setRotation([0, -20, 0]);
    setAutoRotate(true);
  };

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-4 shrink-0">
        <h2 className="text-2xl font-bold text-white mb-1">World Map &amp; Algorithm Selection</h2>
        <p className="text-gray-400 text-sm">
          Your selected countries are highlighted on the globe. Choose the comparison algorithm below.
        </p>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* ── Map panel ──────────────────────────────────────────── */}
        <div className="flex-1 glass-card flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 shrink-0">
            <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">View:</span>
            <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
              {(['2d', '3d'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setMapMode(m); if (m === '3d') setAutoRotate(true); }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    mapMode === m
                      ? 'bg-primary-600 text-white'
                      : 'text-gray-400 hover:text-white'
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
                    autoRotate ? 'bg-accent-700 text-accent-200' : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {autoRotate ? '⟳ Auto' : '⟳ Paused'}
                </button>
                <button onClick={resetGlobe} title="Reset view" className="p-1 text-gray-500 hover:text-gray-300">
                  <RotateCcw size={13} />
                </button>
                <span className="text-[10px] text-gray-600 ml-1">Drag to rotate</span>
              </>
            )}
            <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
              <span className="w-2 h-2 rounded-full bg-primary-500 inline-block" />
              {selectedCountries.length} selected
            </div>
          </div>

          {/* Map */}
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
                        const isSelected = selectedCountries.some(c => c.code === iso3);
                        return (
                          <Geography
                            key={geo.rsmKey}
                            geography={geo}
                            style={{
                              default: {
                                fill: isSelected ? '#2563eb' : '#1e293b',
                                stroke: isSelected ? '#60a5fa' : '#334155',
                                strokeWidth: isSelected ? 0.8 : 0.4,
                                outline: 'none',
                              },
                              hover: {
                                fill: isSelected ? '#3b82f6' : '#2d3f55',
                                stroke: isSelected ? '#93c5fd' : '#475569',
                                strokeWidth: 0.6,
                                outline: 'none',
                              },
                              pressed: { fill: '#1d4ed8', outline: 'none' },
                            }}
                          />
                        );
                      })
                    }
                  </Geographies>
                  {/* Connection lines */}
                  {selectedCountries.map((c1, i) =>
                    selectedCountries.slice(i + 1).map(c2 => (
                      <line
                        key={`${c1.code}-${c2.code}`}
                        x1={0} y1={0} x2={0} y2={0}
                        // SVG lines don't project easily; use Marker pair instead
                      />
                    ))
                  )}
                  {/* Country markers */}
                  {selectedCountries.map(country => (
                    <Marker key={country.code} coordinates={[country.lon, country.lat]}>
                      <circle r={4} fill="#3b82f6" stroke="#93c5fd" strokeWidth={1.5} />
                      <text
                        textAnchor="middle"
                        y={-8}
                        style={{ fontSize: 6, fill: '#bfdbfe', fontWeight: 600 }}
                      >
                        {country.name.length > 12 ? country.code : country.name}
                      </text>
                    </Marker>
                  ))}
                </ZoomableGroup>
              </ComposableMap>
            ) : (
              /* 3-D orthographic globe */
              <ComposableMap
                projection="geoOrthographic"
                projectionConfig={{ rotate: rotation, scale: 230 }}
                style={{ width: '100%', height: '100%' }}
              >
                {/* Ocean sphere */}
                <circle cx="50%" cy="50%" r="230" fill="#0c1a2e" />
                <Geographies geography={GEO_URL}>
                  {({ geographies }) =>
                    geographies.map(geo => {
                      const iso3 = geoToIso3(geo.id);
                      const isSelected = selectedCountries.some(c => c.code === iso3);
                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          style={{
                            default: {
                              fill: isSelected ? '#2563eb' : '#1e3a5f',
                              stroke: isSelected ? '#60a5fa' : '#1e40af',
                              strokeWidth: isSelected ? 0.8 : 0.3,
                              outline: 'none',
                            },
                            hover: {
                              fill: isSelected ? '#3b82f6' : '#264d7a',
                              outline: 'none',
                            },
                            pressed: { fill: '#1d4ed8', outline: 'none' },
                          }}
                        />
                      );
                    })
                  }
                </Geographies>
                {selectedCountries.map(country => (
                  <Marker key={country.code} coordinates={[country.lon, country.lat]}>
                    <circle r={5} fill="#3b82f6" stroke="#93c5fd" strokeWidth={1.5} opacity={0.9} />
                  </Marker>
                ))}
              </ComposableMap>
            )}
          </div>

          {/* Bottom legend */}
          <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-4 text-[10px] text-gray-500 shrink-0">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm inline-block bg-primary-600 border border-primary-400" />
              Selected country
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm inline-block bg-gray-700 border border-gray-600" />
              Other country
            </span>
            {mapMode === '2d' && (
              <span className="ml-auto">Scroll to zoom · drag to pan</span>
            )}
          </div>
        </div>

        {/* ── Algorithm selection ─────────────────────────────────── */}
        <div className="w-96 flex flex-col gap-3 min-h-0 overflow-y-auto">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider shrink-0">
            Choose Algorithm
          </h3>

          {algorithms.map(algo => {
            const isSelected = selectedAlgorithm?.type === algo.type;
            return (
              <button
                key={algo.type}
                onClick={() => onSelectAlgorithm(algo)}
                className={`w-full text-left p-4 rounded-xl transition-all duration-200 border shrink-0 ${
                  isSelected
                    ? 'bg-primary-900/40 border-primary-500 ring-1 ring-primary-500/30'
                    : 'bg-gray-800/30 border-gray-800 hover:border-gray-600'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 ${
                      isSelected ? 'border-primary-500 bg-primary-600' : 'border-gray-600'
                    }`}
                  >
                    {isSelected && <Check size={12} className="text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-white text-sm">{algo.name}</h4>
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{algo.description}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-gray-800 rounded text-yellow-400">
                        T: {algo.timeComplexity}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-gray-800 rounded text-cyan-400">
                        S: {algo.spaceComplexity}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {selectedAlgorithm && (
            <div className="p-3 bg-accent-900/20 border border-accent-800/50 rounded-lg shrink-0">
              <div className="flex items-center gap-2 text-sm text-accent-400">
                <Zap size={14} />
                <span>
                  Ready: <span className="font-semibold">{selectedAlgorithm.name}</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800 shrink-0">
        <button onClick={onPrev} className="btn-secondary">Back</button>
        <button
          onClick={onNext}
          disabled={!selectedAlgorithm}
          className="btn-primary flex items-center gap-2"
        >
          Continue to Data Source
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

/**
 * Map a TopoJSON numeric country id to ISO-3 alpha code.
 * react-simple-maps exposes `geo.id` as the ISO numeric string.
 */
function geoToIso3(numericId: string | number): string {
  return numericToIso3[String(numericId)] ?? '';
}

// ISO 3166-1 numeric → alpha-3  (selected subset covering all 195 UN states)
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
