import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';

export function SettingsPage() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'ok' | 'fail'>('idle');

  const testConnection = async () => {
    setConnectionStatus('idle');
    try {
      const res = await fetch('/api/ted/countries?dataset=clean');
      setConnectionStatus(res.ok ? 'ok' : 'fail');
    } catch {
      setConnectionStatus('fail');
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <h1 className="text-xl font-bold text-gray-900">Settings</h1>

      {/* TED Algorithm */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">TED Algorithm</h2>
        {([
          ['zhang-shasha', 'Zhang-Shasha (default)'],
          ['chawathe', 'Chawathe'],
          ['nierman-jagadish', 'Nierman-Jagadish'],
        ] as [typeof settings.tedAlgorithm, string][]).map(([val, label]) => (
          <label key={val} className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="tedAlgo" value={val} checked={settings.tedAlgorithm === val}
              onChange={() => updateSettings({ tedAlgorithm: val })} className="accent-primary-600" />
            <span className="text-sm text-gray-700">{label}</span>
          </label>
        ))}
      </section>

      {/* Operation Costs */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Operation Costs</h2>
        {([
          ['insertCost', 'Insert cost'],
          ['deleteCost', 'Delete cost'],
          ['updateCost', 'Update cost'],
        ] as [keyof typeof settings, string][]).map(([key, label]) => (
          <div key={key} className="flex items-center gap-4">
            <label className="w-28 text-sm text-gray-600 shrink-0">{label}</label>
            <input
              type="range" min={0.5} max={3.0} step={0.1}
              value={settings[key] as number}
              onChange={e => updateSettings({ [key]: parseFloat(e.target.value) })}
              className="flex-1 accent-primary-600"
            />
            <input
              type="number" min={0.5} max={3.0} step={0.1}
              value={settings[key] as number}
              onChange={e => updateSettings({ [key]: parseFloat(e.target.value) })}
              className="w-16 text-sm border border-gray-200 rounded-lg px-2 py-1 text-center"
            />
          </div>
        ))}
      </section>

      {/* Similarity Normalization */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">Similarity Normalization</h2>
        <select
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
          value={settings.normalization}
          onChange={e => updateSettings({ normalization: e.target.value as typeof settings.normalization })}
        >
          {(['exp_size', 'norm', 'exp', 'inv'] as const).map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </section>

      {/* Tokenization */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">Tokenization</h2>
        <label className="flex items-center gap-2 cursor-pointer">
          <button
            onClick={() => updateSettings({ tokenizationEnabled: !settings.tokenizationEnabled })}
            className={`relative w-10 h-5 rounded-full transition-colors ${settings.tokenizationEnabled ? 'bg-primary-600' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings.tokenizationEnabled ? 'translate-x-5' : ''}`} />
          </button>
          <span className="text-sm text-gray-700">Enable tokenization</span>
        </label>

        {settings.tokenizationEnabled && (
          <div className="ml-4 space-y-2">
            {(['whitespace', 'punctuation', 'full'] as const).map(mode => (
              <label key={mode} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="tokenMode" value={mode} checked={settings.tokenizationMode === mode}
                  onChange={() => updateSettings({ tokenizationMode: mode })} className="accent-primary-600" />
                <span className="text-sm text-gray-700 capitalize">{mode}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Diff Output Format */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">Diff Output Format</h2>
        {(['JSON', 'XML', 'Custom'] as const).map(fmt => (
          <label key={fmt} className="flex items-center gap-2 cursor-pointer">
            <input type="radio" name="diffFmt" value={fmt} checked={settings.diffOutputFormat === fmt}
              onChange={() => updateSettings({ diffOutputFormat: fmt })} className="accent-primary-600" />
            <span className="text-sm text-gray-700">{fmt}</span>
          </label>
        ))}
      </section>

      {/* Display */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="font-semibold text-gray-800">Display</h2>

        <label className="flex items-center justify-between">
          <span className="text-sm text-gray-700">Show algorithm pseudocode</span>
          <button
            onClick={() => updateSettings({ showPseudocode: !settings.showPseudocode })}
            className={`relative w-10 h-5 rounded-full transition-colors ${settings.showPseudocode ? 'bg-primary-600' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings.showPseudocode ? 'translate-x-5' : ''}`} />
          </button>
        </label>

        <label className="flex items-center justify-between">
          <span className="text-sm text-gray-700">Show TED matrix animation</span>
          <button
            onClick={() => updateSettings({ showMatrixAnimation: !settings.showMatrixAnimation })}
            className={`relative w-10 h-5 rounded-full transition-colors ${settings.showMatrixAnimation ? 'bg-primary-600' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings.showMatrixAnimation ? 'translate-x-5' : ''}`} />
          </button>
        </label>

        <div className="flex items-center gap-4">
          <label className="text-sm text-gray-600 shrink-0">Animation speed: {settings.animationSpeed}×</label>
          <input
            type="range" min={0.5} max={4} step={0.5}
            value={settings.animationSpeed}
            onChange={e => updateSettings({ animationSpeed: parseFloat(e.target.value) })}
            className="flex-1 accent-primary-600"
          />
        </div>
      </section>

      {/* Backend */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">Backend</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">Flask API URL:</span>
          <span className="text-sm font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-700">{settings.flaskUrl}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={testConnection}
            className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            Test Connection
          </button>
          {connectionStatus === 'ok' && (
            <span className="flex items-center gap-1 text-xs text-accent-700 bg-accent-50 border border-accent-200 rounded-full px-2 py-0.5">
              <Check size={12} /> Connected ✓
            </span>
          )}
          {connectionStatus === 'fail' && (
            <span className="flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
              <X size={12} /> Failed ✗
            </span>
          )}
        </div>
      </section>

      {/* Reset */}
      <button
        onClick={resetSettings}
        className="px-4 py-2 text-sm bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
      >
        Restore Defaults
      </button>
    </div>
  );
}