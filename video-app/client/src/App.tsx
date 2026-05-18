import { useState, useEffect } from 'react';
import Home from './pages/Home';
import Create from './pages/Create';
import VideoDetail from './pages/VideoDetail';

type Route =
  | { page: 'home' }
  | { page: 'create' }
  | { page: 'detail'; id: string };

function parseRoute(): Route {
  const hash = window.location.hash.replace('#', '');
  if (hash === '/create') return { page: 'create' };
  if (hash.startsWith('/video/')) return { page: 'detail', id: hash.replace('/video/', '') };
  return { page: 'home' };
}

export function navigate(path: string) {
  window.location.hash = path;
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute);

  useEffect(() => {
    const handler = () => setRoute(parseRoute());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <Header />
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
        {route.page === 'home' && <Home />}
        {route.page === 'create' && <Create />}
        {route.page === 'detail' && <VideoDetail id={route.id} />}
      </main>
    </div>
  );
}

function Header() {
  return (
    <header
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 60,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <button
        onClick={() => navigate('/')}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text)',
          fontSize: 18,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        🎬 <span>Video Generator</span>
      </button>
      <nav style={{ display: 'flex', gap: 12 }}>
        <NavBtn label="Проекты" onClick={() => navigate('/')} />
        <NavBtn label="+ Создать" onClick={() => navigate('/create')} primary />
      </nav>
    </header>
  );
}

function NavBtn({
  label,
  onClick,
  primary,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 16px',
        borderRadius: 'var(--radius-sm)',
        border: primary ? 'none' : '1px solid var(--border)',
        background: primary ? 'var(--accent)' : 'transparent',
        color: 'var(--text)',
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      {label}
    </button>
  );
}
