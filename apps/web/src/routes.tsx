import { Route, Routes } from 'react-router-dom';
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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/search" element={<PlaceholderScreen title="Search" />} />
      <Route path="/plan" element={<PlaceholderScreen title="Plan" />} />
      <Route path="/trip/:id" element={<PlaceholderScreen title="Trip" />} />
      <Route path="/saved" element={<PlaceholderScreen title="Saved" />} />
      <Route path="/sources" element={<PlaceholderScreen title="Sources" />} />
    </Routes>
  );
}
