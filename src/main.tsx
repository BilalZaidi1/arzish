import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

function boot() {
  const el = document.getElementById('root');
  if (!el) return;
  const w = window as unknown as { React?: unknown; ReactDOM?: unknown };
  if (!w.React || !w.ReactDOM) {
    el.innerHTML = '<div style="padding:32px;font-family:system-ui,sans-serif;color:#475069">Arzish could not load its interface libraries. Check your connection and reload the page.</div>';
    return;
  }
  createRoot(el).render(<App />);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
