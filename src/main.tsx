import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource-variable/archivo';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import App from './App';

// Installs the service worker. New versions activate on the next app launch.
if (!import.meta.env.DEV) registerSW({ immediate: true });

// Development only: lets automated tests look inside the running app.
if (import.meta.env.DEV) {
  void Promise.all([import('./lib/audio/engine'), import('./lib/audio/transport'), import('./lib/keyboard'), import('./lib/store'), import('./lib/audio/render')]).then(
    ([engine, transport, keyboard, store, render]) => {
      (window as unknown as Record<string, unknown>).__synth = { ...engine, ...transport, ...keyboard, ...store, ...render };
    },
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
