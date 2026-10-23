import React, { useEffect, useId, useRef, useState } from 'react';
import { fmtNum } from '../../engine/format';
import { Icon } from './Icon';

export function Card({ title, sub, actions, children, className, flush, footer, id }: {
  title?: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode;
  className?: string; flush?: boolean; footer?: React.ReactNode; id?: string;
}) {
  return (
    <section className={'card ' + (className ?? '')} id={id}>
      {(title || actions) && (
        <div className="card-h">
          <div style={{ minWidth: 0 }}>
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={'card-b' + (flush ? ' flush' : '')}>{children}</div>
      {footer && <div className="card-f">{footer}</div>}
    </section>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'ai' | 'default'; size?: 'sm' | 'md'; icon?: string; iconOnly?: boolean };

export function Button({ variant = 'default', size = 'md', icon, iconOnly, children, className, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' ? variant : '', size === 'sm' ? 'sm' : '', iconOnly ? 'icon' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {icon && <Icon name={icon} />}
      {iconOnly ? <span className="sr-only">{children}</span> : children}
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange, size, label }: { value: T; options: { value: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm'; label?: string }) {
  return (
    <div className={'seg' + (size === 'sm' ? ' sm' : '')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ pressed, onClick, children, color, title }: { pressed?: boolean; onClick?: () => void; children: React.ReactNode; color?: string; title?: string }) {
  return (
    <button type="button" className="chip" aria-pressed={!!pressed} onClick={onClick} title={title}>
      {color && <span className="swatch" style={{ background: color }} />}
      {children}
    </button>
  );
}

export function Badge({ children, tone }: { children: React.ReactNode; tone?: 'accent' | 'example' }) {
  return <span className={'badge' + (tone ? ' ' + tone : '')}>{children}</span>;
}

export type Tone = 'good' | 'warn' | 'serious' | 'critical' | 'neutral';
export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const icon = tone === 'good' ? 'check' : tone === 'neutral' ? 'info' : 'alert';
  return (
    <span className={'pill ' + tone}>
      <Icon name={icon} />
      {children}
    </span>
  );
}

export function probTone(p: number): Tone {
  if (p >= 0.8) return 'good';
  if (p >= 0.5) return 'warn';
  return 'critical';
}
export function probLabel(p: number): string {
  if (p >= 0.8) return 'On track';
  if (p >= 0.5) return 'Needs attention';
  return 'At risk';
}

export function Field({ label, hint, children, full, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; full?: boolean; htmlFor?: string }) {
  return (
    <div className={'field' + (full ? ' full' : '')}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Numeric input that shows grouped digits when not focused. */
export function NumberInput({ value, onChange, id, min, max, step, prefix, suffix, decimals = 2, placeholder, style, groupStyle = 'intl', ariaLabel }: {
  value: number | undefined; onChange: (v: number | undefined) => void; id?: string; min?: number; max?: number; step?: number;
  prefix?: string; suffix?: string; decimals?: number; placeholder?: string; style?: React.CSSProperties; groupStyle?: 'lakh' | 'intl'; ariaLabel?: string;
}) {
  const [focus, setFocus] = useState(false);
  const [text, setText] = useState('');
  const shown = focus ? text : value === undefined || value === null || !isFinite(value) ? '' : formatShown(value, decimals, groupStyle);
  function formatShown(v: number, d: number, g: 'lakh' | 'intl') {
    const dec = Math.abs(v) >= 1000 ? 0 : Math.min(d, (String(v).split('.')[1] ?? '').length);
    return fmtNum(v, g, dec);
  }
  const input = (
    <input
      id={id}
      className="input num"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={shown}
      placeholder={placeholder}
      style={style}
      onFocus={() => {
        setFocus(true);
        setText(value === undefined || value === null || !isFinite(value) ? '' : String(value));
      }}
      onBlur={() => setFocus(false)}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9.\-]/g, '');
        setText(t);
        if (t === '' || t === '-' || t === '.') onChange(undefined);
        else {
          let n = Number(t);
          if (!isFinite(n)) return;
          if (min !== undefined && n < min) n = min;
          if (max !== undefined && n > max) n = max;
          onChange(n);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const s = step ?? 1;
          let n = (value ?? 0) + (e.key === 'ArrowUp' ? s : -s);
          if (min !== undefined) n = Math.max(min, n);
          if (max !== undefined) n = Math.min(max, n);
          n = Math.round(n * 1e6) / 1e6;
          onChange(n);
          setText(String(n));
        }
      }}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <div className="input-group">
      {prefix && <span className="addon">{prefix}</span>}
      {input}
      {suffix && <span className="addon">{suffix}</span>}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, id, ariaLabel, style }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; id?: string; ariaLabel?: string; style?: React.CSSProperties }) {
  return (
    <select id={id} className="select" value={value} aria-label={ariaLabel} style={style} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (b: boolean) => void; label: React.ReactNode; id?: string }) {
  const auto = useId();
  const iid = id ?? auto;
  return (
    <label className="toggle" htmlFor={iid}>
      <input id={iid} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Slider({ label, value, min, max, step, onChange, display, id }: { label: React.ReactNode; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string; id?: string }) {
  const auto = useId();
  const iid = id ?? auto;
  return (
    <div className="slider-row">
      <label className="label" htmlFor={iid}>{label}</label>
      <span className="val num">{display}</span>
      <input id={iid} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" type="button" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>('.modal-b input, .modal-b select, .modal-b textarea, .modal-b button') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-h">
          <div className="modal-title">{title}</div>
          <Button variant="ghost" iconOnly icon="close" onClick={onClose}>Close</Button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </>
  );
}

export function Empty({ icon = 'info', title, children, action }: { icon?: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div className="strong ink2">{title}</div>
      {children && <div className="small" style={{ maxWidth: 420 }}>{children}</div>}
      {action}
    </div>
  );
}

export function Callout({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'good'; children: React.ReactNode }) {
  return (
    <div className={'callout ' + tone}>
      <Icon name={tone === 'warn' ? 'alert' : tone === 'good' ? 'check' : 'info'} />
      <div>{children}</div>
    </div>
  );
}

export function Stat({ label, value, note, plain, title }: { label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode; plain?: boolean; title?: string }) {
  return (
    <div className={'stat' + (plain ? ' plain' : '')} title={title}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Meter({ value, color, label }: { value: number; color: string; label?: string }) {
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function BarList({ rows }: { rows: { key: string; label: React.ReactNode; value: string; frac: number; color: string; sub?: string }[] }) {
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div className="bl-row" key={r.key}>
          <div className="bl-name">
            <span className="swatch" style={{ background: r.color }} />
            <span>{r.label}</span>
          </div>
          <div className="bl-val num">
            {r.value}
            {r.sub && <span className="muted small" style={{ fontWeight: 500, marginLeft: 6 }}>{r.sub}</span>}
          </div>
          <div className="bl-track"><span style={{ width: `${Math.max(0.5, r.frac * 100)}%`, background: r.color }} /></div>
        </div>
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Working" />;
}

export function KV({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function StackBar({ parts }: { parts: { key: string; frac: number; color: string; label: string }[] }) {
  return (
    <div className="stackbar" role="img" aria-label={parts.map((p) => `${p.label} ${(p.frac * 100).toFixed(0)}%`).join(', ')}>
      {parts.filter((p) => p.frac > 0).map((p) => (
        <span key={p.key} style={{ width: `${p.frac * 100}%`, background: p.color }} title={`${p.label}: ${(p.frac * 100).toFixed(1)}%`} />
      ))}
    </div>
  );
}

/** Copy text with a fallback to selecting it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
