import { useState, useEffect, type ReactNode } from 'react';
import { navigate } from '../App';

const NAV_ITEMS = [
  { path: '/', label: 'Проекты', icon: '📋' },
  { path: '/create', label: 'Создать', icon: '🎬' },
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
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Desktop sidebar */}
      <aside
        style={{
          width: collapsed ? 60 : 240,
          minWidth: collapsed ? 60 : 240,
          background: 'var(--bg-card)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.3s, min-width 0.3s',
          position: 'relative',
          overflow: 'hidden',
        }}
        className="sidebar-desktop"
      >
        {/* Logo */}
        <div style={{
          height: 69,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
          borderBottom: '1px solid var(--border)',
          overflow: 'hidden',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'var(--accent)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 14,
            flexShrink: 0,
          }}>
            V
          </div>
          <span style={{
            fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap',
            opacity: collapsed ? 0 : 1, width: collapsed ? 0 : 'auto',
            transition: 'opacity 0.3s, width 0.3s', overflow: 'hidden',
          }}>
            Video Generator
          </span>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, padding: '20px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!collapsed && (
            <div style={{
              fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              padding: '0 12px', marginBottom: 8,
            }}>
              Студия
            </div>
          )}
          {NAV_ITEMS.map((item) => {
            const active = currentPath === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                title={collapsed ? item.label : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                  border: 'none', background: active ? 'rgba(124,58,237,0.1)' : 'transparent',
                  color: active ? 'var(--accent-light)' : 'var(--text-muted)',
                  fontSize: 14, fontWeight: 500, cursor: 'pointer',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  transition: 'background 0.15s, color 0.15s',
                  position: 'relative',
                  whiteSpace: 'nowrap', overflow: 'hidden',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'var(--bg-card2)';
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent';
                }}
              >
                {active && (
                  <span style={{
                    position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                    width: 3, height: 20, borderRadius: 2, background: 'var(--accent)',
                  }} />
                )}
                <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
                <span style={{
                  opacity: collapsed ? 0 : 1, width: collapsed ? 0 : 'auto',
                  transition: 'opacity 0.3s, width 0.3s', overflow: 'hidden',
                }}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid var(--border)', padding: 12,
          display: 'flex', alignItems: 'center', gap: 12,
          justifyContent: collapsed ? 'center' : 'flex-start',
          overflow: 'hidden',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--bg-card2)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontFamily: 'monospace', color: 'var(--text-muted)',
            flexShrink: 0,
          }}>
            V1
          </div>
          <span style={{
            fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap',
            opacity: collapsed ? 0 : 1, width: collapsed ? 0 : 'auto',
            transition: 'opacity 0.3s, width 0.3s', overflow: 'hidden',
          }}>
            Движок активен
          </span>
        </div>

        {/* Toggle button */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Развернуть' : 'Свернуть'}
          style={{
            position: 'absolute', right: -12, top: 52,
            width: 24, height: 24, borderRadius: '50%',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', cursor: 'pointer', zIndex: 10,
            fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </aside>

      {/* Main content */}
      <main style={{
        flex: 1, overflowY: 'auto', background: 'var(--bg)',
        display: 'flex', flexDirection: 'column',
      }}>
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="sidebar-mobile-nav">
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '0 16px', borderRight: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'var(--accent)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 12,
          }}>
            V
          </div>
        </div>
        {NAV_ITEMS.map((item) => {
          const active = currentPath === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 2,
                border: 'none', background: 'transparent',
                color: active ? 'var(--accent-light)' : 'var(--text-muted)',
                fontSize: 10, fontWeight: 600, cursor: 'pointer',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                padding: '8px 0',
              }}
            >
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
