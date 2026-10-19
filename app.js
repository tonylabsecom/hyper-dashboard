/* TONY ALPHA — light dashboard. Static, read-only: reads ./data/bot.json + public api.hyperliquid.xyz/info. No keys. */
(() => {
'use strict';
const CFG = Object.assign({ BOT_POLL_MS: 30000, STATE_POLL_MS: 15000 }, window.HYPER_CONFIG || {});
const qs = new URLSearchParams(location.search);
if (qs.get('user')) CFG.USER = qs.get('user');
if (qs.get('bot')) CFG.BOT_JSON_URL = qs.get('bot');
const USER = CFG.USER;
const $ = (id) => document.getElementById(id);
const RM = window.matchMedia('(prefers-reduced-motion: reduce)');
const S = { bot: null, botOk: false, apiOk: null, apiAt: 0, ch: null, spot: null, orders: [], mids: {}, portfolio: null, fills: [],
  candles: {}, series: (qs.get('coin') || 'equity'), tf: 'all', jType: 'all', q: '', drawnKey: '' };
if (!['equity', 'BTC', 'ETH'].includes(S.series)) S.series = 'equity';

/* ---------- utils ---------- */
const num = (v) => (v == null || v === '' ? NaN : +v);
const fmt = (v, d = 2) => (isFinite(v) ? (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '--');
const sgn = (v, d = 2) => (isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v), d) : '--');
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = (iso) => (iso == null ? NaN : typeof iso === 'number' ? iso : Date.parse(iso));
const pad = (n) => String(n).padStart(2, '0');
const utcHM = (t) => { const d = new Date(t); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const utcHMS = (t) => { const d = new Date(t); return `${utcHM(t)}:${pad(d.getUTCSeconds())}`; };
const utcMD = (t) => { const d = new Date(t); return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const utcFull = (t) => (isFinite(ms(t)) ? `${new Date(ms(t)).toISOString().slice(0, 10)} ${utcHM(ms(t))} UTC` : '--');
const ago = (t) => { const s = (Date.now() - ms(t)) / 1000; if (!isFinite(s)) return ''; if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
const shortAddr = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '--');
const pxFmt = (p) => { p = +p; if (!isFinite(p)) return '--'; const a = Math.abs(p); return fmt(p, a >= 10000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : 6); };
const icon = (id) => `<svg><use href="#${id}"/></svg>`;
const ease = (t) => 1 - Math.pow(1 - t, 3);

async function info(body) {
  const r = await fetch(CFG.INFO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(body.type + ' ' + r.status);
  return r.json();
}

/* ---------- animation helpers ---------- */
function countTo(el, v, o = {}) {
  if (!el) return;
  const d = o.d ?? +(el.dataset.d || 2), sign = o.sign ?? el.dataset.sign === '1', suf = o.suf ?? (el.dataset.suf || '');
  const show = (x) => (sign ? sgn(x, d) : fmt(x, d)) + suf;
  if (!isFinite(v)) { el.textContent = '--'; el._v = undefined; return; }
  const from = isFinite(el._v) ? el._v : (o.from ?? 0);
  if (from === v && el._v !== undefined) { el.textContent = show(v); return; }
  if (el._v !== undefined && from !== v) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  el._v = v; cancelAnimationFrame(el._raf);
  if (RM.matches) { el.textContent = show(v); return; }
  const t0 = performance.now(), dur = o.dur || 1100;
  const step = (t) => { const k = clamp((t - t0) / dur, 0, 1); el.textContent = show(from + (v - from) * ease(k)); if (k < 1) el._raf = requestAnimationFrame(step); };
  el._raf = requestAnimationFrame(step);
}
function setBar(el, pct, tone) {
  if (!el) return; el.className = tone || '';
  requestAnimationFrame(() => { el.style.width = clamp(isFinite(pct) ? pct : 0, 0, 100) + '%'; });
}
function setText(id, t, c) { const e = $(id); if (!e) return; e.textContent = t; if (c !== undefined) e.className = c; }

/* ---------- derived numbers ---------- */
function equityNow() {
  const b = S.bot; if (b && isFinite(num(b.equity))) return num(b.equity);
  if (S.spot) { const u = (S.spot.balances || []).find((x) => x.coin === 'USDC'); if (u) return num(u.total) + upnl(); }
  return NaN;
}
function upnl() { return ((S.ch && S.ch.assetPositions) || []).reduce((a, p) => a + num(p.position.unrealizedPnl || 0), 0); }
function balance() { const u = S.spot && (S.spot.balances || []).find((x) => x.coin === 'USDC'); return u ? num(u.total) : (S.bot ? num(S.bot.equity) - num(S.bot.upnl || 0) : NaN); }
function baseline() { return num((S.bot && S.bot.baseline) || CFG.BASELINE || 37.93); }
function killLevel() { return num((S.bot && S.bot.kill_level_usd)) || baseline() * (1 + num(S.bot?.limits?.kill_dd_pct ?? -20) / 100); }
function equitySeries() {
  const m = new Map();
  ((S.bot && S.bot.equity_history) || []).forEach(([t, v]) => { const k = ms(t); if (isFinite(k) && v > 0) m.set(k, +v); });
  const at = S.portfolio && (S.portfolio.find((x) => x[0] === 'allTime') || [])[1];
  ((at && at.accountValueHistory) || []).forEach(([t, v]) => { if (+v > 0) m.set(+t, +v); });
  const e = equityNow(); if (isFinite(e)) m.set(Date.now(), e);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}
function pnlNums() {
  const p = (S.bot && S.bot.pnl) || {}, e = equityNow(), b = baseline();
  const ser = equitySeries();
  const c7 = Date.now() - 7 * 864e5, r7 = ser.find((x) => x[0] >= c7);
  return {
    today: isFinite(num(p.today_usd)) ? num(p.today_usd) : num(S.bot?.daily_stop?.pnl_today),
    todayPct: isFinite(num(p.today_pct)) ? num(p.today_pct) : num(S.bot?.day_pnl_pct),
    d7: isFinite(num(p.d7_usd)) ? num(p.d7_usd) : (r7 ? e - r7[1] : NaN),
    d7Pct: isFinite(num(p.d7_pct)) ? num(p.d7_pct) : (r7 ? (e - r7[1]) / r7[1] * 100 : NaN),
    total: isFinite(num(p.total_usd)) ? num(p.total_usd) : e - b,
    totalPct: isFinite(num(p.total_pct)) ? num(p.total_pct) : (e - b) / b * 100,
  };
}
function isRunning() { return S.bot && S.bot.status === 'RUNNING'; }
function publishedAge() { return S.bot ? (Date.now() - ms(S.bot.published_at || S.bot.updated_at)) / 1000 : Infinity; }

/* ---------- alerts ---------- */
function buildAlerts() {
  const A = [], b = S.bot; const now = new Date().toISOString();
  if (!b) { A.push({ l: 'warn', t: 'Waiting for bot status file', d: 'data/bot.json could not be loaded yet.', ts: now }); return A; }
  const ev = b.evolution || {};
  if (b.status !== 'RUNNING') A.push({ l: 'danger', t: `Bot ${b.status === 'STALE' ? 'heartbeat stale' : b.status}`, d: b.halted ? `Halted: ${b.halted}` : 'The live bot is not reporting as running.', ts: b.updated_at });
  if (b.kill_switch) A.push({ l: 'danger', t: 'Kill switch triggered', d: 'Equity fell 20% below baseline; bot flattened and halted.', ts: b.updated_at });
  if (ev.warning) A.push({ l: 'danger', t: 'Backtest unprofitable', d: ev.warning, ts: ev.updated_utc });
  const ds = b.daily_stop || {}, used = isFinite(num(ds.pnl_today)) && num(ds.limit_usd) ? clamp(-num(ds.pnl_today) / Math.abs(num(ds.limit_usd)) * 100, 0, 100) : 0;
  if (ds.triggered) A.push({ l: 'danger', t: 'Daily stop hit (−3%)', d: 'No new entries until 00:00 UTC.', ts: b.updated_at });
  else A.push({ l: used >= 50 ? 'warn' : 'ok', t: `Daily stop armed · ${fmt(used, 0)}% used`, d: `Limit ${fmt(ds.limit_pct ?? -3, 1)}% (${sgn(num(ds.limit_usd))} USDC) vs UTC-midnight equity; PnL today ${sgn(num(ds.pnl_today), 4)} USDC.`, ts: b.updated_at });
  const e = equityNow(), k = killLevel(), buf = (e - k) / (baseline() - k) * 100;
  if (!b.kill_switch && isFinite(buf)) A.push({ l: buf < 30 ? 'danger' : buf < 60 ? 'warn' : 'info', t: `Kill switch ${fmt(e - k, 2)} USDC away`, d: `Triggers at ${fmt(k, 2)} USDC (−20% vs ${fmt(baseline(), 2)} baseline). Buffer left ${fmt(buf, 0)}%.`, ts: b.updated_at });
  const mu = num(b.margin_used), cap = num(b.margin_cap_pct || 10), muPct = e ? mu / e * 100 : NaN;
  if (isFinite(muPct) && muPct > cap * 0.8) A.push({ l: 'warn', t: `Margin used ${fmt(muPct, 1)}% (cap ${cap}%)`, d: 'Close to the hard margin cap; new entries will be skipped.', ts: b.updated_at });
  if (ev.round) A.push({ l: ev.promoted ? 'ok' : 'info', t: `Evolution round #${ev.round}: ${ev.promoted ? 'promoted ' + (ev.new_version || '') : 'kept ' + (ev.current_version || '')}`, d: `Tested ${ev.change_tested || '--'} — ${ev.result || ''}`, ts: ev.updated_utc });
  const ses = b.session_utc || [7, 21], h = new Date().getUTCHours();
  if (h < ses[0] || h >= ses[1]) A.push({ l: 'info', t: `Outside entry session (${pad(ses[0])}:00–${pad(ses[1])}:00 UTC)`, d: 'No new entries now; open positions are still managed.', ts: now });
  if (publishedAge() > 5400) A.push({ l: 'warn', t: 'Status data is stale', d: `Last published ${ago(b.published_at)}.`, ts: b.published_at });
  if (S.apiOk === false) A.push({ l: 'warn', t: 'Hyperliquid API unreachable', d: 'Live prices, orders and fills may be outdated.', ts: now });
  const L = b.limits || {};
  A.push({ l: 'ok', t: 'Hard limits in force', d: `Risk ${L.risk_per_trade_pct ?? 0.5}%/trade · open risk ≤ ${L.max_open_risk_pct ?? 3}% · margin ≤ ${b.margin_cap_pct ?? 10}% · stop-loss on every trade · leverage ${b.leverage || '20–40'}x`, ts: b.updated_at });
  const rank = { danger: 0, warn: 1, info: 2, ok: 3 };
  return A.sort((x, y) => rank[x.l] - rank[y.l] || (ms(y.ts) || 0) - (ms(x.ts) || 0));
}
function alertLi(a, k, big) {
  return `<li class="${a.l}" style="--k:${k}" data-q="${esc((a.t + ' ' + a.d).toLowerCase())}"><b>${esc(a.t)}</b>${big ? `<p>${esc(a.d)}</p>` : ''}<small>${a.l.toUpperCase()} · ${utcFull(a.ts)}</small></li>`;
}

/* ---------- render: header / overview ---------- */
function renderHeader() {
  const b = S.bot || {}, run = isRunning(), ver = b.version || b.evolution?.current_version || '--';
  const pill = $('statusPill'); pill.className = 'pill st-pill ' + (S.bot ? (run ? 'run' : 'stop') : '');
  pill.querySelector('span').textContent = S.bot ? (run ? 'RUNNING' : 'STOPPED') : 'LOADING';
  pill.title = S.bot ? `Bot status: ${b.status}${b.halted ? ' · ' + b.halted : ''}` : '';
  setText('crVer', ver); setText('crMode', b.mode === 'LIVE' ? 'Live' : (b.mode || 'Live'));
  setText('sbVer', ver); setText('sbUpd', b.updated_at ? `${utcHMS(ms(b.updated_at))} UTC (${ago(b.updated_at)})` : '--');
  setText('sbPub', b.published_at ? `${utcHMS(ms(b.published_at))} UTC` : '--'); setText('sbStrat', b.strategy || '');
  const fresh = publishedAge() < 5400, apiOk = S.apiOk !== false;
  const st = !S.bot && S.apiOk == null ? ['', 'Connecting'] : run && fresh && apiOk ? ['on', 'System Online'] : (S.bot || S.apiOk) ? ['warn', 'Degraded'] : ['off', 'Offline'];
  const dot = document.querySelector('#online .ldot'); dot.className = 'ldot ' + (st[0] === 'warn' ? '' : st[0]); dot.style.background = st[0] === 'warn' ? 'var(--amber)' : '';
  setText('onlineTxt', st[1]);
  setText('ovVer', ver); setText('ovAcct', shortAddr(USER));
  const op = $('ovPill'); op.className = 'pill sm ' + (S.bot ? (run ? 'run' : 'stop') : ''); op.textContent = S.bot ? (run ? 'Running' : 'Stopped') : '--';
  countTo($('ovEq'), equityNow());
  setText('ovBal', isFinite(balance()) ? fmt(balance(), 2) : '--');
  const u = S.ch ? upnl() : num(b.upnl); setText('ovUpnl', isFinite(u) ? sgn(u, 2) : '--', cls(u));
  const ls = b.last_signal || {};
  setText('sigMain', ls.coin ? `${ls.coin} · ${ls.side || '--'}${ls.price ? ' @ ' + pxFmt(ls.price) : ''} · ${ls.time ? utcHM(ms(ls.time)) + ' UTC' : ''}` : 'No signal yet');
  setText('sigWhy', [ls.reason, b.confidence != null ? `confidence ${b.confidence}% (${b.confidence_basis || ''})` : ''].filter(Boolean).join(' · '));
  // sidebar markets
  const coins = b.coins && b.coins.length ? b.coins : ['BTC', 'ETH'];
  $('markets').innerHTML = ['BTC', 'ETH'].map((c) => `<div class="mkt ${S.series === c ? 'on' : ''}" data-c="${c}" role="button" tabindex="0">${icon('i-coin')}<span>${c}-PERP</span><b class="mkt-px">${S.mids[c] ? pxFmt(S.mids[c]) : '--'}</b><i class="sdot ${run && coins.includes(c) ? 'on' : ''}" title="${run && coins.includes(c) ? 'Bot trading this market' : 'Not trading'}"></i></div>`).join('');
}

function renderCards() {
  const b = S.bot || {}, e = equityNow();
  const apiPos = (S.ch && S.ch.assetPositions) || [], npos = S.ch ? apiPos.length : Object.keys(b.positions || {}).length;
  const nord = S.apiOk ? S.orders.length : num(b.pending_orders || 0);
  setText('rkPos', String(npos)); setText('rkOrd', String(nord)); setText('rkLev', (b.leverage || '20–40') + 'x');
  const risk = num(b.open_risk_usd || 0), riskCap = e * num(b.limits?.max_open_risk_pct ?? 3) / 100;
  setText('rkRisk', `${fmt(risk, 2)} USDC`);
  const mu = S.ch ? num(S.ch.marginSummary?.totalMarginUsed || 0) || num(b.margin_used || 0) : num(b.margin_used || 0);
  const cap = num(b.margin_cap_pct || 10), muPct = e ? mu / e * 100 : 0;
  setText('rkMarginTxt', `${fmt(muPct, 1)}% / ${cap}%`); setBar($('rkMarginBar'), muPct / cap * 100, muPct / cap > .8 ? 'r' : muPct / cap > .5 ? 'a' : '');
  const rp = riskCap ? risk / riskCap * 100 : 0;
  setText('rkRiskTxt', `${fmt(e ? risk / e * 100 : 0, 2)}% / ${b.limits?.max_open_risk_pct ?? 3}%`); setBar($('rkRiskBar'), rp, rp > 80 ? 'r' : rp > 50 ? 'a' : '');
  $('navPos').textContent = npos || ''; $('navOrd').textContent = nord || '';
  // gauge
  const ds = b.daily_stop || {}, used = num(ds.limit_usd) ? clamp(-num(ds.pnl_today || 0) / Math.abs(num(ds.limit_usd)) * 100, 0, 100) : 0;
  const ring = $('ringVal'); const C = 2 * Math.PI * 50;
  ring.style.stroke = used >= 80 ? 'var(--red)' : used >= 50 ? 'var(--amber)' : 'var(--blue)';
  requestAnimationFrame(() => { ring.style.strokeDashoffset = C * (1 - Math.max(used, 0.5) / 100); });
  countTo($('ringNum'), used, { d: 0, suf: '%' });
  setText('gToday', isFinite(num(ds.pnl_today)) ? sgn(num(ds.pnl_today), 2) : '--', cls(num(ds.pnl_today))); setText('gLim', isFinite(num(ds.limit_usd)) ? sgn(num(ds.limit_usd), 2) : '--');
  setText('gKill', fmt(killLevel(), 2));
  const gs = b.kill_switch ? ['Kill switch', 'bad'] : ds.triggered ? ['Daily stop hit', 'bad'] : b.halted ? ['Halted', 'bad'] : S.bot ? ['Armed · OK', 'ok'] : ['--', ''];
  setText('gStat', gs[0], gs[1]);
  // pnl
  const P = pnlNums();
  [['pToday', P.today, P.todayPct], ['p7d', P.d7, P.d7Pct], ['pTot', P.total, P.totalPct]].forEach(([id, v, pc]) => {
    const el = $(id); el.className = 'count ' + cls(v); countTo(el, v);
    let s = el.nextElementSibling; if (!s) { s = document.createElement('small'); el.after(s); }
    s.textContent = isFinite(pc) ? `${sgn(pc, 2)}%` : ''; s.className = cls(pc);
  });
  const k = killLevel(), buf = clamp((e - k) / (baseline() - k) * 100, 0, 100);
  setText('pKillTxt', isFinite(buf) ? `${fmt(buf, 0)}%` : '--'); setBar($('pKillBar'), buf, buf < 30 ? 'r' : buf < 60 ? 'a' : 'g');
  // sparkline (last 7d)
  const ser = equitySeries().filter((x) => x[0] >= Date.now() - 7 * 864e5);
  const sp = $('pnlSpark');
  if (ser.length >= 2) {
    const ys = ser.map((x) => x[1]); let mn = Math.min(...ys), mx = Math.max(...ys); if (mx - mn < mx * 0.002) { const m = (mx + mn) / 2; mn = m - m * 0.001; mx = m + m * 0.001; }
    const t0 = ser[0][0], t1 = ser[ser.length - 1][0] || t0 + 1;
    const pts = ser.map(([t, v]) => [(t - t0) / Math.max(t1 - t0, 1) * 300, 54 - (v - mn) / (mx - mn) * 48]);
    const d = 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
    const neg = ys[ys.length - 1] < ys[0], col = neg ? '#E5484D' : '#22B07D';
    const key = d;
    if (sp._k !== key) {
      sp.innerHTML = `<defs><linearGradient id="spg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><path d="${d}L300,60L0,60Z" fill="url(#spg)" class="c-area"/><path class="l ${neg ? 'neg' : ''}" d="${d}"/>`;
      drawIn(sp.querySelector('path.l'), !sp._k); sp._k = key;
    }
  } else sp.innerHTML = '<line x1="0" y1="30" x2="300" y2="30" stroke="#E6ECF3" stroke-dasharray="4 4"/>';
}
function drawIn(path, first) {
  if (!path || RM.matches || !path.getTotalLength) return;
  const L = path.getTotalLength(); if (!L) return;
  path.style.transition = 'none'; path.style.strokeDasharray = L; path.style.strokeDashoffset = L;
  path.getBoundingClientRect();
  path.style.transition = `stroke-dashoffset ${first ? 1.8 : 0.9}s cubic-bezier(.4,0,.2,1)`; path.style.strokeDashoffset = 0;
  setTimeout(() => { path.style.strokeDasharray = ''; path.style.transition = ''; }, first ? 2000 : 1100);
}

function renderAlerts() {
  const A = buildAlerts();
  $('alertsMini').innerHTML = A.slice(0, 4).map((a, k) => alertLi(a, k, false)).join('');
  $('alertsFull').innerHTML = A.map((a, k) => alertLi(a, k, true)).join('');
  const bad = A.filter((a) => a.l === 'danger' || a.l === 'warn').length;
  $('bellDot').classList.toggle('on', bad > 0); $('navAlerts').textContent = bad || ''; setText('alCnt', String(A.length), 'cnt');
  applySearch();
}

/* ---------- chart ---------- */
function chartData() {
  const span = { '24h': 864e5, '7d': 7 * 864e5, all: Infinity }[S.tf], from = Date.now() - span;
  if (S.series === 'equity') return { pts: equitySeries().filter((x) => x[0] >= from), unit: 'USDC', d: 2 };
  const c = S.candles[S.series + S.tf] || []; return { pts: c.map((k) => [k.t, +k.c]).filter((x) => x[0] >= from), unit: 'USD', d: S.series === 'BTC' ? 0 : 1 };
}
function fillMarkers(t0, t1) {
  const F = S.fills.filter((f) => f.time >= t0 && f.time <= t1 && (S.series === 'equity' || f.coin === S.series));
  const T = ((S.bot && S.bot.trades) || []).flatMap((t) => [{ coin: t.coin, time: ms(t.opened_at), dir: 'Open ' + (t.side === 'LONG' ? 'Long' : 'Short'), px: t.entry }, { coin: t.coin, time: ms(t.closed_at), dir: 'Close · ' + sgn(num(t.R), 2) + 'R', px: null }])
    .filter((f) => f.time >= t0 && f.time <= t1 && (S.series === 'equity' || f.coin === S.series));
  const all = (F.length ? F : T).sort((a, b) => a.time - b.time);
  const out = []; let last = -Infinity; const minGap = (t1 - t0) / 7;
  for (let i = all.length - 1; i >= 0 && out.length < 5; i--) { if (last - all[i].time >= minGap || last === -Infinity) { out.push(all[i]); last = all[i].time; } }
  return out;
}
function renderChart(force) {
  const box = $('heroChart'), svg = $('chartSvg'), W = box.clientWidth, H = box.clientHeight; if (!W || !H) return;
  const mob = window.innerWidth <= 640;
  const pt = mob ? 24 : 140, pb = mob ? 30 : 92, pl = mob ? 10 : 24, pr = mob ? 52 : 70;
  const { pts, unit, d } = chartData();
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const layer = $('chipsLayer');
  if (pts.length < 2) { svg.innerHTML = `<text class="c-empty" x="${W / 2}" y="${H / 2 + 30}" text-anchor="middle">${S.series === 'equity' ? 'Not enough equity history yet' : 'Loading prices…'}</text>`; layer.innerHTML = ''; S.drawnKey = ''; return; }
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const ys = pts.map((p) => p[1]); let mn = Math.min(...ys), mx = Math.max(...ys);
  const isEq = S.series === 'equity', base = baseline();
  if (isEq && isFinite(base)) { mn = Math.min(mn, base); mx = Math.max(mx, base); }
  const minSpan = (mx + mn) / 2 * (isEq ? 0.006 : 0.004); if (mx - mn < minSpan) { const m = (mx + mn) / 2; mn = m - minSpan / 2; mx = m + minSpan / 2; }
  const padY = (mx - mn) * 0.12; mn -= padY; mx += padY;
  const X = (t) => pl + (t - t0) / Math.max(t1 - t0, 1) * (W - pl - pr), Y = (v) => pt + (1 - (v - mn) / (mx - mn)) * (H - pt - pb);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join('');
  const area = line + `L${X(t1).toFixed(1)},${H}L${X(t0).toFixed(1)},${H}Z`;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = mn + (mx - mn) * (i / 4), y = Y(v); g += `<line class="c-grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/><text class="c-axis" x="${W - 8}" y="${y - 4}" text-anchor="end">${fmt(v, isEq ? 2 : d)}</text>`; }
  const span = t1 - t0, nx = mob ? 3 : 6;
  for (let i = 0; i <= nx; i++) { const t = t0 + span * i / nx, x = X(t); g += `<text class="c-axis" x="${x}" y="${H - 10}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}">${span > 2 * 864e5 ? utcMD(t) : utcHM(t)}${i === nx ? ' UTC' : ''}</text>`; }
  let ref = '';
  if (isEq && isFinite(base)) { const y = Y(base); ref = `<line class="c-base" x1="0" x2="${W}" y1="${y}" y2="${y}"/><text class="c-lbl" fill="#8A97A8" x="${pl + 8}" y="${y + 15}">Baseline ${fmt(base, 2)}</text>`; }
  const lx = X(t1), ly = Y(pts[pts.length - 1][1]);
  const key = S.series + S.tf;
  svg.innerHTML = `<defs><linearGradient id="hg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2F7BEA" stop-opacity=".28"/><stop offset=".7" stop-color="#5B9BF0" stop-opacity=".06"/><stop offset="1" stop-color="#5B9BF0" stop-opacity="0"/></linearGradient></defs>
    ${g}${ref}<path class="c-area" d="${area}" fill="url(#hg)" ${S.drawnKey === key && !force ? 'style="opacity:1;animation:none"' : ''}/><path class="c-line" id="cLine" d="${line}"/>
    <line class="c-hover" id="cHover" x1="0" x2="0" y1="${pt - 20}" y2="${H - pb + 10}"/>
    <circle class="c-halo" cx="${lx}" cy="${ly}" r="6"/><circle class="c-now" cx="${lx}" cy="${ly}" r="5.5"/>`;
  if (S.drawnKey !== key || force) drawIn($('cLine'), S.drawnKey === '');
  // floating chips: entry/exit markers + "now"
  const yAt = (t) => { let best = pts[0]; for (const p of pts) { if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; } return Y(best[1]); };
  const M = fillMarkers(t0, t1);
  let chips = M.map((f, i) => { const x = clamp(X(f.time), 70, W - 90), y = Math.max(yAt(f.time) - 14, pt - 10); const buy = /long|buy|^b$/i.test(f.dir + (f.side || '')) && !/close/i.test(f.dir);
    return `<div class="chip ${/close/i.test(f.dir) ? 'sell' : 'buy'}" style="left:${x}px;top:${y}px;--d:${0.9 + i * 0.12}s"><b><i></i>${esc(f.coin)} ${esc(f.dir)}</b><small>${f.px ? pxFmt(f.px) + ' · ' : ''}${utcMD(f.time)} ${utcHM(f.time)} UTC</small></div>`; }).join('');
  const nowV = pts[pts.length - 1][1];
  chips += `<div class="chip" style="left:${clamp(lx, 80, W - 70)}px;top:${ly - 16}px;--d:1.6s"><b><i></i>${isEq ? 'Equity now' : S.series + '-PERP'}</b><small>${fmt(nowV, isEq ? 2 : d)} ${unit}</small></div>`;
  if (S.drawnKey !== key || force || layer._n !== M.length) layer.innerHTML = chips; else layer.innerHTML = chips.replace(/--d:[0-9.]+s/g, '--d:0s');
  layer._n = M.length; S.drawnKey = key;
  S.chart = { pts, X, Y, W, H, isEq, d, unit, pt, pb };
}
function chartHover(ev) {
  const c = S.chart, tip = $('chartTip'), hv = $('cHover'); if (!c || !hv) return;
  const r = $('heroChart').getBoundingClientRect(), x = ev.clientX - r.left;
  let best = c.pts[0]; for (const p of c.pts) if (Math.abs(c.X(p[0]) - x) < Math.abs(c.X(best[0]) - x)) best = p;
  const bx = c.X(best[0]), by = c.Y(best[1]);
  hv.setAttribute('x1', bx); hv.setAttribute('x2', bx); hv.style.opacity = 1;
  tip.innerHTML = `<b>${fmt(best[1], c.isEq ? 4 : c.d)} ${c.unit}</b> <span class="muted">${new Date(best[0]).toISOString().slice(0, 10)} ${utcHM(best[0])} UTC</span>`;
  tip.style.left = clamp(bx + 12, 0, c.W - 220) + 'px'; tip.style.top = clamp(by - 40, 0, c.H - 40) + 'px'; tip.style.opacity = 1;
}

/* ---------- sections ---------- */
const emptyBox = (ic, t, s) => `<div class="empty"><span class="e-ic">${icon(ic)}</span><b>${t}</b><span>${s}</span></div>`;
function renderPositions() {
  const b = S.bot || {}, det = b.position_details || {}, apiPos = ((S.ch && S.ch.assetPositions) || []).map((x) => x.position);
  let rows = apiPos.map((p) => ({ coin: p.coin, side: num(p.szi) > 0 ? 'LONG' : 'SHORT', size: Math.abs(num(p.szi)), entry: num(p.entryPx), value: num(p.positionValue), upnl: num(p.unrealizedPnl), lev: p.leverage?.value, liq: num(p.liquidationPx), d: det[p.coin] || {} }));
  if (!S.ch) rows = Object.entries(b.positions || {}).map(([c, n]) => ({ coin: c, side: det[c]?.side || '--', size: det[c]?.qty, entry: det[c]?.entry, value: num(n), upnl: NaN, d: det[c] || {} }));
  setText('posCnt', String(rows.length), 'cnt');
  $('posBody').innerHTML = rows.length ? rows.map((p) => `<div class="pos-card" data-q="${esc((p.coin + ' ' + p.side).toLowerCase())}"><div class="h"><b>${esc(p.coin)}-PERP</b><span class="tag ${p.side === 'LONG' ? 'long' : 'short'}">${p.side}</span>${p.lev ? `<span class="muted sm">${p.lev}x</span>` : ''}<span class="${cls(p.upnl)}" style="margin-left:auto;font-weight:600">${isFinite(p.upnl) ? sgn(p.upnl, 4) + ' USDC' : ''}</span></div>
      <div><small>Size</small>${fmt(p.size, 5)}</div><div><small>Entry</small>${pxFmt(p.entry)}</div><div><small>Value</small>${fmt(p.value, 2)}</div><div><small>Liq. price</small>${isFinite(p.liq) ? pxFmt(p.liq) : '--'}</div>
      <div><small>Stop</small>${p.d.stop ? pxFmt(p.d.stop) : '--'}${p.d.breakeven ? ' <span class="tag long">BE</span>' : ''}</div><div><small>TP1 / TP2</small>${p.d.tp1 ? pxFmt(p.d.tp1) : '--'} / ${p.d.tp2 ? pxFmt(p.d.tp2) : '--'}</div><div><small>Risk</small>${p.d.risk_usd != null ? fmt(p.d.risk_usd, 3) + ' USDC' : '--'}</div><div><small>Opened</small>${p.d.opened_at ? utcFull(p.d.opened_at) : '--'}</div></div>`).join('')
    : emptyBox('i-pos', 'No open positions', `The bot is flat. It enters BTC/ETH only on a 15m trend-pullback setup during ${pad((b.session_utc || [7])[0])}:00–${pad((b.session_utc || [7, 21])[1])}:00 UTC.`);
}
function renderOrders() {
  const O = S.orders || []; setText('ordCnt', String(O.length), 'cnt');
  $('ordBody').innerHTML = O.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Placed (UTC)</th><th>Coin</th><th>Side</th><th>Type</th><th>Price</th><th>Trigger</th><th>Size</th></tr></thead><tbody>${O.map((o) => `<tr data-q="${esc((o.coin + ' ' + o.orderType).toLowerCase())}"><td>${utcMD(o.timestamp)} ${utcHM(o.timestamp)}</td><td>${esc(o.coin)}</td><td><span class="tag ${o.side === 'B' ? 'long' : 'short'}">${o.side === 'B' ? 'BUY' : 'SELL'}</span></td><td>${esc(o.orderType || 'Limit')}${o.reduceOnly ? ' · reduce' : ''}</td><td>${pxFmt(o.limitPx)}</td><td>${o.isTrigger ? pxFmt(o.triggerPx) : '--'}</td><td>${fmt(num(o.sz), 5)}</td></tr>`).join('')}</tbody></table></div>`
    : emptyBox('i-orders', 'No pending orders', S.apiOk === false ? 'Live order book unavailable (API unreachable).' : 'Entries are IOC with an attached stop; resting stop / take-profit orders appear here while a position is open.');
}
function renderHistory() {
  const T = (S.bot && S.bot.trades) || [];
  let html = '', n = 0;
  if (T.length) {
    n = T.length;
    html += `<thead><tr><th>Closed (UTC)</th><th>Coin</th><th>Side</th><th>Entry</th><th>Stop</th><th>Size</th><th>R</th><th>PnL (USDC)</th><th>Version</th></tr></thead><tbody>${T.map((t) => `<tr data-q="${esc((t.coin + ' ' + t.side + ' ' + t.version).toLowerCase())}"><td>${utcFull(t.closed_at)}</td><td>${esc(t.coin)}</td><td><span class="tag ${t.side === 'LONG' ? 'long' : 'short'}">${esc(t.side)}</span></td><td>${pxFmt(t.entry)}</td><td>${pxFmt(t.stop0)}</td><td>${fmt(num(t.qty), 5)}</td><td class="${cls(num(t.R))}">${sgn(num(t.R), 2)}</td><td class="${cls(num(t.pnl))}">${sgn(num(t.pnl), 4)}</td><td>${esc(t.version || '')}</td></tr>`).join('')}</tbody>`;
    setText('histNote', 'Closed round-trips from the bot journal (PnL after fees)', 'muted sm');
  } else if (S.fills.length) {
    const F = S.fills.slice(0, 40); n = S.fills.length;
    html += `<thead><tr><th>Time (UTC)</th><th>Coin</th><th>Direction</th><th>Price</th><th>Size</th><th>Closed PnL</th><th>Fee</th></tr></thead><tbody>${F.map((f) => `<tr data-q="${esc((f.coin + ' ' + f.dir).toLowerCase())}"><td>${new Date(f.time).toISOString().slice(0, 10)} ${utcHMS(f.time)}</td><td>${esc(f.coin)}</td><td><span class="tag ${/long/i.test(f.dir) === /open/i.test(f.dir) ? 'long' : 'short'}">${esc(f.dir)}</span></td><td>${pxFmt(f.px)}</td><td>${fmt(num(f.sz), 5)}</td><td class="${cls(num(f.closedPnl))}">${sgn(num(f.closedPnl), 4)}</td><td>${fmt(num(f.fee), 4)}</td></tr>`).join('')}</tbody>`;
    setText('histNote', 'No closed v1.0 trade yet — showing exchange fills (public API, incl. earlier bot versions)', 'muted sm');
  } else { html = `<tbody><tr><td>${emptyBox('i-hist', 'No trades yet', 'Closed trades will appear here.')}</td></tr></tbody>`; setText('histNote', ''); }
  $('histTbl').innerHTML = html; setText('histCnt', String(n), 'cnt');
}
function renderEvolution() {
  const ev = (S.bot && S.bot.evolution) || null, el = $('evoBody');
  if (!ev) { el.innerHTML = emptyBox('i-evo', 'No evolution round yet', 'Rounds run every 6 h or after 15 new live signals.'); return; }
  const p = $('evoPill'); p.className = 'pill sm ' + (ev.promoted ? 'run' : 'info'); p.textContent = ev.promoted ? `Promoted ${ev.new_version || ''}` : 'Not promoted';
  $('navEvo').classList.toggle('on', !!ev.round);
  const c = ev.metrics?.current || {}, v = ev.metrics?.variant || {}, imp = ev.improvement_pct || {};
  const rows = [['Profit factor', 'pf', 3, 1], ['Sharpe', 'sharpe', 2, 1], ['Expectancy (R)', 'expectancy', 4, 1], ['Win rate', 'win', 1, 1, 100, '%'], ['Max drawdown', 'max_dd_pct', 2, -1, 1, '%'], ['Max DD (R)', 'mdd_R', 2, -1], ['Trades', 'n', 0, 0], ['End equity', 'end_equity', 2, 0]];
  const tr = rows.map(([lbl, k, d, dir, mul = 1, suf = '']) => {
    const a = num(c[k]) * mul, b = num(v[k]) * mul; let dl = imp[k];
    if (dl == null && dir && isFinite(a) && isFinite(b) && a) dl = (b - a) / Math.abs(a) * 100 * (dir < 0 ? -1 : 1);
    const good = dl > 0 ? 'up' : dl < 0 ? 'down' : '';
    return `<tr><td>${lbl}</td><td>${fmt(a, d)}${suf}</td><td>${fmt(b, d)}${suf}</td><td>${dir && dl != null ? `<span class="dl ${good}">${sgn(+dl, 1)}%</span>` : ''}</td></tr>`;
  }).join('');
  el.className = '';
  el.innerHTML = `<div class="evo-top"><div><small>Round</small><b>#${ev.round ?? '--'}</b></div><div><small>Current formula</small><b>${esc(ev.current_version || '--')}</b></div><div><small>Change tested</small><b>${esc(ev.change_tested || '--')}</b></div><div><small>Ran at</small><b>${utcFull(ev.updated_utc)}</b></div></div>
    <div class="evo-res">${(() => { const r = String(ev.result || ''); const m = r.match(/^(kept|promoted)\s+(\S+)\s*[—-]\s*(.*)$/i); return m ? `<b>${esc(m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2])}</b> — ${esc(m[3])}` : `<b>${ev.promoted ? 'Promoted' : 'Kept'}</b> — ${esc(r)}`; })()}</div>
    <div class="tbl-wrap"><table class="mcmp"><thead><tr><th>Backtest metric (12 mo)</th><th>Current ${esc(ev.current_version || '')}</th><th>Variant</th><th>Δ (better +)</th></tr></thead><tbody>${tr}</tbody></table></div>
    <div class="evo-foot">${ev.warning ? `<ul class="alerts"><li class="danger"><b>Backtest warning</b>${esc(ev.warning)}</li></ul>` : ''}<span>Next round: <b>${esc(ev.next_round || '--')}</b> · promotion needs ≥ 2 metrics improved ≥ 8%, max DD not worse, adequate sample.</span>
    <span id="rollback"><b>Rollback:</b> every formula version is archived on the bot host; rollback is a manual owner action there (never from this read-only page). ${ev.current_version === 'v1.0' ? 'v1.0 is the first version, so there is nothing to roll back to.' : ''}</span></div>
    ${ev.params ? `<details class="params"><summary>Current parameters (${Object.keys(ev.params).length})</summary><div class="pgrid">${Object.entries(ev.params).map(([k, x]) => `<span>${esc(k)}<b>${esc(x)}</b></span>`).join('')}</div></details>` : ''}`;
}
function renderLimits() {
  const b = S.bot || {}, L = b.limits || {}, ses = b.session_utc || [7, 21];
  const R = [['Risk per trade', `${L.risk_per_trade_pct ?? 0.5}%`], ['Max open risk', `${L.max_open_risk_pct ?? 3}%`], ['Margin cap', `${b.margin_cap_pct ?? 10}% of equity`], ['Leverage', `${b.leverage || '20–40'}x`],
    ['Daily stop', `${L.day_stop_pct ?? -3}% vs 00:00 UTC equity`], ['Kill switch', `${L.kill_dd_pct ?? -20}% vs ${fmt(baseline(), 2)} → ${fmt(killLevel(), 2)} USDC`], ['Max trades / day', L.max_trades_day ?? 100], ['Entry session', `${pad(ses[0])}:00–${pad(ses[1])}:00 UTC`], ['Stop-loss', 'Always on, min 0.3% hard floor'], ['Coins', (b.coins || []).join(', ') || '--']];
  $('limBody').innerHTML = `<div class="lim">${R.map(([k, v]) => `<div class="row"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
}
function renderJournal() {
  const J = (S.bot && S.bot.journal) || [], types = ['all', ...new Set(J.map((e) => e.type))];
  if (!types.includes(S.jType)) S.jType = 'all';
  $('jfilter').innerHTML = types.map((t) => `<button data-t="${esc(t)}" class="${t === S.jType ? 'on' : ''}">${t === 'all' ? 'All' : esc(t[0].toUpperCase() + t.slice(1))}<span>${t === 'all' ? J.length : J.filter((e) => e.type === t).length}</span></button>`).join('');
  const L = J.filter((e) => S.jType === 'all' || e.type === S.jType);
  setText('jCnt', String(L.length), 'cnt');
  $('jBody').innerHTML = L.length ? L.map((e, k) => `<div class="je" style="--k:${Math.min(k, 12)}" data-q="${esc((e.title + ' ' + e.detail + ' ' + e.type).toLowerCase())}"><time>${utcFull(e.ts_utc)}</time><div><div class="jt"><span class="jtype ${esc(e.type)}">${esc(e.type)}</span>${esc(e.title)}${e.version ? `<span class="muted sm">${esc(e.version)}</span>` : ''}</div><p>${esc(e.detail)}</p></div></div>`).join('')
    : emptyBox('i-journal', 'No journal entries', 'Decisions, evolution rounds, trades and risk events are logged here.');
  applySearch();
}
/* ---------- total estimated valuation (master + subaccounts, public info API) ---------- */
// Unified / portfolio-margin accounts: every balance (incl. perp collateral AND perp uPnL) lives in the spot
// clearinghouse state, so Total = Σ spot balances × mark. Adding perp account value or uPnL again would double count.
// Standard ("disabled"/"default"/dexAbstraction) accounts: Total = perp account value (incl. uPnL) + Σ spot × mark.
// Each account is cross-checked against Hyperliquid's own `portfolio` account value.
const VC = { modes: {}, modesAt: 0, px: null, pxAt: 0 };
const UNIFIED = ['unifiedAccount', 'portfolioMargin'];
const STABLE_USDC = 0; // token index of USDC
async function spotPrices(force) {
  if (VC.px && !force && Date.now() - VC.pxAt < 30000) return VC.px;
  const [meta, ctxs] = await info({ type: 'spotMetaAndAssetCtxs' });
  const byCoin = {}; (ctxs || []).forEach((c) => { byCoin[c.coin] = c; });
  const pairPx = (u) => { const c = byCoin[u.name] || (ctxs || [])[u.index] || {}; const m = num(c.markPx), d = num(c.midPx), a = num(S.mids[u.name]); return m > 0 ? m : d > 0 ? d : a > 0 ? a : NaN; };
  const px = { [STABLE_USDC]: 1 }, alt = {};
  (meta.universe || []).forEach((u) => { const [b, q] = u.tokens || []; if (q === STABLE_USDC) { const v = pairPx(u); if (v > 0 && !(b in px && u.isCanonical === false && px[b] > 0)) px[b] = v; } else (alt[b] = alt[b] || []).push([q, u]); });
  Object.entries(alt).forEach(([b, L]) => { if (b in px) return; for (const [q, u] of L) { const v = pairPx(u); if (px[q] > 0 && v > 0) { px[b] = v * px[q]; break; } } });
  const names = {}; (meta.tokens || []).forEach((t) => { names[t.index] = t.name; });
  VC.px = { px, names }; VC.pxAt = Date.now(); return VC.px;
}
async function loadValuation() {
  try {
    const subsRaw = await info({ type: 'subAccounts', user: USER }).then((r) => ({ ok: true, r }), () => ({ ok: false, r: null }));
    const subs = Array.isArray(subsRaw.r) ? subsRaw.r : [];
    const [mch, msp] = await Promise.all([info({ type: 'clearinghouseState', user: USER }), info({ type: 'spotClearinghouseState', user: USER })]);
    const accts = [{ addr: USER, name: 'Master', master: true, ch: mch, spot: msp },
      ...subs.map((x) => ({ addr: x.subAccountUser, name: x.name || 'Subaccount', master: false, ch: x.clearinghouseState, spot: x.spotState }))];
    const needModes = Date.now() - VC.modesAt > 300000 || accts.some((a) => !(a.addr.toLowerCase() in VC.modes));
    const [pfs] = await Promise.all([
      Promise.all(accts.map((a) => info({ type: 'portfolio', user: a.addr }).catch(() => null))),
      needModes ? Promise.all(accts.map((a) => info({ type: 'userAbstraction', user: a.addr }).then((m) => { VC.modes[a.addr.toLowerCase()] = m; }).catch(() => {}))).then(() => { VC.modesAt = Date.now(); }) : null,
    ]);
    const needPx = accts.some((a) => ((a.spot && a.spot.balances) || []).some((b) => b.token !== STABLE_USDC && num(b.total) !== 0));
    const P = needPx ? await spotPrices() : { px: { [STABLE_USDC]: 1 }, names: {} };
    let unpriced = [];
    const rows = accts.map((a, k) => {
      const mode = VC.modes[a.addr.toLowerCase()] || 'unknown', unified = UNIFIED.includes(mode);
      const ms_ = (a.ch && a.ch.marginSummary) || {}, perp = num(ms_.accountValue || 0);
      const up = ((a.ch && a.ch.assetPositions) || []).reduce((s, p) => s + num(p.position.unrealizedPnl || 0), 0);
      let spot = 0; const toks = [];
      ((a.spot && a.spot.balances) || []).forEach((b) => { const q = num(b.total); if (!q) return; const p = P.px[b.token]; if (!(p > 0)) { unpriced.push(b.coin); return; } spot += q * p; toks.push(b.coin); });
      const total = unified ? spot : perp + spot;
      const pf = pfs[k] && (pfs[k].find((x) => x[0] === 'day') || [])[1], hist = (pf && pf.accountValueHistory) || [], last = hist[hist.length - 1];
      const hl = last ? num(last[1]) : NaN;
      return { addr: a.addr, name: a.name, master: a.master, mode, unified, perp, upnl: up, spot, total, hl, diff: total - hl, tokens: toks, npos: ((a.ch && a.ch.assetPositions) || []).length };
    });
    const total = rows.reduce((s, r) => s + r.total, 0), hlTot = rows.reduce((s, r) => s + r.hl, 0);
    S.val = { at: Date.now(), total, hlTotal: hlTot, upnl: rows.reduce((s, r) => s + r.upnl, 0), rows, subsOk: subsRaw.ok, nSubs: subs.length, unpriced: [...new Set(unpriced)],
      verified: rows.every((r) => isFinite(r.hl) && Math.abs(r.diff) <= Math.max(0.05, Math.abs(r.hl) * 0.001)) };
    window.__valuation = S.val;
  } catch (e) { if (S.val) S.val.err = String(e && e.message || e); else S.val = { err: String(e && e.message || e) }; }
  renderValuation();
}
function renderValuation() {
  const V = S.val, pill = $('valPill'); if (!pill) return;
  if (!V || !V.rows) {
    pill.className = 'pill sm ' + (V && V.err ? 'stop' : ''); pill.textContent = V && V.err ? 'API unavailable' : 'Loading';
    if (!$('valTbl').innerHTML) $('valTbl').innerHTML = `<tbody><tr class="note"><td>Loading accounts from api.hyperliquid.xyz…</td></tr></tbody>`; return;
  }
  pill.className = 'pill sm ' + (V.err ? 'warnp' : V.verified ? 'run' : 'warnp');
  pill.textContent = V.err ? 'Stale · retrying' : V.verified ? 'Matches Hyperliquid ✓' : 'Check vs Hyperliquid';
  pill.title = `Σ our math ${fmt(V.total, 4)} vs Σ Hyperliquid portfolio ${fmt(V.hlTotal, 4)} USDC`;
  setText('valCnt', `${V.rows.length} acct${V.rows.length > 1 ? 's' : ''}`, 'cnt');
  countTo($('valTotal'), V.total, { d: 2 });
  setText('valUpnl', isFinite(V.upnl) ? sgn(V.upnl, 4) : '--', cls(V.upnl));
  setText('valHL', isFinite(V.hlTotal) ? `${fmt(V.hlTotal, 2)} (Δ ${sgn(V.total - V.hlTotal, 4)})` : '--');
  setText('valUpd', `${utcHMS(V.at)} UTC`);
  const anyU = V.rows.some((r) => r.unified), anyS = V.rows.some((r) => !r.unified);
  $('valNote').textContent = [anyU ? 'Unified account: spot USDC already holds the perp collateral and uPnL, so Total = spot balances × mark (perp value shown for reference, not added).' : '',
    anyS ? 'Standard accounts: Total = perp account value (incl. uPnL) + spot × mark.' : '', 'Spot priced at spot mark (spotMetaAndAssetCtxs).',
    V.unpriced.length ? `No price for: ${V.unpriced.join(', ')} (excluded).` : ''].filter(Boolean).join(' ');
  const mx = Math.max(...V.rows.map((r) => Math.abs(r.total)), 1e-9);
  const modeLbl = (m) => ({ unifiedAccount: 'Unified', portfolioMargin: 'Portfolio margin', disabled: 'Standard', default: 'Standard', dexAbstraction: 'DEX abstr.' }[m] || m);
  const body = V.rows.map((r) => `<tr data-q="${esc((r.name + ' ' + r.addr).toLowerCase())}"><td class="addr" title="${esc(r.addr)}"><a href="https://app.hyperliquid.xyz/explorer/address/${esc(r.addr)}" target="_blank" rel="noopener">${shortAddr(r.addr)}</a></td><td><b>${esc(r.name)}</b> <span class="tag mode">${esc(modeLbl(r.mode))}</span></td>
    <td class="num" title="${r.unified ? 'Perp collateral portion inside spot USDC — not added to total' : 'Perp account value incl. uPnL'}">${r.unified ? `<span class="muted">${fmt(r.perp, 2)}</span>` : fmt(r.perp, 2)}</td><td class="num ${cls(r.upnl)}">${sgn(r.upnl, 4)}</td>
    <td class="num" title="${esc(r.tokens.join(', '))}">${fmt(r.spot, 2)}</td><td class="num"><b>${fmt(r.total, 2)}</b><span class="share"><i style="width:${clamp(Math.abs(r.total) / mx * 100, 0, 100).toFixed(1)}%"></i></span></td>
    <td class="num ${isFinite(r.hl) && Math.abs(r.diff) <= Math.max(0.05, Math.abs(r.hl) * 0.001) ? 'up' : 'warn'}" title="Hyperliquid portfolio account value">${isFinite(r.hl) ? fmt(r.hl, 2) : '--'}</td></tr>`).join('');
  const note = !V.subsOk ? 'Subaccount list unavailable right now — showing master only; will retry.' : V.nSubs === 0 ? 'No subaccounts yet — master only. New subaccounts appear here automatically.' : `${V.nSubs} subaccount${V.nSubs > 1 ? 's' : ''} discovered via the public info API (auto-updates).`;
  $('valTbl').innerHTML = `<thead><tr><th>Account</th><th>Name</th><th class="num">Perp (incl. uPnL)</th><th class="num">uPnL</th><th class="num">Spot @ mark</th><th class="num">Total</th><th class="num">HL value</th></tr></thead><tbody>${body}
    ${V.rows.length > 1 ? `<tr class="tot"><td colspan="5">Grand total</td><td class="num">${fmt(V.total, 2)}</td><td class="num">${fmt(V.hlTotal, 2)}</td></tr>` : ''}<tr class="note"><td colspan="7">${esc(note)}</td></tr></tbody>`;
  applySearch();
}
function applySearch() {
  const q = S.q.trim().toLowerCase();
  document.querySelectorAll('[data-q]').forEach((el) => { el.style.display = !q || el.dataset.q.includes(q) ? '' : 'none'; });
}
function renderAll() { renderHeader(); renderCards(); renderAlerts(); renderPositions(); renderOrders(); renderHistory(); renderEvolution(); renderLimits(); renderJournal(); renderValuation(); renderChart(); }

/* ---------- data loading ---------- */
async function loadBot() {
  try { const r = await fetch(CFG.BOT_JSON_URL + (CFG.BOT_JSON_URL.includes('?') ? '&' : '?') + '_=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw 0;
    const j = await r.json(); const changed = JSON.stringify(j) !== JSON.stringify(S.bot); S.bot = j; S.botOk = true; if (changed) renderAll(); else renderHeader();
  } catch (e) { S.botOk = false; renderHeader(); renderAlerts(); }
}
async function loadState() {
  try {
    const [spot, ch, oo, mids] = await Promise.all([info({ type: 'spotClearinghouseState', user: USER }), info({ type: 'clearinghouseState', user: USER }), info({ type: 'frontendOpenOrders', user: USER }).catch(() => []), info({ type: 'allMids' })]);
    S.spot = spot; S.ch = ch; S.orders = oo || []; S.mids = mids || {}; S.apiOk = true; S.apiAt = Date.now();
  } catch (e) { S.apiOk = false; }
  renderHeader(); renderCards(); renderPositions(); renderOrders(); renderAlerts();
}
async function loadSlow() {
  try { S.portfolio = await info({ type: 'portfolio', user: USER }); } catch (e) {}
  try { const f = await info({ type: 'userFills', user: USER, aggregateByTime: true }); S.fills = (f || []).sort((a, b) => b.time - a.time); } catch (e) {}
  renderCards(); renderHistory(); renderChart();
}
async function loadCandles(coin, tf) {
  const k = coin + tf, cfg = { '24h': ['15m', 864e5], '7d': ['1h', 7 * 864e5], all: ['1d', 120 * 864e5] }[tf], end = Date.now();
  try { const c = await info({ type: 'candleSnapshot', req: { coin, interval: cfg[0], startTime: end - cfg[1], endTime: end } }); S.candles[k] = c; if (S.series === coin && S.tf === tf) renderChart(true); } catch (e) {}
}

/* ---------- UI wiring ---------- */
function setSeries(s) { S.series = s; document.querySelectorAll('#seriesSeg button').forEach((b) => b.classList.toggle('on', b.dataset.s === s)); if (s !== 'equity') loadCandles(s, S.tf); renderChart(true); renderHeader(); }
$('seriesSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSeries(b.dataset.s); });
$('tfSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.tf = b.dataset.tf; document.querySelectorAll('#tfSeg button').forEach((x) => x.classList.toggle('on', x === b)); if (S.series !== 'equity') loadCandles(S.series, S.tf); renderChart(true); });
$('markets').addEventListener('click', (e) => { const m = e.target.closest('.mkt'); if (m) { setSeries(m.dataset.c); closeMenu(); $('overview').scrollIntoView(); } });
$('jfilter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { S.jType = b.dataset.t; renderJournal(); } });
$('search').addEventListener('input', (e) => { S.q = e.target.value; applySearch(); });
$('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('journal').scrollIntoView(); });
$('heroChart').addEventListener('mousemove', chartHover);
$('heroChart').addEventListener('mouseleave', () => { $('chartTip').style.opacity = 0; const h = $('cHover'); if (h) h.style.opacity = 0; });
$('qaHL').href = 'https://app.hyperliquid.xyz/explorer/address/' + USER;
$('qaExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify((S.bot && S.bot.journal) || [], null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tony-alpha-journal-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('qaRollback').addEventListener('click', () => setTimeout(() => { const r = $('rollback'); if (r) { r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash'); } }, 500));
const openMenu = () => document.body.classList.add('menu-open'), closeMenu = () => document.body.classList.remove('menu-open');
$('openMenu').addEventListener('click', openMenu); $('closeMenu').addEventListener('click', closeMenu); $('scrim').addEventListener('click', closeMenu);
document.querySelectorAll('#nav a, .qa a[href^="#"]').forEach((a) => a.addEventListener('click', closeMenu));
// scroll spy + reveal
const navA = [...document.querySelectorAll('#nav a')];
const spy = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) navA.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id)); }); }, { rootMargin: '-35% 0px -60% 0px' });
['overview', 'valuation', 'positions', 'orders', 'history', 'evolution', 'journal', 'alerts'].forEach((id) => spy.observe($(id)));
const rev = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); rev.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('.reveal').forEach((el) => rev.observe(el));
let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => renderChart(false), 120); }).observe($('heroChart'));
function tick() { const d = new Date(); setText('clock', `${d.toUTCString().slice(0, 16)} · ${utcHMS(d)} UTC`); }
setInterval(tick, 1000); tick();

renderAll();
loadBot(); loadState(); loadSlow(); loadValuation(); if (S.series !== 'equity') setSeries(S.series);
setInterval(loadBot, CFG.BOT_POLL_MS); setInterval(loadState, Math.max(CFG.STATE_POLL_MS, 10000)); setInterval(loadSlow, 60000); setInterval(loadValuation, Math.max(CFG.VAL_POLL_MS || 20000, 10000));
setInterval(() => { if (S.series !== 'equity') loadCandles(S.series, S.tf); }, 60000);
setInterval(() => { renderHeader(); renderAlerts(); }, 30000);
})();
