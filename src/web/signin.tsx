// Sign in: Google, or a six-digit code sent by email. No passwords. New accounts start a Pro trial.
import React, { useEffect, useRef, useState } from 'react';
import { api, errorText, sb } from './supabase';
import { SUPABASE_KEY, SUPABASE_URL } from './config';
import { BrandMark, Icon } from '../ui/components/Icon';
import { Button, Callout } from '../ui/components/primitives';

function nextPath(): string {
  const n = new URLSearchParams(window.location.search).get('next') ?? '/app';
  return n.startsWith('/') && !n.startsWith('//') ? n : '/app';
}

export function SignIn() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'warn' | 'good' | 'info'; text: string } | null>(null);
  const [google, setGoogle] = useState<boolean | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Show Google only once it is switched on for the project.
    fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
      .then((r) => r.json())
      .then((s) => setGoogle(!!s?.external?.google))
      .catch(() => setGoogle(false));
    const q = new URLSearchParams(window.location.search);
    const e = q.get('error_description');
    if (e) setMsg({ tone: 'warn', text: e.replace(/\+/g, ' ') });
  }, []);

  useEffect(() => {
    if (step === 'code') window.setTimeout(() => codeRef.current?.focus(), 30);
  }, [step]);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('auth-code', { email });
      setStep('code');
      setMsg({ tone: 'info', text: `We sent a 6-digit code to ${email.trim().toLowerCase()}. It works for 10 minutes.` });
    } catch (err) {
      setMsg({ tone: 'warn', text: errorText(err) });
    }
    setBusy(false);
  };

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const out = await api<{ token_hash: string }>('auth-code', { email, code });
      let r = await sb.auth.verifyOtp({ token_hash: out.token_hash, type: 'email' });
      if (r.error) r = await sb.auth.verifyOtp({ token_hash: out.token_hash, type: 'magiclink' });
      if (r.error || !r.data.session) throw { message: 'Could not finish signing in. Ask for a new code.' };
      window.location.assign(nextPath());
    } catch (err) {
      setMsg({ tone: 'warn', text: errorText(err) });
      setBusy(false);
    }
  };

  const withGoogle = async () => {
    setBusy(true);
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}${nextPath()}` } });
    if (error) {
      setMsg({ tone: 'warn', text: error.message });
      setBusy(false);
    }
  };

  return (
    <div className="w-auth">
      <div className="w-auth-card">
        <a href="/" className="w-auth-brand"><BrandMark size={30} /><span>Arzish</span></a>
        <h1>{step === 'code' ? 'Check your email' : 'Sign in or create an account'}</h1>
        <p className="small ink2">Track PSX shares, mutual funds, National Savings, gold, property and foreign assets in one place, with forecasts and an AI analyst. New accounts get a free Pro trial; no card needed.</p>
        {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
        {step === 'email' ? (
          <>
            {google && (
              <>
                <Button className="w-full w-google" disabled={busy} onClick={withGoogle}>
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" /><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z" /><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" /></svg>
                  Continue with Google
                </Button>
                <div className="w-or"><span>or</span></div>
              </>
            )}
            <form className="stack" style={{ gap: 10 }} onSubmit={sendCode}>
              <div className="field">
                <label htmlFor="w-email">Email address</label>
                <input id="w-email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <Button variant="primary" className="w-full" disabled={busy || !email.includes('@')} type="submit" icon="mail">{busy ? 'Sending…' : 'Email me a sign-in code'}</Button>
            </form>
          </>
        ) : (
          <form className="stack" style={{ gap: 10 }} onSubmit={verify}>
            <div className="field">
              <label htmlFor="w-code">6-digit code</label>
              <input id="w-code" ref={codeRef} className="input w-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} placeholder="123456" />
            </div>
            <Button variant="primary" className="w-full" disabled={busy || code.length !== 6} type="submit">{busy ? 'Checking…' : 'Sign in'}</Button>
            <div className="row-between small">
              <button type="button" className="linkbtn" onClick={() => { setStep('email'); setCode(''); setMsg(null); }}>Use another email</button>
              <button type="button" className="linkbtn" disabled={busy} onClick={() => sendCode()}>Send a new code</button>
            </div>
          </form>
        )}
        <div className="w-auth-foot">
          <a href="/app" className="small"><Icon name="chevronRight" size={14} /> Try it without an account</a>
          <span className="tiny muted">By continuing you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</span>
        </div>
      </div>
    </div>
  );
}
