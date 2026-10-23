// Arzish engine for edge functions, bundled from src/engine/server.ts by scripts/build-functions.mjs. Do not edit.

// src/engine/feed.ts
var isNum = (v) => typeof v === "number" && isFinite(v);
var CURRENCIES = ["USD", "AED", "SAR", "EUR", "GBP"];
function parseFeed(raw) {
  if (!raw || typeof raw !== "object") return null;
  const d = raw;
  if (typeof d.updatedAt !== "string" || !d.market || typeof d.market !== "object") return null;
  return d;
}
function parseFunds(raw) {
  if (!raw || typeof raw !== "object") return null;
  const d = raw;
  if (!Array.isArray(d.funds)) return null;
  const funds = d.funds.filter((f) => f && typeof f.id === "string" && typeof f.n === "string" && isNum(f.nav) && f.nav > 0);
  return { ...d, funds, count: funds.length };
}
function parsePsx(raw) {
  if (!raw || typeof raw !== "object") return null;
  const d = raw;
  if (!Array.isArray(d.stocks) || typeof d.asOf !== "string") return null;
  const stocks = d.stocks.filter((q) => q && typeof q.s === "string" && isNum(q.p) && q.p > 0);
  return stocks.length ? { ...d, stocks, count: stocks.length } : null;
}
var inRange = (v, lo, hi) => isNum(v) && v >= lo && v <= hi;
function applyFeed(m, f) {
  const lock = new Set(m.locked ?? []);
  const src = f.market;
  const out = { ...m, fx: { ...m.fx }, nss: { ...m.nss }, tbill: { ...m.tbill } };
  const scalar = (key, lo, hi, dateKey) => {
    const v = src[key];
    if (lock.has(key) || !inRange(v, lo, hi)) return false;
    out[key] = v;
    if (dateKey && typeof src[dateKey] === "string") out[dateKey] = src[dateKey];
    return true;
  };
  if (src.fx && !lock.has("fx")) {
    let any = false;
    for (const c of CURRENCIES) {
      const v = src.fx[c];
      if (inRange(v, 0.01, 5e3)) {
        out.fx[c] = v;
        any = true;
      }
    }
    if (any && typeof src.fxDate === "string") out.fxDate = src.fxDate;
  }
  scalar("goldTola", 1e4, 5e6, "goldDate");
  scalar("silverTola", 100, 2e5);
  scalar("goldUsdOz", 100, 5e4);
  scalar("policyRate", 0, 50, "policyDate");
  if (scalar("cpi", -20, 100) && typeof src.cpiMonth === "string") out.cpiMonth = src.cpiMonth;
  scalar("coreCpi", -20, 100);
  scalar("npcUsd", 0, 30);
  scalar("btcUsd", 100, 1e7, "btcDate");
  if (scalar("kse100", 1e3, 1e7, "kse100Date")) {
    scalar("kse100Ytd", -100, 1e3);
    scalar("kse100Ath", 1e3, 1e7);
  }
  scalar("fedFunds", 0, 30);
  scalar("ust10y", 0, 30);
  if (src.tbill && !lock.has("tbill")) {
    for (const k of ["m1", "m3", "m6", "m12"]) {
      const v = src.tbill[k];
      if (inRange(v, 0, 60)) out.tbill[k] = v;
    }
    if (typeof src.tbill.date === "string") out.tbill.date = src.tbill.date;
  }
  if (src.nss && !lock.has("nss")) {
    for (const [k, v] of Object.entries(src.nss)) {
      if (!lock.has(`nss.${k}`) && inRange(v, 0, 60)) out.nss[k] = v;
    }
    if (typeof src.nssDate === "string") out.nssDate = src.nssDate;
  }
  const x = f.extra ?? {};
  if (x.crypto?.usd) {
    const c = {};
    for (const [k, v] of Object.entries(x.crypto.usd)) if (inRange(v, 0, 1e7)) c[k.toUpperCase()] = v;
    if (Object.keys(c).length) {
      out.crypto = c;
      out.cryptoDate = x.crypto.asOf;
    }
  }
  if (x.kibor) {
    const k = x.kibor;
    out.kibor = { m3: k.m3?.offer, m6: k.m6?.offer, m12: k.m12?.offer, date: k.asOf };
  }
  if (x.openMarket?.rates) {
    const om = {};
    for (const c of CURRENCIES) {
      const r = x.openMarket.rates[c];
      if (r && inRange(r.buy, 0.01, 5e3) && inRange(r.sell, 0.01, 5e3)) om[c] = { buy: r.buy, sell: r.sell };
    }
    if (Object.keys(om).length) {
      out.fxOpen = om;
      out.fxOpenDate = x.openMarket.asOf;
    }
  }
  if (x.reserves && (isNum(x.reserves.total) || isNum(x.reserves.sbp))) {
    out.reserves = { sbp: x.reserves.sbp, total: x.reserves.total, date: x.reserves.asOf };
  }
  if (x.usTreasury && inRange(x.usTreasury.y2, 0, 30)) {
    out.ust2y = x.usTreasury.y2;
    out.usDate = x.usTreasury.asOf;
  }
  if (x.psx?.indices) {
    const rows = {};
    for (const [k, r] of Object.entries(x.psx.indices)) {
      if (r && inRange(r.v, 100, 1e7)) rows[k] = { v: r.v, chg: isNum(r.chg) ? r.chg : void 0, chgPct: isNum(r.chgPct) ? r.chgPct : void 0 };
    }
    if (Object.keys(rows).length) out.psxIndices = { date: x.psx.asOf, time: x.psx.time, intraday: !!x.psx.intraday, rows };
  }
  out.asOf = typeof src.asOf === "string" ? src.asOf : f.updatedAt.slice(0, 10);
  out.feedAt = f.updatedAt;
  return out;
}
function categoryFromMufap(cat, sector = "") {
  const c = cat.toLowerCase();
  const sh = /shariah|islamic/.test(c) ? "yes" : "unknown";
  const isVps = /vps|pension/.test(c) || /pension/i.test(sector);
  if (isVps) {
    const sub2 = /equity/.test(c) ? "vps_equity" : /money/.test(c) ? "vps_mm" : /debt|income/.test(c) ? "vps_debt" : "vps_medium";
    return { type: "vps", sub: sub2, shariah: sh };
  }
  const islamic = sh === "yes";
  let sub = "income";
  if (/money\s*market|cash/.test(c)) sub = islamic ? "islamic_mm" : "money_market";
  else if (/index|exchange\s*traded|\betf\b/.test(c)) sub = "index";
  else if (/equity/.test(c)) sub = islamic ? "islamic_equity" : "equity";
  else if (/aggressive/.test(c)) sub = "aggressive_income";
  else if (/asset\s*alloc|balanced/.test(c)) sub = islamic ? "islamic_aa" : "balanced";
  else if (/capital\s*protect/.test(c)) sub = "capital_protected";
  else if (/fund\s*of\s*funds/.test(c)) sub = "fund_of_funds";
  else if (/commodit|gold/.test(c)) sub = "gold_fund";
  else if (/fixed\s*(rate|return)/.test(c)) sub = "fixed_return";
  else if (/international|feeder|global/.test(c)) sub = "global_fund";
  else if (/income|debt|sovereign|government/.test(c)) sub = islamic ? "islamic_income" : "income";
  return { type: "mutual_fund", sub, shariah: sh };
}
function fundLabel(f) {
  const { type } = categoryFromMufap(f.cat, f.sec);
  if (type !== "vps") return f.n;
  const part = /equity/i.test(f.cat) ? "Equity" : /money/i.test(f.cat) ? "Money Market" : /debt|income/i.test(f.cat) ? "Debt" : /gold|commod/i.test(f.cat) ? "Gold" : "";
  return part ? `${f.n} (${part} sub-fund)` : f.n;
}
var norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|fund|limited|ltd)\b/g, " ").replace(/\s+/g, " ").trim();
function matchFund(h, funds) {
  if (h.type !== "mutual_fund" && h.type !== "vps") return null;
  if (h.feedId) return funds.find((f) => f.id === h.feedId) ?? null;
  const key = norm(h.name);
  if (key.length < 6) return null;
  let cands = funds.filter((f) => norm(f.n) === key || norm(fundLabel(f)) === key);
  if (cands.length > 1) {
    const want = h.sub === "vps_equity" ? /equity/i : h.sub === "vps_debt" ? /debt|income/i : h.sub === "vps_mm" ? /money/i : null;
    if (want) cands = cands.filter((f) => want.test(f.cat));
  }
  return cands.length === 1 ? cands[0] : null;
}
function applyFundNavs(portfolios, funds) {
  let updated = 0;
  let linked = 0;
  const next = portfolios.map((p) => {
    if (p.isExample) return p;
    let changed = false;
    const holdings = p.holdings.map((h) => {
      const f = matchFund(h, funds.funds);
      if (!f) return h;
      const isNew = !h.feedId;
      const newer = !h.priceDate || f.d >= h.priceDate;
      if (!isNew && (!newer || h.price === f.nav)) return h;
      if (isNew) linked++;
      if (newer && h.price !== f.nav) updated++;
      changed = true;
      return { ...h, feedId: f.id, ...newer ? { price: f.nav, priceDate: f.d } : {} };
    });
    return changed ? { ...p, holdings } : p;
  });
  return { portfolios: next, updated, linked };
}
function cryptoUsd(m, ticker) {
  const t = (ticker ?? "").toUpperCase();
  if (!t) return void 0;
  const v = m.crypto?.[t];
  if (isNum(v)) return v;
  return t === "BTC" ? m.btcUsd : void 0;
}
var PSX_SECTOR_MAP = [
  [/commercial bank/i, "Commercial banks"],
  [/oil & gas exploration/i, "Oil & gas exploration"],
  [/oil & gas marketing/i, "Oil & gas marketing"],
  [/refinery/i, "Refinery"],
  [/fertili[sz]er/i, "Fertilizer"],
  [/cement/i, "Cement"],
  [/power generation/i, "Power generation"],
  [/technology|communication/i, "Technology"],
  [/automobile/i, "Automobiles"],
  [/pharma/i, "Pharmaceuticals"],
  [/food|sugar|vanaspati/i, "Food & personal care"],
  [/chemical|synthetic/i, "Chemicals"],
  [/textile|woollen|jute|apparel/i, "Textiles"],
  [/engineering/i, "Steel & engineering"],
  [/insurance/i, "Insurance"],
  [/inv\. banks|investment|securities/i, "Holding companies"],
  [/paper|packaging/i, "Paper & packaging"],
  [/glass|ceramic/i, "Glass & ceramics"],
  [/cable|electrical/i, "Electrical goods"],
  [/transport/i, "Transport"],
  [/tobacco/i, "Tobacco"],
  [/leather|tanner/i, "Leather & footwear"],
  [/exchange traded/i, "ETF"]
];
function sectorFromPsx(sec) {
  if (!sec) return "Other";
  for (const [re, name] of PSX_SECTOR_MAP) if (re.test(sec)) return name;
  return "Other";
}
function companyName(n) {
  return n.replace(/\s+/g, " ").replace(/\s*\(?\b(limited|ltd\.?)\)?\s*$/i, "").trim() || n.trim();
}
function psxQuote(psx, ticker) {
  const t = (ticker ?? "").trim().toUpperCase();
  if (!psx || !t) return void 0;
  return psx.stocks.find((q) => q.s === t);
}
var quoteDate = (psx, q) => q.d ?? psx.asOf;
function applyPsxPrices(portfolios, psx) {
  const bySym = new Map(psx.stocks.map((q) => [q.s, q]));
  let updated = 0;
  const next = portfolios.map((p) => {
    if (p.isExample) return p;
    let changed = false;
    const holdings = p.holdings.map((h) => {
      if (h.type !== "psx_stock" && h.type !== "psx_etf" || h.autoPrice === false || !h.ticker) return h;
      const q = bySym.get(h.ticker.trim().toUpperCase());
      if (!q) return h;
      const d = quoteDate(psx, q);
      if (h.priceDate && d < h.priceDate) return h;
      if (h.price === q.p && h.priceDate === d && h.priceSrc === "psx") return h;
      if (h.price !== q.p) updated++;
      changed = true;
      return { ...h, price: q.p, priceDate: d, priceSrc: "psx", ...h.sector ? {} : h.type === "psx_stock" ? { sector: sectorFromPsx(q.sec) } : {} };
    });
    return changed ? { ...p, holdings } : p;
  });
  return { portfolios: next, updated };
}

