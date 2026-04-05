import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'csc_v1_settings';
const VERSION = 1;

export interface AppSettings {
  version: number;
  tedAlgorithm: 'zhang-shasha' | 'chawathe' | 'nierman-jagadish';
  insertCost: number;
  deleteCost: number;
  updateCost: number;
  normalization: 'exp_size' | 'norm' | 'exp' | 'inv';
  tokenizationEnabled: boolean;
  tokenizationMode: 'whitespace' | 'punctuation' | 'full';
  diffOutputFormat: 'JSON' | 'XML' | 'Custom';
  showPseudocode: boolean;
  showMatrixAnimation: boolean;
  animationSpeed: number;
  flaskUrl: string;
}

const defaults: AppSettings = {
  version: VERSION,
  tedAlgorithm: 'zhang-shasha',
  insertCost: 1.0,
  deleteCost: 1.0,
  updateCost: 1.0,
  normalization: 'exp_size',
  tokenizationEnabled: false,
  tokenizationMode: 'whitespace',
  diffOutputFormat: 'JSON',
  showPseudocode: true,
  showMatrixAnimation: true,
  animationSpeed: 1,
  flaskUrl: 'http://localhost:5001',
};

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as AppSettings;
    if (parsed.version !== VERSION) return defaults;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(defaults);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}