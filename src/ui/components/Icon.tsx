import React from 'react';

const P: Record<string, React.ReactNode> = {
  overview: (<><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" /><rect x="13.5" y="11" width="7" height="9.5" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /></>),
  holdings: (<><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>),
  allocation: (<><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z" /><path d="M15 3.8A8.5 8.5 0 0 1 20.2 9H15z" /></>),
  income: (<><ellipse cx="12" cy="6.5" rx="7" ry="3" /><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /><path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>),
  forecast: (<><path d="M3.5 19.5h17" /><path d="M4.5 15.5l4.5-4.5 3.5 3 6.5-7" /><path d="M15.5 7h3.5v3.5" /></>),
  goals: (<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>),
  compare: (<><rect x="3.5" y="10" width="4" height="10" rx="1" /><rect x="10" y="4" width="4" height="16" rx="1" /><rect x="16.5" y="7" width="4" height="13" rx="1" /></>),
  risk: (<><path d="M12 3.5l7.5 3v5.5c0 4.3-3.2 7.7-7.5 8.5-4.3-.8-7.5-4.2-7.5-8.5V6.5z" /><path d="M12 8.5v4" /><circle cx="12" cy="15.5" r=".8" /></>),
  stress: (<><path d="M13 3.5L5.5 13.5H11l-1 7 7.5-10H12z" /></>),
  optimizer: (<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>),
  tax: (<><path d="M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z" /><path d="M9 8.5h6M9 12h6M9 15.5h3" /></>),
  markets: (<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5S9.5 5.8 12 3.5z" /></>),
  insights: (<><path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z" /><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V20.5a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3.5a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>),
  plus: (<><path d="M12 5v14M5 12h14" /></>),
  upload: (<><path d="M12 15.5V4M7.5 8.5L12 4l4.5 4.5" /><path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" /></>),
  download: (<><path d="M12 4v11.5M7.5 11L12 15.5 16.5 11" /><path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" /></>),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>),
  close: (<><path d="M6 6l12 12M18 6L6 18" /></>),
  edit: (<><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>),
  trash: (<><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></>),
  copy: (<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>),
  chevronDown: (<><path d="M6 9l6 6 6-6" /></>),
  chevronRight: (<><path d="M9 6l6 6-6 6" /></>),
  menu: (<><path d="M4 7h16M4 12h16M4 17h16" /></>),
  info: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r=".9" /></>),
  check: (<><path d="M5 12.5l4.5 4.5L19 7.5" /></>),
  refresh: (<><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9" /><path d="M19.5 4v5h-5" /></>),
  pin: (<><path d="M9 4h6l-1 6 3.5 3.5h-11L10 10z" /><path d="M12 13.5V20" /></>),
  external: (<><path d="M14 4.5h5.5V10M19.5 4.5L11 13" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>),
  alert: (<><path d="M12 4l9 15.5H3z" /><path d="M12 10v4.5" /><circle cx="12" cy="17" r=".8" /></>),
  sparkle: (<><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M5 16.5l.7 1.8 1.8.7-1.8.7L5 21.5l-.7-1.8-1.8-.7 1.8-.7z" /></>),
  send: (<><path d="M4.5 12L20 4.5l-4 15.5-4-6.5z" /><path d="M12 13.5L20 4.5" /></>),
  stop: (<><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></>),
  image: (<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M20.5 16l-5-5-8 8.5" /></>),
  file: (<><path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" /><path d="M13.5 3.5v5h5" /></>),
  filter: (<><path d="M4 5.5h16l-6.2 7.3v5.7l-3.6 1.8v-7.5z" /></>),
  arrowUp: (<><path d="M12 19V5M6 11l6-6 6 6" /></>),
  arrowDown: (<><path d="M12 5v14M6 13l6 6 6-6" /></>),
  wallet: (<><path d="M4.5 7.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V6a1.5 1.5 0 0 1 1.5-1.5H17" /><circle cx="16" cy="13.5" r="1.2" /></>),
  home: (<><path d="M4 11l8-6.5 8 6.5" /><path d="M6 9.5v10h12v-10" /><path d="M10 19.5v-5h4v5" /></>),
  lock: (<><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>),
  dot: (<><circle cx="12" cy="12" r="3" /></>),
  table: (<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" /></>),
  chart: (<><path d="M4 19.5h16" /><path d="M7 16v-5M12 16V7M17 16v-8" /></>),
  calendar: (<><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>),
  globe: (<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /></>),
  minus: (<><path d="M5 12h14" /></>),
  bell: (<><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>),
  user: (<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>),
  users: (<><circle cx="9" cy="9" r="3" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><path d="M15.5 6.3a3 3 0 0 1 0 5.4M17 14.6c1.8.5 3 1.9 3.5 4.4" /></>),
  logout: (<><path d="M14 4.5H6.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H14" /><path d="M10.5 12H20M16.5 8.5 20 12l-3.5 3.5" /></>),
  shield: (<><path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6z" /><path d="m9 12 2 2 4-4" /></>),
  mail: (<><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>),
  gift: (<><rect x="4" y="9" width="16" height="11" rx="1.5" /><path d="M3 9h18M12 9v11M12 9c-1.5-3.5-5-3.8-5-1.5S10 9 12 9zM12 9c1.5-3.5 5-3.8 5-1.5S14 9 12 9z" /></>),
  card: (<><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></>),
  message: (<><path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5v-3.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" /></>),
  key: (<><circle cx="8" cy="15" r="3.5" /><path d="m10.5 12.5 8-8M16 7l2.5 2.5M14 9l2 2" /></>),
  bolt: (<><path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12z" /></>),
  database: (<><ellipse cx="12" cy="6" rx="7" ry="2.5" /><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></>),
  list: (<><path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" /></>),
  trend: (<><path d="M3.5 17 9 11.5l3.5 3.5 8-8" /><path d="M15 7h5.5v5.5" /></>),
};

export function Icon({ name, size, className, title }: { name: keyof typeof P | string; size?: number; className?: string; title?: string }) {
  const body = P[name] ?? P.dot;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {body}
    </svg>
  );
}

export function BrandMark({ size = 28 }: { size?: number }) {
  // A fan of three widening bands: the forecast range, read from today outward.
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className="brand-mark" aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="var(--accent)" />
      <path d="M7 22.5 L25 9 L25 14.5 Z" fill="var(--accent-ink)" opacity="0.35" />
      <path d="M7 22.5 L25 12 L25 19 Z" fill="var(--accent-ink)" opacity="0.6" />
      <path d="M7 22.5 L25 15.2 L25 16.8 Z" fill="var(--accent-ink)" />
      <circle cx="7" cy="22.5" r="2" fill="var(--accent-ink)" />
    </svg>
  );
}