// src/engine/catalog.ts
var CLASS_META = {
  psx: { label: "PSX stocks", short: "PSX", slot: 1, blurb: "Shares and ETFs listed on the Pakistan Stock Exchange" },
  funds: { label: "Mutual funds", short: "Funds", slot: 2, blurb: "Open-end funds and VPS pension sub-funds" },
  fixed: { label: "Cash & fixed income", short: "Fixed income", slot: 3, blurb: "NSS, T-bills, PIBs, deposits and foreign-currency cash" },
  gold: { label: "Gold & silver", short: "Gold", slot: 4, blurb: "Physical gold and silver" },
  realestate: { label: "Real estate", short: "Property", slot: 5, blurb: "Plots, homes, apartments and commercial property" },
  global: { label: "Global markets", short: "Global", slot: 6, blurb: "Foreign stocks, ETFs and bonds" },
  crypto: { label: "Crypto", short: "Crypto", slot: 7, blurb: "Bitcoin, Ether and other digital assets" },
  other: { label: "Other", short: "Other", slot: 0, blurb: "Provident fund, business stakes and custom assets" }
};
var TYPE_META = {
  psx_stock: { type: "psx_stock", label: "PSX stock", cls: "psx", unit: "shares", currency: "PKR", liquidity: "days", shariah: "unknown", hint: "Shares of a company listed on PSX" },
  psx_etf: { type: "psx_etf", label: "PSX ETF", cls: "psx", unit: "units", currency: "PKR", liquidity: "days", shariah: "unknown", hint: "Exchange-traded fund listed on PSX" },
  mutual_fund: { type: "mutual_fund", label: "Mutual fund", cls: "funds", unit: "units", currency: "PKR", liquidity: "days", shariah: "no", hint: "Open-end fund by MUFAP category" },
  vps: { type: "vps", label: "VPS pension", cls: "funds", unit: "units", currency: "PKR", liquidity: "locked", shariah: "no", hint: "Voluntary Pension Scheme allocation" },
  nss: { type: "nss", label: "National Savings", cls: "fixed", unit: "PKR", currency: "PKR", liquidity: "weeks", shariah: "no", hint: "Behbood, RIC, DSC, SSC, Sarwa Islamic\u2026" },
  govt_sec: { type: "govt_sec", label: "T-bill, PIB or sukuk", cls: "fixed", unit: "PKR", currency: "PKR", liquidity: "days", shariah: "no", hint: "Government securities, including via InvestPak" },
  deposit: { type: "deposit", label: "Bank deposit", cls: "fixed", unit: "PKR", currency: "PKR", liquidity: "instant", shariah: "no", hint: "Savings account, term deposit or current account" },
  cash: { type: "cash", label: "Cash in hand", cls: "fixed", unit: "PKR", currency: "PKR", liquidity: "instant", shariah: "yes", hint: "Physical cash or wallet balance" },
  fx_cash: { type: "fx_cash", label: "Foreign currency", cls: "fixed", unit: "amount", currency: "USD", liquidity: "instant", shariah: "no", hint: "USD, AED, SAR, GBP or EUR deposits, RDA, Naya Pakistan Certificates" },
  gold: { type: "gold", label: "Gold", cls: "gold", unit: "tola", currency: "PKR", liquidity: "days", shariah: "yes", hint: "Bars, coins or jewellery by weight and karat" },
  silver: { type: "silver", label: "Silver", cls: "gold", unit: "tola", currency: "PKR", liquidity: "days", shariah: "yes", hint: "Silver by weight" },
  property: { type: "property", label: "Property", cls: "realestate", unit: "property", currency: "PKR", liquidity: "months", shariah: "yes", hint: "Plot, house, apartment, commercial or agricultural land" },
  global_stock: { type: "global_stock", label: "Global stock", cls: "global", unit: "shares", currency: "USD", liquidity: "days", shariah: "unknown", hint: "Shares listed abroad (US, UK, Gulf\u2026)" },
  global_etf: { type: "global_etf", label: "Global ETF", cls: "global", unit: "units", currency: "USD", liquidity: "days", shariah: "unknown", hint: "Foreign ETFs such as VOO, VT or UCITS funds" },
  global_bond: { type: "global_bond", label: "Global bond", cls: "global", unit: "units", currency: "USD", liquidity: "days", shariah: "no", hint: "US Treasuries, bond ETFs, Eurobonds" },
  crypto: { type: "crypto", label: "Crypto", cls: "crypto", unit: "coins", currency: "USD", liquidity: "days", shariah: "unknown", hint: "Bitcoin, Ether, stablecoins\u2026" },
  retirement: { type: "retirement", label: "Provident fund or pension", cls: "other", unit: "PKR", currency: "PKR", liquidity: "locked", shariah: "unknown", hint: "Employer provident fund, gratuity or pension balance" },
  business: { type: "business", label: "Business stake", cls: "other", unit: "PKR", currency: "PKR", liquidity: "locked", shariah: "unknown", hint: "Private business or startup equity" },
  custom: { type: "custom", label: "Custom asset", cls: "other", unit: "PKR", currency: "PKR", liquidity: "months", shariah: "unknown", hint: "Anything else, with your own return and risk" }
};
var M = (eq, income, cash, gold = 0, global = 0) => ({ eq, income, cash, gold, global });
var FUND_CATEGORIES = [
  { key: "equity", label: "Equity", mix: M(0.92, 0, 0.08), ter: 3.5, shariah: "no" },
  { key: "islamic_equity", label: "Islamic equity", mix: M(0.92, 0, 0.08), ter: 3.5, shariah: "yes" },
  { key: "index", label: "Index tracker", mix: M(0.98, 0, 0.02), ter: 1.5, shariah: "no" },
  { key: "balanced", label: "Balanced / asset allocation", mix: M(0.5, 0.4, 0.1), ter: 3, shariah: "no" },
  { key: "islamic_aa", label: "Islamic asset allocation", mix: M(0.5, 0.4, 0.1), ter: 3, shariah: "yes" },
  { key: "income", label: "Income", mix: M(0, 0.9, 0.1), ter: 1.5, shariah: "no" },
  { key: "islamic_income", label: "Islamic income", mix: M(0, 0.9, 0.1), ter: 1.3, shariah: "yes" },
  { key: "aggressive_income", label: "Aggressive fixed income", mix: M(0, 1, 0), ter: 1.8, shariah: "no", incomeSpread: 1 },
  { key: "money_market", label: "Money market", mix: M(0, 0, 1), ter: 1, shariah: "no" },
  { key: "islamic_mm", label: "Islamic money market", mix: M(0, 0, 1), ter: 0.9, shariah: "yes" },
  { key: "fixed_return", label: "Fixed rate / return", mix: M(0, 0, 1), ter: 0.8, shariah: "unknown", fixed: true },
  { key: "capital_protected", label: "Capital protected", mix: M(0.2, 0, 0.8), ter: 1.5, shariah: "no" },
  { key: "fund_of_funds", label: "Fund of funds", mix: M(0.4, 0.4, 0.2), ter: 2, shariah: "no" },
  { key: "gold_fund", label: "Commodity (gold)", mix: M(0, 0, 0.05, 0.95), ter: 2, shariah: "yes" },
  { key: "global_fund", label: "International / feeder", mix: M(0, 0, 0.05, 0, 0.95), ter: 2.5, shariah: "unknown" }
];
var VPS_SCHEMES = [
  { key: "vps_high", label: "High volatility (80% equity)", mix: M(0.8, 0.2, 0), ter: 1.8, shariah: "no" },
  { key: "vps_medium", label: "Medium volatility (50% equity)", mix: M(0.5, 0.4, 0.1), ter: 1.6, shariah: "no" },
  { key: "vps_low", label: "Low volatility (20% equity)", mix: M(0.2, 0.6, 0.2), ter: 1.4, shariah: "no" },
  { key: "vps_lower", label: "Lower volatility (no equity)", mix: M(0, 0.5, 0.5), ter: 1.2, shariah: "no" },
  { key: "vps_equity", label: "Equity sub-fund", mix: M(0.95, 0, 0.05), ter: 2, shariah: "no" },
  { key: "vps_debt", label: "Debt sub-fund", mix: M(0, 0.95, 0.05), ter: 1.3, shariah: "no" },
  { key: "vps_mm", label: "Money market sub-fund", mix: M(0, 0, 1), ter: 1, shariah: "no" }
];
function fundCategory(type, sub) {
  const list = type === "vps" ? VPS_SCHEMES : FUND_CATEGORIES;
  return list.find((c) => c.key === sub) ?? list[0];
}
var NSS_PRODUCTS = [
  { key: "BSC", label: "Behbood Savings Certificates", payout: "monthly", years: 10, shariah: "no", note: "Senior citizens, widows and persons with disabilities" },
  { key: "PBA", label: "Pensioners' Benefit Account", payout: "monthly", years: 10, shariah: "no", note: "Retired government and other pensioners" },
  { key: "SHUHADA", label: "Shuhada Family Welfare Account", payout: "monthly", years: 10, shariah: "no", note: "Families of shuhada" },
  { key: "RIC", label: "Regular Income Certificates", payout: "monthly", years: 5, shariah: "no", note: "Monthly profit" },
  { key: "SSC", label: "Special Savings Certificates", payout: "semiannual", years: 3, shariah: "no", note: "Profit every six months" },
  { key: "DSC", label: "Defence Savings Certificates", payout: "maturity", years: 10, shariah: "no", note: "Profit accumulates, paid at maturity" },
  { key: "STSC", label: "Short Term Savings Certificates", payout: "maturity", years: 1, shariah: "no", note: "3, 6 or 12 months" },
  { key: "SITA3", label: "Sarwa Islamic Term Account, 3 years", payout: "monthly", years: 3, shariah: "yes", note: "Shariah-compliant" },
  { key: "SITA5", label: "Sarwa Islamic Term Account, 5 years", payout: "monthly", years: 5, shariah: "yes", note: "Shariah-compliant" },
  { key: "SISA", label: "Sarwa Islamic Savings Account", payout: "monthly", years: 0, shariah: "yes", note: "Shariah-compliant, no fixed term" },
  { key: "PRIZE", label: "Prize bonds", payout: "none", years: 0, shariah: "unknown", note: "Return depends on draws" }
];
function nssProduct(key) {
  return NSS_PRODUCTS.find((p) => p.key === key) ?? NSS_PRODUCTS[3];
}
var DEPOSIT_KINDS = [
  { key: "savings", label: "Savings account", rate: 10, payout: "monthly", shariah: "no" },
  { key: "islamic_savings", label: "Islamic savings account", rate: 9.5, payout: "monthly", shariah: "yes" },
  { key: "tdr", label: "Term deposit", rate: 11, payout: "monthly", shariah: "no" },
  { key: "islamic_tdr", label: "Islamic term deposit", rate: 10.5, payout: "monthly", shariah: "yes" },
  { key: "current", label: "Current account", rate: 0, payout: "none", shariah: "yes" }
];
var GOVT_KINDS = [
  { key: "tbill", label: "Treasury bill", rate: 12, payout: "maturity", duration: 0.3, shariah: "no" },
  { key: "pib_fixed", label: "PIB, fixed rate", rate: 12, payout: "semiannual", duration: 3.5, shariah: "no" },
  { key: "pib_floating", label: "PIB, floating rate", rate: 12, payout: "semiannual", duration: 0.5, shariah: "no" },
  { key: "gis", label: "GOP Ijara sukuk", rate: 11.8, payout: "semiannual", duration: 0.5, shariah: "yes" },
  { key: "tfc", label: "Corporate TFC / sukuk", rate: 13, payout: "quarterly", duration: 1.5, shariah: "unknown" }
];
var FX_KINDS = [
  { key: "fcy_deposit", label: "Foreign currency deposit", rate: 1, shariah: "no" },
  { key: "rda", label: "Roshan Digital Account", rate: 1, shariah: "no" },
  { key: "npc", label: "Naya Pakistan Certificate", rate: 7.25, shariah: "no" },
  { key: "npc_islamic", label: "Naya Pakistan Certificate, Islamic", rate: 7, shariah: "yes" },
  { key: "cash", label: "Physical cash", rate: 0, shariah: "yes" }
];
var PROPERTY_KINDS = [
  { key: "residential_plot", label: "Residential plot" },
  { key: "house", label: "House" },
  { key: "apartment", label: "Apartment" },
  { key: "commercial_plot", label: "Commercial plot" },
  { key: "commercial", label: "Shop or office" },
  { key: "agricultural", label: "Agricultural land" },
  { key: "file", label: "Booking file" }
];
var CRYPTO_KINDS = [
  { key: "btc", label: "Bitcoin", beta: 1, idio: 0 },
  { key: "eth", label: "Ether", beta: 1.2, idio: 25 },
  { key: "alt", label: "Other coin", beta: 1.4, idio: 45 },
  { key: "stable", label: "Stablecoin", beta: 0, idio: 0, stable: true }
];
var PSX_SECTORS = {
  "Commercial banks": { beta: 0.9, dy: 10 },
  "Oil & gas exploration": { beta: 1.1, dy: 6 },
  "Oil & gas marketing": { beta: 1.2, dy: 6 },
  Refinery: { beta: 1.5, dy: 2 },
  Fertilizer: { beta: 0.75, dy: 10 },
  Cement: { beta: 1.3, dy: 3 },
  "Power generation": { beta: 0.85, dy: 11 },
  Technology: { beta: 1.3, dy: 2 },
  Automobiles: { beta: 1.15, dy: 6 },
  Pharmaceuticals: { beta: 0.9, dy: 3 },
  "Food & personal care": { beta: 0.6, dy: 4 },
  Chemicals: { beta: 1.1, dy: 6 },
  Textiles: { beta: 1, dy: 4 },
  "Steel & engineering": { beta: 1.35, dy: 4 },
  Insurance: { beta: 0.8, dy: 8 },
  "Holding companies": { beta: 1.1, dy: 6 },
  "Paper & packaging": { beta: 0.9, dy: 4 },
  "Glass & ceramics": { beta: 1.1, dy: 4 },
  "Electrical goods": { beta: 1.3, dy: 2 },
  Transport: { beta: 1, dy: 6 },
  Tobacco: { beta: 0.6, dy: 7 },
  Media: { beta: 1.2, dy: 3 },
  "Leather & footwear": { beta: 0.9, dy: 3 },
  ETF: { beta: 1, dy: 7 },
  Other: { beta: 1, dy: 5 }
};
var PSX_TICKERS = [
  { ticker: "MEBL", name: "Meezan Bank", sector: "Commercial banks", shariah: "yes" },
  { ticker: "BIPL", name: "BankIslami Pakistan", sector: "Commercial banks", shariah: "yes" },
  { ticker: "FABL", name: "Faysal Bank", sector: "Commercial banks", shariah: "yes" },
  { ticker: "MCB", name: "MCB Bank", sector: "Commercial banks", shariah: "no" },
  { ticker: "UBL", name: "United Bank", sector: "Commercial banks", shariah: "no" },
  { ticker: "HBL", name: "Habib Bank", sector: "Commercial banks", shariah: "no" },
  { ticker: "NBP", name: "National Bank of Pakistan", sector: "Commercial banks", shariah: "no" },
  { ticker: "BAHL", name: "Bank AL Habib", sector: "Commercial banks", shariah: "no" },
  { ticker: "BAFL", name: "Bank Alfalah", sector: "Commercial banks", shariah: "no" },
  { ticker: "ABL", name: "Allied Bank", sector: "Commercial banks", shariah: "no" },
  { ticker: "AKBL", name: "Askari Bank", sector: "Commercial banks", shariah: "no" },
  { ticker: "BOP", name: "The Bank of Punjab", sector: "Commercial banks", shariah: "no" },
  { ticker: "HMB", name: "Habib Metropolitan Bank", sector: "Commercial banks", shariah: "no" },
  { ticker: "OGDC", name: "Oil & Gas Development Co.", sector: "Oil & gas exploration" },
  { ticker: "PPL", name: "Pakistan Petroleum", sector: "Oil & gas exploration" },
  { ticker: "MARI", name: "Mari Energies", sector: "Oil & gas exploration" },
  { ticker: "POL", name: "Pakistan Oilfields", sector: "Oil & gas exploration" },
  { ticker: "PSO", name: "Pakistan State Oil", sector: "Oil & gas marketing" },
  { ticker: "APL", name: "Attock Petroleum", sector: "Oil & gas marketing" },
  { ticker: "SNGP", name: "Sui Northern Gas Pipelines", sector: "Oil & gas marketing" },
  { ticker: "SSGC", name: "Sui Southern Gas Co.", sector: "Oil & gas marketing" },
  { ticker: "ATRL", name: "Attock Refinery", sector: "Refinery" },
  { ticker: "NRL", name: "National Refinery", sector: "Refinery" },
  { ticker: "PRL", name: "Pakistan Refinery", sector: "Refinery" },
  { ticker: "CNERGY", name: "Cnergyico PK", sector: "Refinery" },
  { ticker: "FFC", name: "Fauji Fertilizer Co.", sector: "Fertilizer" },
  { ticker: "EFERT", name: "Engro Fertilizers", sector: "Fertilizer" },
  { ticker: "FATIMA", name: "Fatima Fertilizer", sector: "Fertilizer" },
  { ticker: "ENGROH", name: "Engro Holdings", sector: "Holding companies" },
  { ticker: "DAWH", name: "Dawood Hercules Corp.", sector: "Holding companies" },
  { ticker: "LUCK", name: "Lucky Cement", sector: "Cement" },
  { ticker: "DGKC", name: "D.G. Khan Cement", sector: "Cement" },
  { ticker: "MLCF", name: "Maple Leaf Cement", sector: "Cement" },
  { ticker: "FCCL", name: "Fauji Cement", sector: "Cement" },
  { ticker: "CHCC", name: "Cherat Cement", sector: "Cement" },
  { ticker: "PIOC", name: "Pioneer Cement", sector: "Cement" },
  { ticker: "KOHC", name: "Kohat Cement", sector: "Cement" },
  { ticker: "ACPL", name: "Attock Cement", sector: "Cement" },
  { ticker: "HUBC", name: "Hub Power Co.", sector: "Power generation" },
  { ticker: "KAPCO", name: "Kot Addu Power", sector: "Power generation" },
  { ticker: "NPL", name: "Nishat Power", sector: "Power generation" },
  { ticker: "KEL", name: "K-Electric", sector: "Power generation" },
  { ticker: "SYS", name: "Systems Ltd", sector: "Technology" },
  { ticker: "TRG", name: "TRG Pakistan", sector: "Technology" },
  { ticker: "AVN", name: "Avanceon", sector: "Technology" },
  { ticker: "NETSOL", name: "NetSol Technologies", sector: "Technology" },
  { ticker: "PTC", name: "Pakistan Telecommunication Co.", sector: "Technology" },
  { ticker: "AIRLINK", name: "Air Link Communication", sector: "Technology" },
  { ticker: "INDU", name: "Indus Motor Co.", sector: "Automobiles" },
  { ticker: "HCAR", name: "Honda Atlas Cars", sector: "Automobiles" },
  { ticker: "MTL", name: "Millat Tractors", sector: "Automobiles" },
  { ticker: "SAZEW", name: "Sazgar Engineering Works", sector: "Automobiles" },
  { ticker: "GHNI", name: "Ghandhara Industries", sector: "Automobiles" },
  { ticker: "ATLH", name: "Atlas Honda", sector: "Automobiles" },
  { ticker: "THALL", name: "Thal Ltd", sector: "Automobiles" },
  { ticker: "SEARL", name: "The Searle Co.", sector: "Pharmaceuticals" },
  { ticker: "AGP", name: "AGP Ltd", sector: "Pharmaceuticals" },
  { ticker: "ABOT", name: "Abbott Laboratories (Pakistan)", sector: "Pharmaceuticals" },
  { ticker: "HINOON", name: "Highnoon Laboratories", sector: "Pharmaceuticals" },
  { ticker: "FEROZ", name: "Ferozsons Laboratories", sector: "Pharmaceuticals" },
  { ticker: "CPHL", name: "Citi Pharma", sector: "Pharmaceuticals" },
  { ticker: "NESTLE", name: "Nestl\xE9 Pakistan", sector: "Food & personal care" },
  { ticker: "UPFL", name: "Unilever Pakistan Foods", sector: "Food & personal care" },
  { ticker: "NATF", name: "National Foods", sector: "Food & personal care" },
  { ticker: "FFL", name: "Fauji Foods", sector: "Food & personal care" },
  { ticker: "COLG", name: "Colgate-Palmolive Pakistan", sector: "Food & personal care" },
  { ticker: "EPCL", name: "Engro Polymer & Chemicals", sector: "Chemicals" },
  { ticker: "LCI", name: "Lucky Core Industries", sector: "Chemicals" },
  { ticker: "ILP", name: "Interloop", sector: "Textiles" },
  { ticker: "NML", name: "Nishat Mills", sector: "Textiles" },
  { ticker: "GATM", name: "Gul Ahmed Textile Mills", sector: "Textiles" },
  { ticker: "KTML", name: "Kohinoor Textile Mills", sector: "Textiles" },
  { ticker: "ISL", name: "International Steels", sector: "Steel & engineering" },
  { ticker: "INIL", name: "International Industries", sector: "Steel & engineering" },
  { ticker: "ASTL", name: "Amreli Steels", sector: "Steel & engineering" },
  { ticker: "MUGHAL", name: "Mughal Iron & Steel", sector: "Steel & engineering" },
  { ticker: "AICL", name: "Adamjee Insurance", sector: "Insurance", shariah: "no" },
  { ticker: "JLICL", name: "Jubilee Life Insurance", sector: "Insurance", shariah: "no" },
  { ticker: "EFUG", name: "EFU General Insurance", sector: "Insurance", shariah: "no" },
  { ticker: "PKGS", name: "Packages Ltd", sector: "Paper & packaging" },
  { ticker: "CEPB", name: "Century Paper & Board", sector: "Paper & packaging" },
  { ticker: "TGL", name: "Tariq Glass", sector: "Glass & ceramics" },
  { ticker: "GHGL", name: "Ghani Glass", sector: "Glass & ceramics" },
  { ticker: "PAEL", name: "Pak Elektron", sector: "Electrical goods" },
  { ticker: "PIBTL", name: "Pakistan International Bulk Terminal", sector: "Transport" },
  { ticker: "PAKT", name: "Pakistan Tobacco Co.", sector: "Tobacco", shariah: "no" },
  { ticker: "SRVI", name: "Service Industries", sector: "Leather & footwear" },
  { ticker: "HUMNL", name: "Hum Network", sector: "Media" }
];
var PSX_ETFS = [
  { ticker: "MZNPETF", name: "Meezan Pakistan ETF", sector: "ETF", shariah: "yes" },
  { ticker: "MIIETF", name: "Mahaana Islamic Index ETF", sector: "ETF", shariah: "yes" },
  { ticker: "NBPGETF", name: "NBP Pakistan Growth ETF", sector: "ETF" },
  { ticker: "NITGETF", name: "NIT Pakistan Gateway ETF", sector: "ETF" },
  { ticker: "UBLPETF", name: "UBL Pakistan Enterprise ETF", sector: "ETF" },
  { ticker: "JSMFETF", name: "JS Momentum Factor ETF", sector: "ETF" }
];
var GLOBAL_TICKERS = [
  { ticker: "VOO", name: "Vanguard S&P 500 ETF", sector: "US large cap", kind: "equity", beta: 1, dy: 1.2 },
  { ticker: "SPY", name: "SPDR S&P 500 ETF", sector: "US large cap", kind: "equity", beta: 1, dy: 1.2 },
  { ticker: "VTI", name: "Vanguard Total Stock Market ETF", sector: "US total market", kind: "equity", beta: 1.02, dy: 1.2 },
  { ticker: "QQQ", name: "Invesco QQQ Trust", sector: "US technology", kind: "equity", beta: 1.15, dy: 0.6 },
  { ticker: "VT", name: "Vanguard Total World Stock ETF", sector: "Global equity", kind: "equity", beta: 0.95, dy: 1.8 },
  { ticker: "VXUS", name: "Vanguard Total International Stock ETF", sector: "International equity", kind: "equity", beta: 0.9, dy: 2.9 },
  { ticker: "VWO", name: "Vanguard Emerging Markets ETF", sector: "Emerging markets", kind: "equity", beta: 1, dy: 2.8, idio: 8 },
  { ticker: "SCHD", name: "Schwab US Dividend Equity ETF", sector: "US dividend", kind: "equity", beta: 0.85, dy: 3.6 },
  { ticker: "VYM", name: "Vanguard High Dividend Yield ETF", sector: "US dividend", kind: "equity", beta: 0.85, dy: 2.7 },
  { ticker: "VWRA", name: "Vanguard FTSE All-World UCITS ETF (Acc)", sector: "Global equity", kind: "equity", beta: 0.95, dy: 0 },
  { ticker: "CSPX", name: "iShares Core S&P 500 UCITS ETF (Acc)", sector: "US large cap", kind: "equity", beta: 1, dy: 0 },
  { ticker: "IWDA", name: "iShares Core MSCI World UCITS ETF (Acc)", sector: "Global equity", kind: "equity", beta: 0.97, dy: 0 },
  { ticker: "EIMI", name: "iShares Core MSCI EM IMI UCITS ETF (Acc)", sector: "Emerging markets", kind: "equity", beta: 1, dy: 0, idio: 8 },
  { ticker: "AAPL", name: "Apple", sector: "Technology", kind: "equity", beta: 1.15, dy: 0.5, idio: 22 },
  { ticker: "MSFT", name: "Microsoft", sector: "Technology", kind: "equity", beta: 1.1, dy: 0.7, idio: 20 },
  { ticker: "NVDA", name: "NVIDIA", sector: "Technology", kind: "equity", beta: 1.6, dy: 0.1, idio: 40 },
  { ticker: "AMZN", name: "Amazon", sector: "Consumer", kind: "equity", beta: 1.2, dy: 0, idio: 25 },
  { ticker: "GOOGL", name: "Alphabet", sector: "Technology", kind: "equity", beta: 1.1, dy: 0.4, idio: 22 },
  { ticker: "META", name: "Meta Platforms", sector: "Technology", kind: "equity", beta: 1.25, dy: 0.3, idio: 28 },
  { ticker: "TSLA", name: "Tesla", sector: "Consumer", kind: "equity", beta: 1.7, dy: 0, idio: 45 },
  { ticker: "BRK.B", name: "Berkshire Hathaway", sector: "Financials", kind: "equity", beta: 0.85, dy: 0, idio: 14 },
  { ticker: "BND", name: "Vanguard Total Bond Market ETF", sector: "US bonds", kind: "bond", beta: 1, dy: 4 },
  { ticker: "TLT", name: "iShares 20+ Year Treasury Bond ETF", sector: "US long Treasuries", kind: "bond", beta: 2.4, dy: 4.4 },
  { ticker: "SGOV", name: "iShares 0-3 Month Treasury Bond ETF", sector: "US T-bills", kind: "bond", beta: 0.1, dy: 4 },
  { ticker: "GLD", name: "SPDR Gold Shares", sector: "Gold", kind: "gold", beta: 1, dy: 0 },
  { ticker: "IAU", name: "iShares Gold Trust", sector: "Gold", kind: "gold", beta: 1, dy: 0 },
  { ticker: "IBIT", name: "iShares Bitcoin Trust", sector: "Bitcoin", kind: "crypto", beta: 1, dy: 0 }
];
var TOLA_GRAMS = 11.6638;
var OZ_GRAMS = 31.1035;

