import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { startDataPrefetch } from './lib/prefetch';
import './theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After the shell paints, warm the two small BFF GETs the About-data and Saved
// screens need (idle-triggered; see lib/prefetch.ts).
startDataPrefetch();
