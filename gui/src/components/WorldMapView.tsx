import React, { useState } from 'react';
import { MapPin, Zap, Info, ArrowRight, Check } from 'lucide-react';
import { Country, AlgorithmConfig } from '../types';
import { algorithms } from '../data/algorithms';

interface WorldMapViewProps {
  selectedCountries: Country[];
  selectedAlgorithm: AlgorithmConfig | null;
  onSelectAlgorithm: (algo: AlgorithmConfig) => void;
  onNext: () => void;
  onPrev: () => void;
}

// Simple SVG world map with major country positions
const countryPositions: Record<string, { x: number; y: number }> = {
  AFG: { x: 625, y: 195 }, ALB: { x: 520, y: 175 }, DZA: { x: 475, y: 200 },
  AND: { x: 472, y: 175 }, AGO: { x: 515, y: 310 }, ATG: { x: 320, y: 230 },
  ARG: { x: 300, y: 380 }, ARM: { x: 590, y: 175 }, AUS: { x: 790, y: 370 },
  AUT: { x: 510, y: 165 }, AZE: { x: 598, y: 175 }, BHS: { x: 280, y: 215 },
  BHR: { x: 600, y: 215 }, BGD: { x: 670, y: 215 }, BRB: { x: 325, y: 240 },
  BLR: { x: 535, y: 150 }, BEL: { x: 480, y: 155 }, BLZ: { x: 255, y: 230 },
  BEN: { x: 478, y: 265 }, BTN: { x: 670, y: 205 }, BOL: { x: 295, y: 330 },
  BIH: { x: 518, y: 170 }, BWA: { x: 530, y: 340 }, BRA: { x: 320, y: 310 },
  BRN: { x: 730, y: 260 }, BGR: { x: 530, y: 170 }, BFA: { x: 470, y: 255 },
  BDI: { x: 540, y: 295 }, CPV: { x: 425, y: 245 }, KHM: { x: 715, y: 245 },
  CMR: { x: 500, y: 270 }, CAN: { x: 230, y: 120 }, CAF: { x: 520, y: 270 },
  TCD: { x: 515, y: 250 }, CHL: { x: 285, y: 360 }, CHN: { x: 710, y: 195 },
  COL: { x: 280, y: 260 }, COM: { x: 565, y: 315 }, COG: { x: 515, y: 290 },
  COD: { x: 530, y: 295 }, CRI: { x: 260, y: 250 }, CIV: { x: 460, y: 265 },
  HRV: { x: 515, y: 168 }, CUB: { x: 270, y: 220 }, CYP: { x: 555, y: 192 },
  CZE: { x: 510, y: 158 }, DNK: { x: 498, y: 142 }, DJI: { x: 570, y: 255 },
  DMA: { x: 322, y: 238 }, DOM: { x: 290, y: 225 }, ECU: { x: 270, y: 280 },
  EGY: { x: 545, y: 210 }, SLV: { x: 252, y: 240 }, GNQ: { x: 498, y: 280 },
  ERI: { x: 558, y: 245 }, EST: { x: 530, y: 138 }, SWZ: { x: 545, y: 345 },
  ETH: { x: 558, y: 265 }, FJI: { x: 880, y: 330 }, FIN: { x: 530, y: 125 },
  FRA: { x: 478, y: 163 }, GAB: { x: 505, y: 285 }, GMB: { x: 445, y: 250 },
  GEO: { x: 585, y: 172 }, DEU: { x: 500, y: 155 }, GHA: { x: 470, y: 268 },
  GRC: { x: 525, y: 180 }, GRD: { x: 322, y: 242 }, GTM: { x: 248, y: 238 },
  GIN: { x: 450, y: 258 }, GNB: { x: 445, y: 255 }, GUY: { x: 315, y: 265 },
  HTI: { x: 285, y: 225 }, HND: { x: 255, y: 238 }, HUN: { x: 520, y: 163 },
  ISL: { x: 435, y: 110 }, IND: { x: 650, y: 225 }, IDN: { x: 735, y: 285 },
  IRN: { x: 605, y: 195 }, IRQ: { x: 585, y: 195 }, IRL: { x: 460, y: 148 },
  ISR: { x: 555, y: 200 }, ITA: { x: 505, y: 175 }, JAM: { x: 275, y: 228 },
  JPN: { x: 780, y: 185 }, JOR: { x: 560, y: 200 }, KAZ: { x: 625, y: 160 },
  KEN: { x: 555, y: 285 }, KIR: { x: 875, y: 280 }, PRK: { x: 745, y: 178 },
  KOR: { x: 748, y: 185 }, KWT: { x: 592, y: 205 }, KGZ: { x: 640, y: 172 },
  LAO: { x: 710, y: 230 }, LVA: { x: 528, y: 140 }, LBN: { x: 558, y: 195 },
  LSO: { x: 538, y: 355 }, LBR: { x: 452, y: 268 }, LBY: { x: 510, y: 215 },
  LIE: { x: 498, y: 163 }, LTU: { x: 528, y: 142 }, LUX: { x: 485, y: 157 },
  MDG: { x: 570, y: 330 }, MWI: { x: 550, y: 320 }, MYS: { x: 720, y: 260 },
  MDV: { x: 640, y: 260 }, MLI: { x: 468, y: 240 }, MLT: { x: 510, y: 185 },
  MHL: { x: 860, y: 265 }, MRT: { x: 450, y: 232 }, MUS: { x: 585, y: 335 },
  MEX: { x: 235, y: 225 }, FSM: { x: 830, y: 265 }, MDA: { x: 538, y: 162 },
  MCO: { x: 488, y: 170 }, MNG: { x: 695, y: 160 }, MNE: { x: 520, y: 172 },
  MAR: { x: 460, y: 200 }, MOZ: { x: 555, y: 330 }, MMR: { x: 690, y: 225 },
  NAM: { x: 518, y: 340 }, NRU: { x: 855, y: 280 }, NPL: { x: 660, y: 205 },
  NLD: { x: 483, y: 150 }, NZL: { x: 860, y: 395 }, NIC: { x: 258, y: 242 },
  NER: { x: 490, y: 240 }, NGA: { x: 488, y: 265 }, MKD: { x: 525, y: 175 },
  NOR: { x: 498, y: 125 }, OMN: { x: 610, y: 220 }, PAK: { x: 635, y: 205 },
  PLW: { x: 800, y: 265 }, PAN: { x: 268, y: 252 }, PNG: { x: 820, y: 300 },
  PRY: { x: 310, y: 345 }, PER: { x: 275, y: 310 }, PHL: { x: 745, y: 240 },
  POL: { x: 520, y: 150 }, PRT: { x: 455, y: 178 }, QAT: { x: 600, y: 215 },
  ROU: { x: 530, y: 165 }, RUS: { x: 630, y: 130 }, RWA: { x: 540, y: 290 },
  KNA: { x: 320, y: 232 }, LCA: { x: 322, y: 240 }, VCT: { x: 322, y: 241 },
  WSM: { x: 890, y: 310 }, SMR: { x: 507, y: 172 }, STP: { x: 488, y: 280 },
  SAU: { x: 580, y: 218 }, SEN: { x: 445, y: 248 }, SRB: { x: 522, y: 170 },
  SYC: { x: 590, y: 300 }, SLE: { x: 448, y: 264 }, SGP: { x: 720, y: 270 },
  SVK: { x: 520, y: 160 }, SVN: { x: 510, y: 165 }, SLB: { x: 840, y: 300 },
  SOM: { x: 575, y: 265 }, ZAF: { x: 535, y: 355 }, SSD: { x: 545, y: 270 },
  ESP: { x: 465, y: 178 }, LKA: { x: 655, y: 248 }, SDN: { x: 545, y: 245 },
  SUR: { x: 320, y: 262 }, SWE: { x: 510, y: 125 }, CHE: { x: 490, y: 162 },
  SYR: { x: 565, y: 192 }, TJK: { x: 640, y: 178 }, TZA: { x: 550, y: 300 },
  THA: { x: 710, y: 238 }, TLS: { x: 758, y: 298 }, TGO: { x: 475, y: 268 },
  TON: { x: 893, y: 325 }, TTO: { x: 322, y: 248 }, TUN: { x: 498, y: 195 },
  TUR: { x: 555, y: 178 }, TKM: { x: 615, y: 178 }, TUV: { x: 875, y: 298 },
  UGA: { x: 545, y: 280 }, UKR: { x: 545, y: 155 }, ARE: { x: 605, y: 218 },
  GBR: { x: 470, y: 148 }, USA: { x: 215, y: 185 }, URY: { x: 310, y: 365 },
  UZB: { x: 625, y: 172 }, VUT: { x: 855, y: 320 }, VAT: { x: 505, y: 175 },
  VEN: { x: 298, y: 258 }, VNM: { x: 720, y: 235 }, YEM: { x: 585, y: 238 },
  ZMB: { x: 538, y: 320 }, ZWE: { x: 540, y: 335 },
};