// src/engine/types.ts
var CLASS_ORDER = ["psx", "funds", "fixed", "gold", "realestate", "global", "crypto", "other"];

// src/engine/valuation.ts
function holdingClass(h) {
  return TYPE_META[h.type]?.cls ?? "other";
}
function fxRate(c, m) {
  return m.fx[c] ?? 1;
}
function effectiveQty(h) {
  const q = Number(h.qty) || 0;
  if (h.type === "gold" || h.type === "silver") {
    let tola = q;
    if (h.unit === "gram") tola = q / TOLA_GRAMS;
    else if (h.unit === "oz") tola = q * OZ_GRAMS / TOLA_GRAMS;
    const purity = h.type === "gold" ? (h.karat ?? 24) / 24 : 1;
    return tola * purity;
  }
  return q;
}
function unitPrice(h, m) {
  if (h.useMarketPrice) {
    if (h.type === "gold") return m.goldTola;
    if (h.type === "silver") return m.silverTola;
    if (h.type === "crypto") {
      const usd = cryptoUsd(m, h.ticker);
      if (usd !== void 0) return h.currency === "USD" ? usd : usd * m.fx.USD / (m.fx[h.currency] || 1);
    }
  }
  return Number(h.price) || 0;
}
function valueLocal(h, m) {
  return effectiveQty(h) * unitPrice(h, m);
}
function valuePKR(h, m) {
  return valueLocal(h, m) * fxRate(h.currency, m);
}
function costPKR(h, m) {
  if (h.avgCost === void 0 || h.avgCost === null || !isFinite(h.avgCost)) return void 0;
  return effectiveQty(h) * h.avgCost * fxRate(h.currency, m);
}
function liabilityPKR(l, m) {
  return (Number(l.balance) || 0) * fxRate(l.currency, m);
}
function shariahOf(h) {
  if (h.shariah) return h.shariah;
  switch (h.type) {
    case "psx_stock":
      return PSX_TICKERS.find((t) => t.ticker === h.ticker)?.shariah ?? "unknown";
    case "psx_etf":
      return PSX_ETFS.find((t) => t.ticker === h.ticker)?.shariah ?? "unknown";
    case "mutual_fund":
    case "vps":
      return fundCategory(h.type, h.sub).shariah;
    case "nss":
      return nssProduct(h.sub).shariah;
    case "deposit":
      return DEPOSIT_KINDS.find((d) => d.key === h.sub)?.shariah ?? "no";
    case "govt_sec":
      return GOVT_KINDS.find((d) => d.key === h.sub)?.shariah ?? "no";
    case "fx_cash":
      return FX_KINDS.find((d) => d.key === h.sub)?.shariah ?? "no";
    default:
      return TYPE_META[h.type]?.shariah ?? "unknown";
  }
}
function liquidityOf(h) {
  if (h.liquidity) return h.liquidity;
  if (h.type === "deposit" && (h.sub === "tdr" || h.sub === "islamic_tdr")) return "weeks";
  if (h.type === "fx_cash" && (h.sub === "npc" || h.sub === "npc_islamic")) return "weeks";
  if (h.type === "nss" && h.sub === "SISA") return "days";
  if (h.type === "govt_sec" && h.sub === "tfc") return "weeks";
  return TYPE_META[h.type]?.liquidity ?? "months";
}
function sectorDefaults(sector) {
  return PSX_SECTORS[sector ?? "Other"] ?? PSX_SECTORS.Other;
}
function globalTicker(ticker) {
  if (!ticker) return void 0;
  return GLOBAL_TICKERS.find((t) => t.ticker === ticker.toUpperCase());
}
function cryptoKind(h) {
  const key = h.sub ?? (["USDT", "USDC"].includes((h.ticker ?? "").toUpperCase()) ? "stable" : (h.ticker ?? "").toUpperCase() === "BTC" ? "btc" : (h.ticker ?? "").toUpperCase() === "ETH" ? "eth" : "alt");
  return CRYPTO_KINDS.find((k) => k.key === key) ?? CRYPTO_KINDS[2];
}
function defaultRate(h, m) {
  switch (h.type) {
    case "nss":
      return m.nss[h.sub ?? "RIC"] ?? 11.5;
    case "deposit":
      return DEPOSIT_KINDS.find((d) => d.key === h.sub)?.rate ?? 10;
    case "govt_sec":
      return GOVT_KINDS.find((d) => d.key === h.sub)?.rate ?? m.tbill.m12;
    case "fx_cash":
      if (h.sub === "npc") return m.npcUsd;
      return FX_KINDS.find((d) => d.key === h.sub)?.rate ?? 0;
    default:
      return 0;
  }
}
function rateOf(h, m) {
  return h.rate !== void 0 && h.rate !== null && isFinite(h.rate) ? h.rate : defaultRate(h, m);
}
function payoutOf(h) {
  if (h.payout) return h.payout;
  switch (h.type) {
    case "psx_stock":
    case "psx_etf":
      return "semiannual";
    case "mutual_fund":
    case "vps":
      return "none";
    case "nss":
      return nssProduct(h.sub).payout;
    case "deposit":
      return DEPOSIT_KINDS.find((d) => d.key === h.sub)?.payout ?? "monthly";
    case "govt_sec":
      return GOVT_KINDS.find((d) => d.key === h.sub)?.payout ?? "semiannual";
    case "fx_cash":
      return h.sub === "npc" || h.sub === "npc_islamic" ? "maturity" : "monthly";
    case "property":
      return "monthly";
    case "global_stock":
    case "global_etf":
    case "global_bond":
      return "quarterly";
    default:
      return "none";
  }
}
function incomeYieldPct(h, m) {
  const v = valuePKR(h, m);
  switch (h.type) {
    case "psx_stock":
      return h.yieldPct ?? sectorDefaults(PSX_TICKERS.find((t) => t.ticker === h.ticker)?.sector ?? h.sector).dy;
    case "psx_etf":
      return h.yieldPct ?? PSX_SECTORS.ETF.dy;
    case "mutual_fund":
    case "vps": {
      if (payoutOf(h) === "none") return 0;
      if (h.yieldPct !== void 0) return h.yieldPct;
      const c = fundCategory(h.type, h.sub);
      return Math.max(0, c.mix.eq * 5 + (c.mix.income + c.mix.cash) * (m.tbill.m12 - c.ter));
    }
    case "nss":
      return h.sub === "PRIZE" ? h.yieldPct ?? 0 : rateOf(h, m);
    case "govt_sec":
    case "deposit":
    case "fx_cash":
      return rateOf(h, m);
    case "property": {
      if (v <= 0) return 0;
      const rent = (h.rentMonthly ?? 0) * 12 * (1 - (h.vacancyPct ?? 0) / 100) - (h.costsAnnual ?? 0);
      return rent / v * 100;
    }
    case "global_stock":
    case "global_etf":
      return h.yieldPct ?? globalTicker(h.ticker)?.dy ?? 1.5;
    case "global_bond":
      return h.yieldPct ?? globalTicker(h.ticker)?.dy ?? 4;
    default:
      return h.yieldPct ?? 0;
  }
}
function annualIncomePKR(h, m) {
  if (h.type === "property") {
    const rent = (h.rentMonthly ?? 0) * 12 * (1 - (h.vacancyPct ?? 0) / 100) - (h.costsAnnual ?? 0);
    return rent * fxRate(h.currency, m);
  }
  return valuePKR(h, m) * incomeYieldPct(h, m) / 100;
}
function hardCurrencyShare(h) {
  if (h.currency !== "PKR") return 1;
  if (h.type === "gold" || h.type === "silver") return 1;
  if (h.type === "mutual_fund" || h.type === "vps") {
    const c = fundCategory(h.type, h.sub);
    return c.mix.gold + c.mix.global;
  }
  return 0;
}
function subLabel(h) {
  switch (h.type) {
    case "mutual_fund":
      return FUND_CATEGORIES.find((c) => c.key === h.sub)?.label ?? "Mutual fund";
    case "vps":
      return VPS_SCHEMES.find((c) => c.key === h.sub)?.label ?? "VPS";
    case "nss":
      return NSS_PRODUCTS.find((c) => c.key === h.sub)?.label ?? "National Savings";
    case "deposit":
      return DEPOSIT_KINDS.find((c) => c.key === h.sub)?.label ?? "Deposit";
    case "govt_sec":
      return GOVT_KINDS.find((c) => c.key === h.sub)?.label ?? "Government security";
    case "fx_cash":
      return (FX_KINDS.find((c) => c.key === h.sub)?.label ?? "Foreign currency") + ` (${h.currency})`;
    case "psx_stock":
      return h.sector ?? PSX_TICKERS.find((t) => t.ticker === h.ticker)?.sector ?? "PSX stock";
    case "property":
      return [PROPERTY_KINDS.find((k) => k.key === h.sub)?.label ?? (h.sub ? h.sub.replace(/_/g, " ") : "Property"), h.city].filter(Boolean).join(", ");
    case "crypto":
      return cryptoKind(h).label;
    default:
      return TYPE_META[h.type]?.label ?? h.type;
  }
}
function computeTotals(holdings, liabilities, m) {
  const byClass = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0]));
  let assets = 0, cost = 0, costCovered = 0, income = 0, hard = 0, sy = 0, su = 0, liquidWeek = 0;
  for (const h of holdings) {
    const v = valuePKR(h, m);
    assets += v;
    byClass[holdingClass(h)] += v;
    const c = costPKR(h, m);
    if (c !== void 0) {
      cost += c;
      costCovered += v;
    }
    income += annualIncomePKR(h, m);
    hard += v * hardCurrencyShare(h);
    const s = shariahOf(h);
    if (s === "yes") sy += v;
    else if (s === "unknown") su += v;
    const l = liquidityOf(h);
    if (l === "instant" || l === "days") liquidWeek += v;
  }
  const liab = liabilities.reduce((s, l) => s + liabilityPKR(l, m), 0);
  const pnl = costCovered - cost;
  return {
    assets,
    liabilities: liab,
    netWorth: assets - liab,
    cost,
    costCovered,
    pnl,
    pnlPct: cost > 0 ? pnl / cost * 100 : 0,
    income,
    incomeYield: assets > 0 ? income / assets * 100 : 0,
    byClass,
    hardCurrency: assets > 0 ? hard / assets : 0,
    shariahYes: assets > 0 ? sy / assets : 0,
    shariahUnknown: assets > 0 ? su / assets : 0,
    liquidWeek: assets > 0 ? liquidWeek / assets : 0,
    count: holdings.length
  };
}
function classLabel(c) {
  return CLASS_META[c].label;
}

