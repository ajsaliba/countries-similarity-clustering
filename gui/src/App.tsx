import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SettingsProvider } from './contexts/SettingsContext';
import { Layout } from './components/Layout';

import { HomePage } from './pages/HomePage';
import { DatasetBrowserPage } from './pages/DatasetBrowserPage';
import { PreProcessingPage } from './pages/PreProcessingPage';
import { ComparePage } from './pages/ComparePage';
import { OneVsAllPage } from './pages/OneVsAllPage';
import { DiffViewerPage } from './pages/DiffViewerPage';
import { PatcherPage } from './pages/PatcherPage';
import { ReconstructionPage } from './pages/ReconstructionPage';
import { ClusteringPage } from './pages/ClusteringPage';
import { ClusterEvaluationPage } from './pages/ClusterEvaluationPage';
import { SettingsPage } from './pages/SettingsPage';
import { DeveloperPage } from './pages/DeveloperPage';
import { ReportsPage } from './pages/ReportsPage';

export default function App() {
  return (
    <SettingsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/dataset" element={<DatasetBrowserPage />} />
            <Route path="/preprocessing" element={<PreProcessingPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/one-vs-all" element={<OneVsAllPage />} />
            <Route path="/diff" element={<DiffViewerPage />} />
            <Route path="/patcher" element={<PatcherPage />} />
            <Route path="/reconstruction" element={<ReconstructionPage />} />
            <Route path="/clustering" element={<ClusteringPage />} />
            <Route path="/cluster-evaluation" element={<ClusterEvaluationPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/developer" element={<DeveloperPage />} />
            <Route path="/reports" element={<ReportsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SettingsProvider>
  );
}