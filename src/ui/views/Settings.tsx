import React, { useRef, useState } from 'react';
import { DEFAULT_MARKET } from '../../engine/assumptions';
import { fmtDate, todayISO } from '../../engine/format';
import { PROFILE_LABELS, PROFILE_ORDER } from '../../engine/optimize';
import { createWorkspace, migrateWorkspace } from '../../engine/samples';
import type { RiskProfile, Settings, Workspace } from '../../engine/types';
import { clearLocal } from '../../state/persistence';
import { useUI, useWS } from '../../state/store';
import { saveFileStatus, saveMessage } from '../download';
import { Badge, Button, Callout, Card, Field, KV, Modal, NumberInput, Seg, Select, Toggle } from '../components/primitives';
import { useFmt } from '../fmt';
import { PageHead } from './common';
import { holdingsToCsv } from './Holdings';

export function SettingsView() {
  const { ws, active, update, replace, storage, saveStatus } = useWS();
  const { toast, go } = useUI();
  const fmt = useFmt();
  const s = ws.settings;
  const set = (p: Partial<Settings>) => update((w) => ({ ...w, settings: { ...w.settings, ...p } }));
  const [confirm, setConfirm] = useState<null | 'reset' | 'examples' | { kind: 'import'; ws: Workspace }>(null);
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const today = todayISO();
  const examples = ws.portfolios.filter((p) => p.isExample).length;
  const own = ws.portfolios.length - examples;

  const exportJson = async () => {
    const r = await saveFileStatus(`arzish-workspace-${today}.json`, JSON.stringify(ws, null, 2));
    toast(saveMessage(r, 'Backup'));
  };
  const exportCsv = async () => {
    const r = await saveFileStatus(`arzish-${active.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${today}.csv`, holdingsToCsv(active.holdings, ws.market));
    toast(saveMessage(r, 'CSV'));
  };
  const onFile = async (f: File | undefined) => {
    setImportError('');
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = migrateWorkspace(JSON.parse(text));
      if (!parsed) throw new Error('not a workspace');
      setConfirm({ kind: 'import', ws: parsed });
    } catch {
      setImportError('That file is not an Arzish backup. Choose a .json file exported from this screen.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const storageText = storage === 'cloud'
    ? saveStatus === 'readonly' ? 'This view cannot save to your account, so changes stay in this browser.' : __WEB__ ? 'Saved privately to your Arzish account, so it follows you across devices. Only you can see it.' : 'Saved privately to your Claude account, so it follows you across devices. Only you can see it.'
    : __WEB__ ? 'Saved in this browser only. Sign in to keep it in your account, or export a backup.' : 'Saved in this browser only. Export a backup to move it to another device.';

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Settings" sub="Your profile, display preferences and data." />
      <div className="grid">
        <Card className="span-6" title="Profile" sub="Used for goals, retirement, tax and the AI analyst">
          <div className="form-grid">
            <Field label="Name (optional)" htmlFor="s-name"><input id="s-name" className="input" value={s.name ?? ''} maxLength={60} onChange={(e) => set({ name: e.target.value || undefined })} /></Field>
            <Field label="Age" htmlFor="s-age"><NumberInput id="s-age" value={s.age} onChange={(v) => set({ age: v === undefined ? undefined : Math.max(16, Math.min(100, Math.round(v))) })} suffix="years" /></Field>
            <Field label="Monthly household expenses" htmlFor="s-exp" hint="For the emergency fund and income coverage"><NumberInput id="s-exp" value={s.monthlyExpenses} onChange={(v) => set({ monthlyExpenses: Math.max(0, v ?? 0) })} prefix="Rs" groupStyle="lakh" step={10000} /></Field>
            <Field label="Risk profile" htmlFor="s-risk" hint={<button type="button" className="linkbtn small" onClick={() => go('optimizer')}>Take the seven-question quiz</button>}>
              <Select id="s-risk" value={(s.riskProfile ?? '') as RiskProfile | ''} onChange={(v) => set({ riskProfile: (v || undefined) as RiskProfile | undefined })} options={[{ value: '' as const, label: 'Not set' }, ...PROFILE_ORDER.map((p) => ({ value: p, label: PROFILE_LABELS[p] }))]} />
            </Field>
            <Field label="Income tax status" htmlFor="s-filer"><Select id="s-filer" value={s.filer ? 'filer' : 'non'} onChange={(v) => set({ filer: v === 'filer' })} options={[{ value: 'filer', label: 'Filer (on the Active Taxpayers List)' }, { value: 'non', label: 'Non-filer' }]} /></Field>
            <Field label="Zakat nisab" htmlFor="s-nisab"><Select id="s-nisab" value={s.nisabBasis} onChange={(v) => set({ nisabBasis: v })} options={[{ value: 'silver', label: 'Silver, 52.5 tola' }, { value: 'gold', label: 'Gold, 7.5 tola' }]} /></Field>
            <Field label="Tax on foreign capital gains" htmlFor="s-fcgt" hint="Applied to global stocks and ETFs in estimates"><NumberInput id="s-fcgt" value={s.foreignCgtRate} onChange={(v) => set({ foreignCgtRate: Math.max(0, Math.min(50, v ?? 0)) })} suffix="%" /></Field>
          </div>
        </Card>
        <Card className="span-6" title="Display" sub="Applies to every screen">
          <div className="stack" style={{ gap: 14 }}>
            <div className="row-between"><span className="small strong">Base currency</span><Seg label="Base currency" value={s.baseCurrency} onChange={(v) => set({ baseCurrency: v })} options={[{ value: 'PKR', label: 'Pakistani rupee' }, { value: 'USD', label: 'US dollar' }]} /></div>
            <div className="row-between"><span className="small strong">Large numbers</span><Seg label="Number style" value={s.numberStyle} onChange={(v) => set({ numberStyle: v })} options={[{ value: 'lakh', label: '12.5 lakh · 2.3 Cr' }, { value: 'intl', label: '1.25M · 23M' }]} /></div>
            <div className="row-between"><span className="small strong">Future values</span><Seg label="Future values" value={s.realTerms ? 'real' : 'nominal'} onChange={(v) => set({ realTerms: v === 'real' })} options={[{ value: 'nominal', label: 'Nominal' }, { value: 'real', label: 'Today’s money' }]} /></div>
            <div className="row-between"><span className="small strong">Theme</span><Seg label="Theme" value={s.theme} onChange={(v) => set({ theme: v })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></div>
            <div className="row-between"><span className="small strong">AI analysis depth</span><Seg label="AI analysis depth" value={s.aiDepth} onChange={(v) => set({ aiDepth: v })} options={[{ value: 'standard', label: 'Standard' }, { value: 'deep', label: 'Deep (slower)' }]} /></div>
            <p className="mini-help">Example: {fmt.money(12_500_000)} · {fmt.money(235_000_000)}. {__WEB__ ? 'Deep makes the AI analyst think longer before answering.' : 'The AI analyst runs on Claude Opus 5.5 with your own Claude usage; Deep thinks longer before answering.'}</p>
          </div>
        </Card>
        <Card className="span-6" title="Your data" sub={`${own} portfolio${own === 1 ? '' : 's'} of your own · ${examples} example${examples === 1 ? '' : 's'}`}>
          <div className="stack">
            <div className="row" style={{ gap: 8 }}><Badge tone={storage === 'cloud' ? 'accent' : undefined}>{storage === 'cloud' ? (__WEB__ ? 'Your Arzish account' : 'Your Claude account') : 'This browser'}</Badge><span className="small ink2">{storageText}</span></div>
            <div className="row">
              <Button icon="download" onClick={exportJson}>Export backup (JSON)</Button>
              <Button icon="upload" onClick={() => fileRef.current?.click()}>Import backup</Button>
              <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} onChange={(e) => onFile(e.target.files?.[0])} />
              <Button icon="table" onClick={exportCsv}>Holdings as CSV</Button>
            </div>
            {importError && <Callout tone="warn">{importError}</Callout>}
            <div className="divider" />
            <Toggle checked={s.autoData !== false} onChange={(b) => set({ autoData: b })} label="Update market data and fund NAVs automatically" />
            <p className="mini-help">{ws.market.feedAt
              ? `Daily data last applied ${fmtDate(ws.market.asOf)}. Figures you type in yourself are never overwritten.`
              : 'Uses the daily data when it is available in this view. Figures you type in yourself are never overwritten.'}</p>
            <div className="divider" />
            <div className="row">
              {examples > 0 && <Button onClick={() => setConfirm('examples')}>Remove example portfolios</Button>}
              <Button variant="danger" icon="trash" onClick={() => setConfirm('reset')}>Reset everything</Button>
            </div>
          </div>
        </Card>
        <Card className="span-6" title="About Arzish" sub="Portfolio forecast analyzer">
          <KV rows={[
            ['Market data', ws.market.feedAt ? `Daily, last ${fmtDate(ws.market.asOf)}` : `Snapshot ${fmtDate(DEFAULT_MARKET.asOf)}`],
            ['Tax rules', 'TY2027 (July 2026 to June 2027)'],
            ['Simulation', 'Monthly Monte Carlo, 9 linked factors'],
            ['AI analyst', __WEB__ ? 'Claude, by Anthropic' : 'Claude Opus 5.5'],
          ]} />
          <p className="mini-help" style={{ marginTop: 10 }}>Arzish gives educational estimates, not investment, tax or Shariah advice. Forecasts are ranges, not promises; markets can do worse than any simulation. Check important decisions with a licensed adviser and your own scholar.</p>
        </Card>
      </div>

      {confirm === 'reset' && (
        <Modal title="Reset everything?" onClose={() => setConfirm(null)} footer={<>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { clearLocal(); replace(createWorkspace()); setConfirm(null); toast('Workspace reset'); go('overview'); }}>Reset</Button>
        </>}>
          <p>All portfolios, goals, scenarios, pinned charts and settings are replaced with the starting examples. Export a backup first if you might need them.</p>
        </Modal>
      )}
      {confirm === 'examples' && (
        <Modal title="Remove example portfolios?" onClose={() => setConfirm(null)} footer={<>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => {
            update((w) => {
              const keep = w.portfolios.filter((p) => !p.isExample);
              if (!keep.length) return w;
              return { ...w, portfolios: keep, activeId: keep.some((p) => p.id === w.activeId) ? w.activeId : keep[0].id };
            });
            setConfirm(null);
            toast(own ? 'Examples removed' : 'Create a portfolio of your own first');
          }}>Remove</Button>
        </>}>
          <p>{own ? `The ${examples} example portfolio${examples === 1 ? '' : 's'} will be removed. Your own portfolios stay.` : 'You have no portfolio of your own yet, so the examples will stay. Start one from the portfolio menu first.'}</p>
        </Modal>
      )}
      {confirm && typeof confirm === 'object' && confirm.kind === 'import' && (
        <Modal title="Replace your workspace with this backup?" onClose={() => setConfirm(null)} footer={<>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => { replace(confirm.ws); setConfirm(null); toast('Backup restored'); }}>Restore backup</Button>
        </>}>
          <p>The backup holds {confirm.ws.portfolios.length} portfolio{confirm.ws.portfolios.length === 1 ? '' : 's'} ({confirm.ws.portfolios.map((p) => p.name).slice(0, 4).join(', ')}{confirm.ws.portfolios.length > 4 ? '…' : ''}), saved {fmtDate(confirm.ws.updatedAt.slice(0, 10))}. It replaces everything currently here.</p>
        </Modal>
      )}
    </div>
  );
}