// src/engine/assumptions.ts
var SNAPSHOT_DATE = "2026-10-21";
var DEFAULT_MARKET = {
  asOf: SNAPSHOT_DATE,
  // PKR per unit of currency. USD/PKR interbank 277.00 (9 Oct 2026); AED and SAR pegged to USD;
  // EUR from EUR/USD 1.1225 (21 Oct 2026); GBP approximate.
  fx: { PKR: 1, USD: 277, AED: 75.43, SAR: 73.87, EUR: 310.93, GBP: 363 },
  fxDate: "2026-10-09",
  goldTola: 440636,
  silverTola: 6256,
  goldUsdOz: 4181,
  goldDate: "2026-10-17",
  kse100: 167089.27,
  kse100Date: "2026-10-09",
  kse100Ytd: -4,
  kse100Ath: 188579,
  policyRate: 11.5,
  policyDate: "2026-09-14",
  cpi: 10.26,
  cpiMonth: "Sep 2026",
  coreCpi: 8.6,
  tbill: { m1: 11.5, m3: 12, m6: 12.4, m12: 12.5, date: "2026-10-14" },
  nss: {
    BSC: 12.72,
    PBA: 12.72,
    SSC: 11.82,
    DSC: 11.8,
    RIC: 11.76,
    STSC: 11.31,
    SITA3: 11.57,
    SITA5: 11.7,
    SISA: 11.33,
    SHUHADA: 12.72,
    PRIZE: 0
  },
  nssDate: "2026-10-01",
  npcUsd: 7.25,
  btcUsd: 82264,
  btcDate: "2026-10-19",
  sp500: 7651.54,
  sp500Date: "2026-09-30",
  sp500Ytd: 12.7,
  fedFunds: 4,
  ust10y: 5.28
};
var DEFAULT_CORR = [
  [1, 0.35, 0, 0.05, 0.2, 0.15, -0.45, -0.35, -0.25],
  [0.35, 1, 0.1, 0.1, 0.05, 0.45, -0.25, -0.05, -0.05],
  [0, 0.1, 1, 0.3, 0, 0.05, 0.05, 0, 0],
  [0.05, 0.1, 0.3, 1, 0.05, 0.15, 0.05, 0, 0.1],
  [0.2, 0.05, 0, 0.05, 1, 0.05, 0.15, -0.2, 0.35],
  [0.15, 0.45, 0.05, 0.15, 0.05, 1, -0.05, -0.05, 0],
  [-0.45, -0.25, 0.05, 0.05, 0.15, -0.05, 1, 0.45, 0.5],
  [-0.35, -0.05, 0, 0, -0.2, -0.05, 0.45, 1, 0.6],
  [-0.25, -0.05, 0, 0.1, 0.35, 0, 0.5, 0.6, 1]
];
var DEFAULT_ASSUMPTIONS = {
  factors: {
    psx: { cagr: 15, vol: 27 },
    gleq: { cagr: 7, vol: 16 },
    glbond: { cagr: 5, vol: 6 },
    gold: { cagr: 5, vol: 15 },
    re: { cagr: 8, vol: 12 },
    crypto: { cagr: 10, vol: 60 }
  },
  corr: DEFAULT_CORR.map((r) => r.slice()),
  macro: {
    rate0: 12,
    rateLR: 10,
    rateVol: 2,
    rateKappa: 0.35,
    cpi0: 10.3,
    cpiLR: 8,
    cpiVol: 2.5,
    cpiKappa: 0.5,
    fxDrift: 4.2,
    fxVol: 5,
    jumpProb: 12,
    jumpSize: 18,
    jumpPsx: -10,
    jumpRate: 2,
    jumpCpi: 3,
    usInflation: 2.8,
    usdRate: 4
  },
  spreads: {
    savings: -1.5,
    tdr: -0.5,
    mmf: -0.3,
    income: 0.5,
    incomeDuration: 1.5,
    nssReinvest: 0.3,
    retirement: 0.5
  },
  asOf: SNAPSHOT_DATE
};