export const WorldMapView: React.FC<WorldMapViewProps> = ({
  selectedCountries,
  selectedAlgorithm,
  onSelectAlgorithm,
  onNext,
  onPrev,
}) => {
  const [hoveredAlgo, setHoveredAlgo] = useState<string | null>(null);

  return (
    <div className="animate-fade-in flex flex-col h-full">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-white mb-2">World Map & Algorithm Selection</h2>
        <p className="text-gray-400">
          Review your selected countries on the map and choose the comparison algorithm.
        </p>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Map area */}
        <div className="flex-1 glass-card p-4 flex flex-col">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Selected Countries on World Map
          </h3>
          <div className="flex-1 bg-gray-950 rounded-lg overflow-hidden relative">
            <svg viewBox="380 80 560 350" className="w-full h-full" style={{ background: '#0a0f1a' }}>
              {/* Simple world outline placeholder */}
              <defs>
                <radialGradient id="glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </radialGradient>
                <filter id="blur">
                  <feGaussianBlur stdDeviation="2" />
                </filter>
              </defs>

              {/* Grid lines */}
              {[100, 150, 200, 250, 300, 350, 400].map(y => (
                <line key={`h${y}`} x1="380" y1={y} x2="940" y2={y} stroke="#1e293b" strokeWidth="0.5" strokeDasharray="4 4" />
              ))}
              {[400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900].map(x => (
                <line key={`v${x}`} x1={x} y1="80" x2={x} y2="430" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="4 4" />
              ))}

              {/* Connection lines between selected countries */}
              {selectedCountries.map((c1, i) =>
                selectedCountries.slice(i + 1).map(c2 => {
                  const p1 = countryPositions[c1.code];
                  const p2 = countryPositions[c2.code];
                  if (!p1 || !p2) return null;
                  return (
                    <line
                      key={`${c1.code}-${c2.code}`}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke="#3b82f6"
                      strokeWidth="1"
                      strokeOpacity="0.3"
                      strokeDasharray="4 2"
                    />
                  );
                })
              )}

              {/* Country markers */}
              {selectedCountries.map(country => {
                const pos = countryPositions[country.code];
                if (!pos) return null;
                return (
                  <g key={country.code}>
                    <circle cx={pos.x} cy={pos.y} r="12" fill="url(#glow)" />
                    <circle cx={pos.x} cy={pos.y} r="5" fill="#3b82f6" stroke="#60a5fa" strokeWidth="1.5" />
                    <text
                      x={pos.x}
                      y={pos.y - 10}
                      textAnchor="middle"
                      fill="#93c5fd"
                      fontSize="7"
                      fontWeight="600"
                      fontFamily="Inter, sans-serif"
                    >
                      {country.name.length > 12 ? country.code : country.name}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Legend */}
            <div className="absolute bottom-3 left-3 bg-gray-900/90 px-3 py-2 rounded-lg border border-gray-800 text-xs">
              <div className="flex items-center gap-2 text-gray-400">
                <div className="w-2.5 h-2.5 rounded-full bg-primary-500" />
                <span>{selectedCountries.length} countries selected</span>
              </div>
              <div className="flex items-center gap-2 text-gray-500 mt-1">
                <div className="w-4 border-t border-dashed border-primary-500/50" />
                <span>Comparison pairs</span>
              </div>
            </div>
          </div>
        </div>

        {/* Algorithm selection */}
        <div className="w-96 glass-card p-4 flex flex-col">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Choose Algorithm
          </h3>

          <div className="flex-1 space-y-3">
            {algorithms.map(algo => {
              const isSelected = selectedAlgorithm?.type === algo.type;
              const isHovered = hoveredAlgo === algo.type;

              return (
                <button
                  key={algo.type}
                  onClick={() => onSelectAlgorithm(algo)}
                  onMouseEnter={() => setHoveredAlgo(algo.type)}
                  onMouseLeave={() => setHoveredAlgo(null)}
                  className={`w-full text-left p-4 rounded-xl transition-all duration-200 border ${
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
                    <div className="flex-1">
                      <h4 className="font-semibold text-white text-sm">{algo.name}</h4>
                      <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                        {algo.description}
                      </p>

                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono px-2 py-0.5 bg-gray-800 rounded text-yellow-400">
                            Time: {algo.timeComplexity}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono px-2 py-0.5 bg-gray-800 rounded text-cyan-400">
                            Space: {algo.spaceComplexity}
                          </span>
                        </div>
                      </div>

                      {(isSelected || isHovered) && (
                        <div className="mt-3 border-t border-gray-700/50 pt-3">
                          <h5 className="text-[10px] uppercase text-gray-500 font-semibold mb-1.5">
                            Algorithm Steps
                          </h5>
                          <ol className="space-y-1">
                            {algo.steps.map((step, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                                <span className="text-primary-500 font-mono shrink-0">
                                  {i + 1}.
                                </span>
                                {step}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedAlgorithm && (
            <div className="mt-3 p-3 bg-accent-900/20 border border-accent-800/50 rounded-lg">
              <div className="flex items-center gap-2 text-sm text-accent-400">
                <Zap size={14} />
                <span>Ready to process with {selectedAlgorithm.name}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-800">
        <button onClick={onPrev} className="btn-secondary">
          Back
        </button>
        <button onClick={onNext} disabled={!selectedAlgorithm} className="btn-primary flex items-center gap-2">
          Start Processing
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
