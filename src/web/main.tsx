// Entry point of the hosted web edition (app.html): restore the session, point the shared app at
// Supabase, then render the routes.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { sb } from './supabase';
import { installRuntime, setRuntimeUser } from './runtime';
import { DEMO_KEY, userKey } from './config';
import { setLocalKey } from '../state/persistence';
import { WebRoot } from './WebRoot';

async function boot() {
  const el = document.getElementById('root');
  if (!el) return;
  const w = window as unknown as { React?: unknown; ReactDOM?: unknown };
  if (!w.React || !w.ReactDOM) {
    el.innerHTML = '<div style="padding:32px;font-family:system-ui,sans-serif;color:#475069">Arzish could not load. Check your connection and reload the page.</div>';
    return;
  }
  // A referral code on any page is kept until the person signs in.
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref && /^[a-z0-9]{4,16}$/i.test(ref)) {
    try {
      localStorage.setItem('arzish.ref', ref.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  // Finishes a Google sign-in (?code=...) as well as restoring a saved session.
  const { data } = await sb.auth.getSession();
  const session = data.session ?? null;
  const uid = session?.user?.id ?? null;
  setRuntimeUser(uid);
  setLocalKey(uid ? userKey(uid) : DEMO_KEY);
  installRuntime();
  createRoot(el).render(<WebRoot session={session} />);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot());
else void boot();