// src/engine/format.ts
var LAKH = 1e5;
var CRORE = 1e7;
function trimZeros(s) {
  if (s.indexOf(".") < 0) return s;
  return s.replace(/\.?0+$/, "");
}
function groupLakh(intPart) {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  let rest = intPart.slice(0, -3);
  const parts = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return parts.join(",") + "," + last3;
}
function groupIntl(intPart) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function fmtNum(v, style = "intl", decimals = 0) {
  if (!isFinite(v)) return "\u2013";
  const neg = v < 0;
  const abs = Math.abs(v);
  const fixed = abs.toFixed(decimals);
  const [i, d] = fixed.split(".");
  const g = style === "lakh" ? groupLakh(i) : groupIntl(i);
  return (neg ? "-" : "") + g + (d ? "." + d : "");
}
function compactLakh(abs) {
  if (abs >= CRORE) {
    const cr = abs / CRORE;
    const dec = cr >= 1e3 ? 0 : cr >= 100 ? 1 : 2;
    return trimZeros(cr.toFixed(dec)).replace(/^(\d+)/, (m) => groupLakh(m)) + " Cr";
  }
  if (abs >= LAKH) {
    const l = abs / LAKH;
    return trimZeros(l.toFixed(l >= 10 ? 1 : 2)) + " lakh";
  }
  return fmtNum(abs, "lakh");
}
function compactIntl(abs) {
  if (abs >= 1e12) return trimZeros((abs / 1e12).toFixed(2)) + "T";
  if (abs >= 1e9) return trimZeros((abs / 1e9).toFixed(abs >= 1e11 ? 0 : 2)) + "B";
  if (abs >= 1e6) return trimZeros((abs / 1e6).toFixed(abs >= 1e8 ? 0 : abs >= 1e7 ? 1 : 2)) + "M";
  if (abs >= 1e4) return trimZeros((abs / 1e3).toFixed(1)) + "K";
  return fmtNum(abs, "intl");
}
function fmtMoney(v, o = {}) {
  if (v === null || v === void 0 || !isFinite(v)) return "\u2013";
  const currency = o.currency ?? "PKR";
  const style = o.style ?? "lakh";
  const neg = v < 0;
  const abs = Math.abs(v);
  let body;
  if (currency === "USD") {
    body = o.compact ? compactIntl(abs) : fmtNum(abs, "intl", o.decimals ?? (abs < 100 ? 2 : 0));
    body = "$" + body;
  } else {
    if (o.compact) body = style === "lakh" ? compactLakh(abs) : compactIntl(abs);
    else body = fmtNum(abs, style, o.decimals ?? 0);
    body = "Rs " + body;
  }
  const sign = neg ? "-" : o.sign && v > 0 ? "+" : "";
  return sign + body;
}
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso) {
  if (!iso) return "\u2013";
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso);
  if (!m) return iso;
  const y = m[1];
  const mo = MONTHS[Number(m[2]) - 1] ?? "";
  return m[3] ? `${Number(m[3])} ${mo} ${y}` : `${mo} ${y}`;
}
function uid(prefix = "id") {
  const r = Math.random().toString(36).slice(2, 9);
  const t = Date.now().toString(36).slice(-4);
  return `${prefix}_${t}${r}`;
}

