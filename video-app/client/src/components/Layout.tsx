import { useState, useEffect, type ReactNode } from 'react';
import { LayoutGrid, Clapperboard, ChevronLeft, ChevronRight } from 'lucide-react';
import { navigate } from '../App';

const NAV_ITEMS = [
  { path: '/', label: 'Проекты', icon: LayoutGrid },
  { path: '/create', label: 'Создать', icon: Clapperboard },
];

export default function Layout({ children, currentPath }: { children: ReactNode; currentPath: string }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('vg-sidebar-collapsed') === 'true'; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('vg-sidebar-collapsed', String(collapsed)); }
    catch {}
  }, [collapsed]);

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col h-full shrink-0 border-r relative transition-all duration-300 ease-in-out ${
          collapsed ? 'w-[60px]' : 'w-64'
        }`}
        style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-3 h-[69px] px-4 shrink-0 overflow-hidden border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <div
            className="w-8 h-8 rounded flex items-center justify-center font-bold text-sm shrink-0"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            V
          </div>
          <span
            className={`font-bold text-xl tracking-tight whitespace-nowrap transition-all duration-300 ${
              collapsed ? 'opacity-0 w-0' : 'opacity-100'
            }`}
            style={{ color: 'var(--text)' }}
          >
            Video Generator
          </span>
        </div>

        {/* Nav links */}
        <div className="flex-1 py-5 px-2 flex flex-col gap-1">
          {!collapsed && (
            <div
              className="text-[10px] font-semibold uppercase tracking-widest mb-2 px-3 transition-opacity duration-200"
              style={{ color: 'var(--text-muted)' }}
            >
              Студия
            </div>
          )}
          {NAV_ITEMS.map((item) => {
            const active = currentPath === item.path;
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 relative group ${
                  collapsed ? 'justify-center' : ''
                }`}
                style={{
                  background: active ? 'rgba(124,58,237,0.1)' : 'transparent',
                  color: active ? 'var(--accent-light)' : 'var(--text-muted)',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'var(--bg-card2)';
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent';
                }}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                    style={{ background: 'var(--accent)' }}
                  />
                )}
                <Icon className="w-5 h-5 shrink-0" style={{ color: active ? 'var(--accent-light)' : 'var(--text-muted)' }} />
                <span
                  className={`font-medium text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${
                    collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
                  }`}
                >
                  {item.label}
                </span>

                {/* Tooltip when collapsed */}
                {collapsed && (
                  <div
                    className="absolute left-full ml-3 px-2.5 py-1.5 rounded-md text-xs font-medium shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap z-50"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  >
                    {item.label}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div
          className={`border-t p-3 flex items-center gap-3 overflow-hidden ${collapsed ? 'justify-center' : ''}`}
          style={{ borderColor: 'var(--border)' }}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-mono shrink-0"
            style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            V1
          </div>
          <span
            className={`text-xs whitespace-nowrap transition-all duration-300 ${
              collapsed ? 'opacity-0 w-0' : 'opacity-100'
            }`}
            style={{ color: 'var(--text-muted)' }}
          >
            Движок активен
          </span>
        </div>

        {/* Toggle button */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Развернуть' : 'Свернуть'}
          className="absolute -right-3 top-[52px] w-6 h-6 rounded-full flex items-center justify-center shadow-md z-10 transition-colors duration-150"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--accent-light)';
            e.currentTarget.style.borderColor = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted)';
            e.currentTarget.style.borderColor = 'var(--border)';
          }}
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-y-auto" style={{ background: 'var(--bg)' }}>
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch h-14"
        style={{ background: 'var(--bg-card)', borderTop: '1px solid var(--border)' }}
      >
        <div
          className="flex items-center gap-1 px-4 shrink-0"
          style={{ borderRight: '1px solid var(--border)' }}
        >
          <div
            className="w-7 h-7 rounded flex items-center justify-center font-bold text-sm"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            V
          </div>
        </div>
        {NAV_ITEMS.map((item) => {
          const active = currentPath === item.path;
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors"
              style={{
                background: 'transparent',
                border: 'none',
                color: active ? 'var(--accent-light)' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-semibold uppercase tracking-wide">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
