// Vite entry point. Boots React 18 into the #root div in index.html.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installApiFallback } from './lib/api-fallback';
import './styles/index.css';

// Install a no-op window.api shim if Electron's preload didn't run.
// Lets us preview the wizard in a plain browser via `npm run dev` alone.
// In a real Electron build, contextBridge.exposeInMainWorld('api', ...)
// already populated window.api, so this is a no-op.
installApiFallback();

const rootEl = document.getElementById('root');
if (!rootEl) {
  // This shouldn't ever happen at runtime — index.html owns the div — but
  // makes the failure obvious if someone accidentally edits the HTML.
  throw new Error('Titan installer: #root element missing from index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
