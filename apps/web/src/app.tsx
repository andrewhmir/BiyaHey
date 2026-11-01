import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { LocaleProvider } from './i18n/useT';
import { AppRoutes } from './routes';

export function App() {
  // One client per mount keeps tests isolated; screens add queries in Task 4.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  // v1 ships Taglish only; the provider owns `<html lang>` and makes a future
  // English toggle a one-prop change (Task 9 report's locale ruling).
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
