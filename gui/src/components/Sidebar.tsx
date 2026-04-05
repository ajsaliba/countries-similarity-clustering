import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Database,
  Sliders,
  GitCompare,
  Target,
  FileDiff,
  Layers,
  FileText,
  Network,
  BarChart3,
  Settings,
  Code2,
  Download,
  X,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  label: string;
  route: string;
  Icon: LucideIcon;
}

const navItems: NavItem[] = [
  { label: 'Home', route: '/', Icon: LayoutDashboard },
  { label: 'Dataset Browser', route: '/dataset', Icon: Database },
  { label: 'Pre-Processing', route: '/preprocessing', Icon: Sliders },
  { label: 'Compare Countries', route: '/compare', Icon: GitCompare },
  { label: 'One vs All', route: '/one-vs-all', Icon: Target },
  { label: 'Diff Viewer', route: '/diff', Icon: FileDiff },
  { label: 'Tree Patcher', route: '/patcher', Icon: Layers },
  { label: 'Infobox Reconstruction', route: '/reconstruction', Icon: FileText },
  { label: 'Clustering', route: '/clustering', Icon: Network },
  { label: 'Cluster Evaluation', route: '/cluster-evaluation', Icon: BarChart3 },
  { label: 'Settings', route: '/settings', Icon: Settings },
  { label: 'Developer API', route: '/developer', Icon: Code2 },
  { label: 'Reports', route: '/reports', Icon: Download },
];

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  const location = useLocation();

  const isActive = (route: string) =>
    route === '/' ? location.pathname === '/' : location.pathname.startsWith(route);

  const sidebarContent = (
    <nav className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-200">
        <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center font-bold text-xs text-white shrink-0">
          CS
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">CSC</p>
            <p className="text-[10px] text-gray-500 truncate">Similarity &amp; Clustering</p>
          </div>
        )}
      </div>

      {/* Nav items */}
      <ul className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
        {navItems.map(({ label, route, Icon }) => {
          const active = isActive(route);
          return (
            <li key={route}>
              <NavLink
                to={route}
                onClick={onCloseMobile}
                className={[
                  'flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors',
                  active
                    ? 'bg-primary-100 text-primary-700 font-semibold'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  collapsed ? 'justify-center' : '',
                ].join(' ')}
                title={collapsed ? label : undefined}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={[
          'hidden lg:flex flex-col bg-white border-r border-gray-200 transition-all duration-300 shrink-0',
          collapsed ? 'w-14' : 'w-56',
        ].join(' ')}
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={[
          'fixed top-0 left-0 h-full w-56 bg-white border-r border-gray-200 z-50 flex flex-col transition-transform duration-300 lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center font-bold text-xs text-white">
              CS
            </div>
            <span className="text-sm font-bold text-gray-900">CSC</span>
          </div>
          <button onClick={onCloseMobile} className="p-1 rounded hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        {sidebarContent}
      </aside>
    </>
  );
}