import { useState, useEffect } from 'react';
import Home from './pages/Home';
import Create from './pages/Create';
import VideoDetail from './pages/VideoDetail';
import Layout from './components/Layout';

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

function currentPath(): string {
  const hash = window.location.hash.replace('#', '');
  if (hash === '/create') return '/create';
  return '/';
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const handler = () => {
      setRoute(parseRoute());
      setPath(currentPath());
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  return (
    <Layout currentPath={path}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px', width: '100%' }}>
        {route.page === 'home' && <Home />}
        {route.page === 'create' && <Create />}
        {route.page === 'detail' && <VideoDetail id={route.id} />}
      </div>
    </Layout>
  );
}
