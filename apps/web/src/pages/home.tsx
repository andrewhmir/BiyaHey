import { Search } from 'lucide-react';

// Placeholder entry point for Task 1. Task 2 wraps this in the map/sheet shell;
// the search pill remains the app's primary call to action.
export function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-slate-50 px-6 text-slate-900">
      <h1 className="text-4xl font-bold tracking-tight">BiyaHey!</h1>
      <button
        type="button"
        className="flex min-h-14 w-full max-w-sm items-center gap-3 rounded-full border border-slate-200 bg-white px-6 text-left text-base font-medium shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 active:shadow-none"
      >
        <Search aria-hidden="true" className="size-5 shrink-0 text-slate-500" />
        <span>Saan ka pupunta?</span>
      </button>
    </main>
  );
}
