import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu, AlertTriangle } from 'lucide-react';
import { Sidebar } from './Sidebar';

export function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  // Collapse sidebar automatically below 1280px
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)');
    setCollapsed(mq.matches);
    const handler = (e: MediaQueryListEvent) => setCollapsed(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Backend health check
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch('/api/ted/countries?dataset=clean');
        if (!cancelled) setBackendOnline(res.ok);
      } catch {
        if (!cancelled) setBackendOnline(false);
      }
    }
    void check();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="shrink-0 h-12 bg-white border-b border-gray-200 flex items-center gap-3 px-4 z-30">
          {/* Mobile hamburger */}
          <button
            className="lg:hidden p-1.5 rounded hover:bg-gray-100"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={18} className="text-gray-600" />
          </button>

          {/* Desktop collapse toggle */}
          <button
            className="hidden lg:flex p-1.5 rounded hover:bg-gray-100"
            onClick={() => setCollapsed(v => !v)}
          >
            <Menu size={18} className="text-gray-600" />
          </button>

          <div className="flex-1" />

          {/* Backend status */}
          {backendOnline === false && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-md px-3 py-1 text-xs text-red-700">
              <AlertTriangle size={14} />
              <span>Backend Offline — Flask not reachable</span>
            </div>
          )}
          {backendOnline === true && (
            <div className="flex items-center gap-2 bg-accent-50 border border-accent-200 rounded-md px-3 py-1 text-xs text-accent-700">
              <span className="w-2 h-2 rounded-full bg-accent-500 inline-block" />
              <span>Backend Connected</span>
            </div>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}