// src/engine/samples.ts
var SCHEMA_VERSION = 1;
function defaultPlan(over = {}) {
  return {
    horizonYears: 20,
    sipMonthly: 0,
    sipStepUp: 5,
    lumpSums: [],
    withdrawals: [],
    contributionMix: "current",
    rebalance: "none",
    reinvestIncome: true,
    applyTax: true,
    applyZakat: false,
    paths: 2e3,
    seed: 2026,
    retirement: { enabled: false, age: 35, retireAge: 60, lifeAge: 85, monthlyNeed: 2e5, pension: 0 },
    ...over
  };
}
function defaultSettings() {
  return {
    baseCurrency: "PKR",
    numberStyle: "lakh",
    realTerms: false,
    theme: "system",
    filer: true,
    nisabBasis: "silver",
    monthlyExpenses: 25e4,
    aiDepth: "standard",
    foreignCgtRate: 15
  };
}
function emptyPortfolio(name = "My portfolio") {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    id: uid("p"),
    name,
    holdings: [],
    liabilities: [],
    goals: [],
    plan: defaultPlan({ sipMonthly: 5e4 }),
    scenarios: [],
    pinned: [],
    createdAt: now,
    updatedAt: now
  };
}
function migrateWorkspace(raw) {
  if (!raw || typeof raw !== "object") return null;
  const w = raw;
  if (!Array.isArray(w.portfolios) || !w.portfolios.length) return null;
  const settings = { ...defaultSettings(), ...w.settings ?? {} };
  const market = { ...DEFAULT_MARKET, ...w.market ?? {}, fx: { ...DEFAULT_MARKET.fx, ...w.market?.fx ?? {} }, nss: { ...DEFAULT_MARKET.nss, ...w.market?.nss ?? {} }, tbill: { ...DEFAULT_MARKET.tbill, ...w.market?.tbill ?? {} } };
  const assumptions = w.assumptions && Array.isArray(w.assumptions.corr) && w.assumptions.corr.length === 9 ? { ...DEFAULT_ASSUMPTIONS, ...w.assumptions, macro: { ...DEFAULT_ASSUMPTIONS.macro, ...w.assumptions.macro }, spreads: { ...DEFAULT_ASSUMPTIONS.spreads, ...w.assumptions.spreads }, factors: { ...DEFAULT_ASSUMPTIONS.factors, ...w.assumptions.factors } } : JSON.parse(JSON.stringify(DEFAULT_ASSUMPTIONS));
  const portfolios = w.portfolios.map((p) => ({
    ...emptyPortfolio(p.name || "Portfolio"),
    ...p,
    plan: { ...defaultPlan(), ...p.plan ?? {}, retirement: { ...defaultPlan().retirement, ...p.plan?.retirement ?? {} } },
    holdings: Array.isArray(p.holdings) ? p.holdings.filter((h) => h && h.type && h.id) : [],
    liabilities: Array.isArray(p.liabilities) ? p.liabilities : [],
    goals: Array.isArray(p.goals) ? p.goals : [],
    scenarios: Array.isArray(p.scenarios) ? p.scenarios : [],
    pinned: Array.isArray(p.pinned) ? p.pinned : []
  }));
  const activeId = portfolios.some((p) => p.id === w.activeId) ? w.activeId : portfolios[0].id;
  return { version: SCHEMA_VERSION, settings, portfolios, activeId, market, assumptions, updatedAt: w.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString() };
}
export {
  DEFAULT_MARKET,
  NSS_PRODUCTS,
  TYPE_META,
  applyFeed,
  applyFundNavs,
  applyPsxPrices,
  classLabel,
  companyName,
  computeTotals,
  costPKR,
  fmtDate,
  fmtMoney,
  holdingClass,
  liabilityPKR,
  migrateWorkspace,
  parseFeed,
  parseFunds,
  parsePsx,
  psxQuote,
  subLabel,
  valuePKR
};
