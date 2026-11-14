import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { registerServiceWorker } from './lib/pwa.js';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline shell + install support (E9-15). Production builds only, secure origins only; a failure
// is logged and otherwise ignored because the app works fine without a worker.
void registerServiceWorker(
  {
    serviceWorker: 'serviceWorker' in navigator,
    production: import.meta.env.PROD,
    protocol: window.location.protocol,
    hostname: window.location.hostname,
  },
  navigator.serviceWorker,
  (error) => console.warn('[pwa] service worker registration failed', error),
);
