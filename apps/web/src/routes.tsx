import { Route, Routes, useNavigate } from 'react-router-dom';
import { SearchScreen } from './features/search/SearchScreen';
import { HomePage } from './pages/home';

// Placeholder screens: later tasks replace each one with its feature screen.
function PlaceholderScreen({ title }: { title: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-slate-50 px-6 text-slate-900">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-slate-500">Coming soon.</p>
    </main>
  );
}

/**
 * The search pill is the Home screen's primary action. Keeping navigation in
 * the route layer lets `HomePage` stay renderable in isolation (its map test
 * mounts it without a router) while the real app wires `/` → `/search`.
 */
function HomeRoute() {
  const navigate = useNavigate();
  return <HomePage onSearchClick={() => navigate('/search')} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/search" element={<SearchScreen />} />
      <Route path="/plan" element={<PlaceholderScreen title="Plan" />} />
      <Route path="/trip/:id" element={<PlaceholderScreen title="Trip" />} />
      <Route path="/saved" element={<PlaceholderScreen title="Saved" />} />
      <Route path="/sources" element={<PlaceholderScreen title="Sources" />} />
    </Routes>
  );
}
