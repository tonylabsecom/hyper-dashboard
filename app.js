/* TONY ALPHA — client-side, read-only Hyperliquid dashboard */
(() => {
'use strict';
const CFG = Object.assign({}, window.HYPER_CONFIG || {});
const qs = new URLSearchParams(location.search);
if (qs.get('user')) CFG.USER = qs.get('user');
if (qs.get('bot')) CFG.BOT_JSON_URL = qs.get('bot');
const USER = CFG.USER;
const TZ = 'Asia/Saigon';
const $ = (id) => document.getElementById(id);
const C = { green:'#0f9d58', red:'#d93025', blue:'#1a73e8', orange:'#f57c00', amber:'#f9a825', ink:'#1d2330', dim:'#8a8f9c', line:'#ece7dc' };

const S = {
  spotUsdc: null, perp: null, mids: {}, prevMids: {}, fills: new Map(), portfolio: null,
  coin: (qs.get('coin') || CFG.DEFAULT_COIN || 'BTC').toUpperCase(),
  candles: [], book: null, bot: null, orders: [], top: [], ctx: {},
  hist: { eq: [], free: [], today: [], total: [], win: [] }, posHist: {}, curveLive: [],
  lastEquity: null, lastPosCoins: null, lastEventAt: 0, wsAlive: false, lastMsg: 0,
};

/* ---------- utils ---------- */
const num = (v) => (v == null || v === '' ? NaN : +v);
const fmt = (v, d = 2) => (isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '--');
const sgn = (v, d = 2) => (isFinite(v) ? (v >= 0 ? '+' : '') + fmt(v, d) : '--');
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
function pxFmt(p) { p = +p; if (!isFinite(p)) return '--'; const a = Math.abs(p);
  const d = a >= 10000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 7; return fmt(p, d); }
const tFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const vnTime = (ms) => tFmt.format(new Date(ms));
const vnDate = (ms) => dFmt.format(new Date(ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const push = (arr, v, max = 120) => { if (isFinite(v)) { arr.push(v); if (arr.length > max) arr.shift(); } };

async function info(body) {
  const r = await fetch(CFG.INFO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('info ' + body.type + ' ' + r.status);
  return r.json();
}

function setupCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function sparkline(cv, data, color) {
  if (!cv) return; const { ctx, w, h } = setupCanvas(cv);
  if (!data || data.length < 2) { ctx.strokeStyle = C.line; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); return; }
  let mn = Math.min(...data), mx = Math.max(...data); if (mx - mn < 1e-9) { mx += 1e-6; mn -= 1e-6; }
  const col = color || (data[data.length - 1] >= data[0] ? C.green : C.red);
  const X = (i) => (i / (data.length - 1)) * (w - 4) + 2, Y = (v) => h - 3 - ((v - mn) / (mx - mn)) * (h - 6);
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + '40'); g.addColorStop(1, col + '00');
  ctx.beginPath(); data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  ctx.lineTo(X(data.length - 1), h); ctx.lineTo(X(0), h); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); data.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
  const lx = X(data.length - 1), ly = Y(data[data.length - 1]);
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx - 1, ly, 2.5, 0, 7); ctx.fill();
}

/* ---------- clock ---------- */
function tickClock() {
  const now = Date.now(); $('clock').textContent = vnTime(now); $('date').textContent = vnDate(now);
  const live = S.wsAlive && now - S.lastMsg < 30000;
  $('liveDot').className = 'dot ' + (live ? 'live' : S.wsAlive ? '' : 'dead');
  $('liveTxt').textContent = live ? 'LIVE' : S.wsAlive ? 'SYNC' : 'RECONNECT';
}
setInterval(tickClock, 1000); tickClock();
$('acct').textContent = USER.slice(0, 6) + '…' + USER.slice(-4);
$('acct').title = USER;

/* ---------- account state ---------- */
function positions() {
  const aps = (S.perp && S.perp.assetPositions) || [];
  return aps.map((a) => a.position).filter((p) => p && +p.szi !== 0).map((p) => {
    const szi = +p.szi, entry = +p.entryPx, mid = num(S.mids[p.coin]);
    const mark = isFinite(mid) ? mid : entry + (+p.unrealizedPnl) / szi;
    const upnl = isFinite(mid) ? szi * (mid - entry) : +p.unrealizedPnl;
    return { coin: p.coin, szi, entry, mark, upnl, liq: num(p.liquidationPx), lev: p.leverage, margin: +p.marginUsed, value: Math.abs(szi * mark), roe: +p.returnOnEquity };
  });
}
function equityNow() {
  if (S.spotUsdc == null) return NaN;
  return S.spotUsdc + positions().reduce((a, p) => a + p.upnl, 0);
}
function fillsArr() { return [...S.fills.values()].sort((a, b) => b.time - a.time); }

function stats() {
  const fills = fillsArr(), today = vnDate(Date.now());
  let realizedToday = 0, feesToday = 0, fees = 0, vol = 0, gross = 0, wins = 0, closes = 0;
  const winSeries = []; const chron = [...fills].reverse();
  for (const f of chron) {
    const pnl = +f.closedPnl, fee = +f.fee || 0; fees += fee; vol += f.px * f.sz; gross += pnl;
    if (vnDate(f.time) === today) { realizedToday += pnl - fee; feesToday += fee; }
    if (pnl !== 0) { closes++; if (pnl > 0) wins++; winSeries.push((wins / closes) * 100); }
  }
  const upnl = positions().reduce((a, p) => a + p.upnl, 0);
  return { todayPnl: realizedToday + upnl, fees, feesToday, vol, gross, win: closes ? (wins / closes) * 100 : NaN, wins, closes, winSeries, n: fills.length };
}

let lastPortRender = 0;
function renderPortfolio(force) {
  const now = Date.now(); if (!force && now - lastPortRender < 700) return; lastPortRender = now;
  const eq = equityNow(); if (!isFinite(eq)) return;
  const st = stats();
  const used = S.perp ? +S.perp.marginSummary.totalMarginUsed || 0 : 0;
  const free = eq - used, total = eq - CFG.BASELINE;
  const el = $('equity');
  if (S.lastEquity != null && Math.abs(eq - S.lastEquity) > 1e-7) {
    el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(eq > S.lastEquity ? 'flash-up' : 'flash-down');
  }
  S.lastEquity = eq;
  el.textContent = fmt(eq, eq < 1000 ? 4 : 2);
  el.classList.toggle('up', total > 0); el.classList.toggle('down', total < 0);
  $('freeMargin').textContent = fmt(free, 2);
  $('todayPnl').textContent = sgn(st.todayPnl, 4); $('todayPnl').className = cls(st.todayPnl);
  $('totalPnl').textContent = sgn(total, 4) + ' (' + sgn((total / CFG.BASELINE) * 100, 2) + '%)'; $('totalPnl').className = cls(total);
  $('winRate').textContent = isFinite(st.win) ? fmt(st.win, 1) + '% ' : '--'; $('winRate').title = st.wins + '/' + st.closes;
  if (isFinite(st.win)) $('winRate').innerHTML = fmt(st.win, 1) + '% <small class="dim">' + st.wins + '/' + st.closes + '</small>';
  const H = S.hist; push(H.eq, eq); push(H.free, free); push(H.today, st.todayPnl); push(H.total, total);
  sparkline($('sparkEquity'), seedEq(), H.eq[H.eq.length - 1] >= CFG.BASELINE ? C.green : C.red);
  sparkline($('sparkFree'), H.free, C.blue); sparkline($('sparkToday'), H.today); sparkline($('sparkTotal'), H.total);
  sparkline($('sparkWin'), st.winSeries.slice(-60), C.orange);
  renderBreakdown(eq);
  // fees panel
  $('feesTotal').textContent = '-' + fmt(st.fees, 4) + ' USDC'; $('feesToday').textContent = '-' + fmt(st.feesToday, 4);
  $('fillsN').textContent = st.n; $('volume').textContent = '$' + fmt(st.vol, 2);
  $('grossPnl').textContent = sgn(st.gross, 4); $('grossPnl').className = cls(st.gross);
}
function seedEq() { return curveData().map((p) => p[1]).slice(-120); }
function renderBreakdown(eq) {
  const ps = positions(), upnl = ps.reduce((a, p) => a + p.upnl, 0), ms = (S.perp && S.perp.marginSummary) || {};
  const ntl = ps.reduce((a, p) => a + p.value, 0), used = +ms.totalMarginUsed || 0;
  const day = S.portfolio && S.portfolio.find((x) => x[0] === 'day');
  const rows = [['SPOT USDC', fmt(S.spotUsdc, 4)], ['PERP UPNL', sgn(upnl, 4), cls(upnl)], ['MARGIN USED', fmt(used, 4)],
    ['OPEN NOTIONAL', '$' + fmt(ntl, 2)], ['EFFECTIVE LEVERAGE', eq > 0 ? fmt(ntl / eq, 2) + 'X' : '--'], ['PERP ACCT VALUE', fmt(+ms.accountValue, 4) + ' <span class="dim">(UNIFIED)</span>'],
    ['24H VOLUME', day ? '$' + fmt(+day[1].vlm, 2) : '--'], ['BASELINE', fmt(CFG.BASELINE, 2)]];
  $('breakdown').innerHTML = rows.map(([k, v, c]) => `<div class="kv"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
}

/* ---------- positions ---------- */
function renderPositions() {
  const ps = positions(); $('posCount').textContent = ps.length;
  const box = $('positions');
  if (!ps.length) { box.innerHTML = '<div class="empty">NO OPEN POSITIONS<br><span class="dim">// FLAT — WAITING FOR SIGNAL</span></div>'; return; }
  const stopOf = (coin, long) => {
    const os = S.orders.filter((o) => o.coin === coin && o.isTrigger);
    const st = os.find((o) => /stop/i.test(o.orderType)); const tp = os.find((o) => /take profit/i.test(o.orderType));
    return { stop: st ? +st.triggerPx : NaN, tp: tp ? +tp.triggerPx : NaN };
  };
  box.innerHTML = ps.map((p) => {
    const long = p.szi > 0, so = stopOf(p.coin, long);
    return `<div class="pos ${long ? 'long' : 'short'}"><div class="pos-h"><span>${esc(p.coin)} <span class="${long ? 'up' : 'down'}">${long ? 'LONG ▲' : 'SHORT ▼'}</span> <span class="dim">${p.lev ? p.lev.value + 'X' : ''}</span></span><span class="${cls(p.upnl)}">${sgn(p.upnl, 4)}</span></div>
      <div class="pos-g"><div><label>SIZE</label><b>${Math.abs(p.szi)}</b></div><div><label>ENTRY</label><b>${pxFmt(p.entry)}</b></div><div><label>MARK</label><b>${pxFmt(p.mark)}</b></div><div><label>LIQ</label><b class="down">${isFinite(p.liq) ? pxFmt(p.liq) : '--'}</b></div>
      <div><label>STOP</label><b class="down">${isFinite(so.stop) ? pxFmt(so.stop) : '--'}</b></div><div><label>TP</label><b class="up">${isFinite(so.tp) ? pxFmt(so.tp) : '--'}</b></div><div><label>VALUE</label><b>$${fmt(p.value, 2)}</b></div><div><label>MARGIN</label><b>$${fmt(p.margin, 2)}</b></div></div>
      <canvas class="spark" data-coin="${esc(p.coin)}"></canvas></div>`;
  }).join('');
  box.querySelectorAll('canvas[data-coin]').forEach((cv) => sparkline(cv, S.posHist[cv.dataset.coin]));
}
let lastPosSpark = 0;
function updatePosSparks() {
  const now = Date.now(); if (now - lastPosSpark < 1000) return; lastPosSpark = now;
  const ps = positions();
  for (const p of ps) { const h = S.posHist[p.coin] || (S.posHist[p.coin] = []); push(h, p.upnl, 150); }
  // live update visible cards without rebuilding DOM
  document.querySelectorAll('#positions .pos').forEach((card, i) => {
    const p = ps[i]; if (!p) return; const cv = card.querySelector('canvas'); if (cv) sparkline(cv, S.posHist[p.coin]);
    const h = card.querySelector('.pos-h > span:last-child'); if (h) { h.textContent = sgn(p.upnl, 4); h.className = cls(p.upnl); }
    const mk = card.querySelectorAll('.pos-g b')[2]; if (mk) mk.textContent = pxFmt(p.mark);
  });
}

/* ---------- trade logs ---------- */
function fillLine(f, isNew) {
  const buy = f.side === 'B', pnl = +f.closedPnl;
  return `<div class="log ${isNew ? 'new' : ''}"><span class="t">[${vnTime(f.time)}]</span> <span class="side ${buy ? 'up' : 'down'}">${buy ? 'BUY ' : 'SELL'}</span> <span class="coin">${esc(f.coin)}</span> @ <b>${pxFmt(f.px)}</b> <span class="dim">SZ</span> ${f.sz} ${pnl !== 0 ? `<span class="${cls(pnl)}">PNL ${sgn(pnl, 4)}</span>` : ''} <span class="dir">${esc(f.dir || '')}</span></div>`;
}
function renderLogs(newTids) {
  const arr = fillsArr().slice(0, 200); $('fillCount').textContent = S.fills.size + ' FILLS';
  $('logs').innerHTML = arr.length ? arr.map((f) => fillLine(f, newTids && newTids.has(f.tid))).join('') : '<div class="empty">NO FILLS YET</div>';
}
function addFills(fills, isLive) {
  const fresh = new Set(); const freshFills = [];
  for (const f of fills || []) { if (!S.fills.has(f.tid)) { S.fills.set(f.tid, f); fresh.add(f.tid); freshFills.push(f); } }
  if (!fresh.size) return;
  renderLogs(isLive ? fresh : null); renderDaily(); renderPortfolio(true); updateTabs();
  if (isLive) { const f = freshFills.sort((a, b) => b.time - a.time)[0]; orbEvent(f); setTimeout(refreshAccount, 800); }
}

/* ---------- orb (3D particle sphere, canvas 2D) ---------- */
const orb = { cv: $('orb'), pts: [], mode: 'warm', until: 0, flash: 0, rings: [], palette: null };
(function initOrb() {
  const N = 1100, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
    orb.pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, s: Math.random(), ph: Math.random() * 6.28 }); }
})();
const PAL = {
  warm: ['#f57c00', '#ff9800', '#ffb300', '#e65100', '#ffa726'],
  cool: ['#1a73e8', '#00acc1', '#26c6da', '#3949ab', '#0f9d58'],
  stop: ['#1a73e8', '#5c6bc0', '#d93025', '#00acc1', '#7e57c2'],
};
function orbEvent(f) {
  let text, sub, color, pal = 'cool';
  const pnl = f ? +f.closedPnl : 0;
  if (f && /close/i.test(f.dir || '') && pnl > 0) { text = 'TP HIT ▲'; color = C.green; }
  else if (f && /close/i.test(f.dir || '') && pnl < 0) { text = 'STOP ▼'; color = C.red; pal = 'stop'; }
  else if (f && /close/i.test(f.dir || '')) { text = 'CLOSED ■'; color = C.blue; }
  else if (f) { text = (f.side === 'B' ? 'BUY ' : 'SELL ') + f.coin + (f.side === 'B' ? ' ▲' : ' ▼'); color = f.side === 'B' ? C.green : C.red; }
  else { text = 'POSITION CLOSED'; color = C.blue; }
  if (f) sub = `${f.dir || ''} @ ${pxFmt(f.px)} · ${f.sz}${pnl ? ' · PNL ' + sgn(pnl, 4) : ''}`;
  orb.mode = pal; orb.until = performance.now() + 5000; orb.flash = 1; orb.rings.push({ r: 0, a: 1, c: color }, { r: -40, a: 1, c: color });
  S.lastEventAt = Date.now();
  const t = $('orbText'); t.textContent = text; t.style.color = color; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  $('orbSub').textContent = sub || ''; $('orbState').textContent = 'EVENT // ' + vnTime(Date.now());
  clearTimeout(orb.tt); orb.tt = setTimeout(() => { t.classList.remove('show'); $('orbState').textContent = 'IDLE'; }, 5000);
}
function drawOrb(t) {
  const { ctx, w, h } = setupCanvas(orb.cv); const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.34;
  if (orb.mode !== 'warm' && t > orb.until) orb.mode = 'warm';
  const pal = PAL[orb.mode]; orb.flash *= 0.95;
  // glow
  const gg = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.5);
  gg.addColorStop(0, (orb.mode === 'warm' ? 'rgba(255,152,0,' : 'rgba(26,115,232,') + (0.16 + orb.flash * 0.35) + ')'); gg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gg; ctx.fillRect(0, 0, w, h);
  const ry = t * 0.00025, rx = Math.sin(t * 0.0001) * 0.5, cyR = Math.cos(ry), syR = Math.sin(ry), cxR = Math.cos(rx), sxR = Math.sin(rx);
  const pulse = 1 + Math.sin(t * 0.002) * 0.03 + orb.flash * 0.25;
  const proj = [];
  for (const p of orb.pts) {
    const n = 1 + 0.08 * Math.sin(p.ph + t * 0.0015 + p.y * 4) + orb.flash * 0.3 * p.s;
    let x = p.x * n, y = p.y * n, z = p.z * n;
    let x1 = x * cyR - z * syR, z1 = x * syR + z * cyR; let y1 = y * cxR - z1 * sxR, z2 = y * sxR + z1 * cxR;
    const f = 2.6 / (2.6 + z2); proj.push([cx + x1 * R * f * pulse, cy + y1 * R * f * pulse, z2, p]);
  }
  proj.sort((a, b) => b[2] - a[2]);
  for (const [px, py, z, p] of proj) {
    const depth = (1 - z) / 2; ctx.globalAlpha = 0.18 + depth * 0.8;
    ctx.fillStyle = pal[(p.s * pal.length) | 0]; const sz = 0.6 + depth * 1.9 + p.s * 0.6;
    ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
  }
  ctx.globalAlpha = 1;
  // orbit rings
  ctx.strokeStyle = orb.mode === 'warm' ? 'rgba(245,124,0,.35)' : 'rgba(26,115,232,.45)'; ctx.lineWidth = 1;
  for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.ellipse(cx, cy, R * (1.35 + k * 0.18), R * (0.32 + k * 0.06), t * 0.0002 * (k ? -1 : 1), 0, 7); ctx.setLineDash(k ? [2, 6] : []); ctx.stroke(); }
  ctx.setLineDash([]);
  // shock rings
  orb.rings = orb.rings.filter((r) => r.a > 0.02);
  for (const r of orb.rings) { r.r += 4; r.a *= 0.965; if (r.r > 0) { ctx.globalAlpha = r.a; ctx.strokeStyle = r.c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R + r.r, 0, 7); ctx.stroke(); } }
  ctx.globalAlpha = 1;
  // HUD ticks
  ctx.strokeStyle = 'rgba(29,35,48,.25)'; for (let i = 0; i < 60; i++) { const a = (i / 60) * 6.283 + t * 0.00005, r1 = R * 1.62, r2 = r1 + (i % 5 ? 4 : 9);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke(); }
  const eq = equityNow(); ctx.fillStyle = C.ink; ctx.font = '600 11px JetBrains Mono, monospace'; ctx.textAlign = 'left';
  ctx.fillText('EQ ' + (isFinite(eq) ? fmt(eq, 4) : '--'), 10, 18); ctx.fillStyle = C.dim; ctx.fillText('MODE ' + orb.mode.toUpperCase(), 10, 32);
  ctx.textAlign = 'right'; ctx.fillText('POS ' + positions().length + ' · FILLS ' + S.fills.size, w - 10, 18);
  requestAnimationFrame(drawOrb);
}
requestAnimationFrame(drawOrb);

/* ---------- market: candles + book ---------- */
let candleDirty = true;
function drawCandles() {
  const cv = $('candles'); const { ctx, w, h } = setupCanvas(cv);
  const data = S.candles.slice(-Math.max(30, Math.floor(w / 7)));
  if (!data.length) { ctx.fillStyle = C.dim; ctx.font = '12px JetBrains Mono, monospace'; ctx.fillText('LOADING CANDLES…', 12, 24); return; }
  const padR = 62, padB = 18, cw = (w - padR) / data.length;
  let hi = -Infinity, lo = Infinity, vmax = 0; for (const c of data) { hi = Math.max(hi, +c.h); lo = Math.min(lo, +c.l); vmax = Math.max(vmax, +c.v); }
  const pad = (hi - lo) * 0.08 || hi * 0.001; hi += pad; lo -= pad;
  const Y = (p) => 6 + (1 - (p - lo) / (hi - lo)) * (h - padB - 6 - 30);
  // grid
  ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left';
  for (let i = 0; i <= 5; i++) { const p = lo + ((hi - lo) * i) / 5, y = Y(p); ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.fillStyle = C.dim; ctx.fillText(pxFmt(p), w - padR + 4, y + 3); }
  data.forEach((c, i) => {
    const x = i * cw + cw / 2, o = +c.o, cl = +c.c, up = cl >= o, col = up ? C.green : C.red;
    // volume
    ctx.fillStyle = (up ? C.green : C.red) + '30'; const vh = (+c.v / (vmax || 1)) * 28; ctx.fillRect(x - cw * 0.35, h - padB - vh, cw * 0.7, vh);
    ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x, Y(+c.h)); ctx.lineTo(x, Y(+c.l)); ctx.stroke();
    const y1 = Y(Math.max(o, cl)), y2 = Y(Math.min(o, cl)); ctx.fillStyle = col; ctx.fillRect(x - cw * 0.35, y1, Math.max(1, cw * 0.7), Math.max(1, y2 - y1));
    if (i % Math.ceil(60 / cw) === 0) { ctx.fillStyle = C.dim; ctx.fillText(vnTime(c.t).slice(0, 5), x - 14, h - 4); }
  });
  // EMA20 overlay (orange)
  const k = 2 / 21; let e = null; ctx.strokeStyle = C.orange; ctx.lineWidth = 1.3; ctx.beginPath();
  S.candles.forEach((c, idx) => { e = e == null ? +c.c : +c.c * k + e * (1 - k); const i = idx - (S.candles.length - data.length); if (i >= 0) { const x = i * cw + cw / 2; i ? ctx.lineTo(x, Y(e)) : ctx.moveTo(x, Y(e)); } });
  ctx.stroke();
  // entry line for open position
  const pos = positions().find((p) => p.coin === S.coin);
  if (pos && pos.entry > lo && pos.entry < hi) { ctx.setLineDash([4, 4]); ctx.strokeStyle = C.blue; ctx.beginPath(); ctx.moveTo(0, Y(pos.entry)); ctx.lineTo(w - padR, Y(pos.entry)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = C.blue; ctx.fillText('ENTRY', 4, Y(pos.entry) - 3); }
  // last price tag
  const last = +data[data.length - 1].c, ly = Y(last), up = last >= +data[data.length - 1].o;
  ctx.setLineDash([2, 3]); ctx.strokeStyle = up ? C.green : C.red; ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(w - padR, ly); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = up ? C.green : C.red; ctx.fillRect(w - padR, ly - 8, padR, 16); ctx.fillStyle = '#fff'; ctx.fillText(pxFmt(last), w - padR + 4, ly + 4);
  ctx.fillStyle = C.dim; ctx.fillText('EMA20', 6, 14);
}
function candleLoop() { if (candleDirty) { candleDirty = false; drawCandles(); } requestAnimationFrame(candleLoop); }
requestAnimationFrame(candleLoop);
function updateMarketHead() {
  const last = S.candles.length ? +S.candles[S.candles.length - 1].c : num(S.mids[S.coin]);
  $('mkCoin').textContent = S.coin + '-PERP'; $('mkPx').textContent = pxFmt(last);
  const ctx = S.ctx[S.coin]; if (ctx && +ctx.prevDayPx) { const ch = (last / +ctx.prevDayPx - 1) * 100; $('mkChg').textContent = '24H ' + sgn(ch, 2) + '%'; $('mkChg').className = cls(ch); }
}
function renderBook() {
  const b = S.book; if (!b) return; const [bids, asks] = b.levels; const N = window.innerWidth < 680 ? 7 : 10;
  const A = asks.slice(0, N), B = bids.slice(0, N); let cum = 0;
  const ac = A.map((l) => (cum += +l.sz)); cum = 0; const bc = B.map((l) => (cum += +l.sz));
  const mx = Math.max(ac[ac.length - 1] || 1, bc[bc.length - 1] || 1);
  const row = (l, c) => `<div class="lvl"><i style="width:${(c / mx) * 100}%"></i><span>${pxFmt(l.px)}</span><span>${(+l.sz).toFixed(4)}</span><span>${c.toFixed(3)}</span></div>`;
  $('asks').innerHTML = A.map((l, i) => row(l, ac[i])).reverse().join('');
  $('bids').innerHTML = B.map((l, i) => row(l, bc[i])).join('');
  if (A[0] && B[0]) { const sp = +A[0].px - +B[0].px, mid = (+A[0].px + +B[0].px) / 2; const dd = (String(A[0].px).split('.')[1] || '').length; $('spread').textContent = 'SPREAD ' + fmt(sp, dd) + ' (' + fmt((sp / mid) * 100, 4) + '%)'; }
}
function updateTabs() {
  const set = new Set([S.coin, 'BTC', 'ETH', 'SOL', 'HYPE']); positions().forEach((p) => set.add(p.coin));
  fillsArr().slice(0, 50).forEach((f) => { if (!f.coin.startsWith('@') && !f.coin.includes('/')) set.add(f.coin); });
  const coins = [...set].slice(0, 8); const el = $('coinTabs');
  const key = coins.join(',') + '|' + S.coin; if (el.dataset.k === key) return; el.dataset.k = key;
  el.innerHTML = coins.map((c) => `<button class="${c === S.coin ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
}
$('coinTabs').addEventListener('click', (e) => { const c = e.target.dataset && e.target.dataset.c; if (c && c !== S.coin) selectCoin(c); });
async function selectCoin(c) {
  const old = S.coin; S.coin = c; S.candles = []; S.book = null; $('asks').innerHTML = ''; $('bids').innerHTML = ''; candleDirty = true; updateTabs(); updateMarketHead();
  wsSend({ method: 'unsubscribe', subscription: { type: 'candle', coin: old, interval: '5m' } });
  wsSend({ method: 'unsubscribe', subscription: { type: 'l2Book', coin: old } });
  subscribeMarket(); await loadCandles();
}
async function loadCandles() {
  const coin = S.coin, end = Date.now();
  try { const cs = await info({ type: 'candleSnapshot', req: { coin, interval: '5m', startTime: end - 200 * 300000, endTime: end } });
    if (coin !== S.coin) return; S.candles = cs; candleDirty = true; updateMarketHead(); } catch (e) { console.warn(e); }
  try { const b = await info({ type: 'l2Book', coin }); if (coin === S.coin) { S.book = b; renderBook(); } } catch (e) {}
}
function onCandle(c) {
  if (c.s !== S.coin) return; const arr = S.candles, last = arr[arr.length - 1];
  if (last && last.t === c.t) arr[arr.length - 1] = c; else if (!last || c.t > last.t) { arr.push(c); if (arr.length > 400) arr.shift(); }
  candleDirty = true; updateMarketHead();
}

/* ---------- ticker ---------- */
async function loadTop() {
  try { const [meta, ctxs] = await info({ type: 'metaAndAssetCtxs' });
    const rows = meta.universe.map((u, i) => ({ name: u.name, vol: +ctxs[i].dayNtlVlm, ctx: ctxs[i], dl: u.isDelisted }));
    rows.forEach((r) => (S.ctx[r.name] = r.ctx));
    S.top = rows.filter((r) => !r.dl).sort((a, b) => b.vol - a.vol).slice(0, 10).map((r) => r.name);
    renderTicker(true); updateMarketHead();
  } catch (e) { console.warn(e); }
}
let lastTicker = 0;
function renderTicker(force) {
  const now = Date.now(); if (!force && now - lastTicker < 2000) return; lastTicker = now;
  if (!S.top.length) return;
  const items = S.top.map((c) => {
    const m = num(S.mids[c]) || num(S.ctx[c] && S.ctx[c].markPx), prev = num(S.ctx[c] && S.ctx[c].prevDayPx), ch = prev ? (m / prev - 1) * 100 : NaN;
    const pm = num(S.prevMids[c]); const fl = isFinite(pm) && m !== pm ? (m > pm ? 'flash-up' : 'flash-down') : '';
    return `<span class="tk ${fl}">${esc(c)} <b>${pxFmt(m)}</b><span class="c ${cls(ch)}">${isFinite(ch) ? (ch >= 0 ? '▲' : '▼') + fmt(Math.abs(ch), 2) + '%' : ''}</span></span>`;
  }).join('');
  const tr = $('ticker'); if (!tr.dataset.init) { tr.dataset.init = 1; }
  tr.innerHTML = items + items; S.top.forEach((c) => (S.prevMids[c] = S.mids[c]));
}

/* ---------- bottom charts ---------- */
function curveData() {
  const p = S.portfolio && S.portfolio.find((x) => x[0] === 'allTime');
  let hist = p ? p[1].accountValueHistory.map(([t, v]) => [t, +v]) : [];
  const first = hist.findIndex((x) => x[1] > 0); hist = first >= 0 ? hist.slice(first) : [];
  const lastT = hist.length ? hist[hist.length - 1][0] : 0;
  return hist.concat(S.curveLive.filter((x) => x[0] > lastT));
}
function renderCurve() {
  const { ctx, w, h } = setupCanvas($('curve')); const d = curveData();
  ctx.font = '10px JetBrains Mono, monospace';
  if (d.length < 2) { ctx.fillStyle = C.dim; ctx.fillText('RECORDING EQUITY CURVE…', 12, 24); return; }
  let mn = Math.min(...d.map((x) => x[1]), CFG.BASELINE), mx = Math.max(...d.map((x) => x[1]), CFG.BASELINE); const pad = (mx - mn) * 0.15 || 0.05; mn -= pad; mx += pad;
  const t0 = d[0][0], t1 = d[d.length - 1][0], padR = 50;
  const X = (t) => 4 + ((t - t0) / (t1 - t0 || 1)) * (w - padR - 8), Y = (v) => 8 + (1 - (v - mn) / (mx - mn)) * (h - 28);
  for (let i = 0; i <= 4; i++) { const v = mn + ((mx - mn) * i) / 4; ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(0, Y(v)); ctx.lineTo(w - padR, Y(v)); ctx.stroke(); ctx.fillStyle = C.dim; ctx.fillText(fmt(v, 3), w - padR + 3, Y(v) + 3); }
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(245,124,0,.35)'); g.addColorStop(1, 'rgba(245,124,0,0)');
  ctx.beginPath(); d.forEach(([t, v], i) => (i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v)))); ctx.lineTo(X(t1), h - 20); ctx.lineTo(X(t0), h - 20); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); d.forEach(([t, v], i) => (i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v)))); ctx.strokeStyle = C.orange; ctx.lineWidth = 2; ctx.stroke();
  ctx.setLineDash([4, 4]); ctx.strokeStyle = C.blue; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, Y(CFG.BASELINE)); ctx.lineTo(w - padR, Y(CFG.BASELINE)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = C.blue; ctx.fillText('BASELINE ' + CFG.BASELINE, 6, Y(CFG.BASELINE) - 4);
  const lv = d[d.length - 1]; ctx.fillStyle = C.orange; ctx.beginPath(); ctx.arc(X(lv[0]), Y(lv[1]), 3.5, 0, 7); ctx.fill();
  ctx.fillStyle = C.dim; ctx.fillText(vnDate(t0).slice(5) + ' ' + vnTime(t0).slice(0, 5), 4, h - 6); ctx.textAlign = 'right'; ctx.fillText(vnTime(t1).slice(0, 5) + ' UTC+7', w - padR, h - 6); ctx.textAlign = 'left';
}
function renderDaily() {
  const { ctx, w, h } = setupCanvas($('daily')); ctx.font = '10px JetBrains Mono, monospace';
  const days = {}; for (const f of S.fills.values()) { const d = vnDate(f.time); days[d] = (days[d] || 0) + (+f.closedPnl) - (+f.fee || 0); }
  const keys = []; for (let i = 13; i >= 0; i--) keys.push(vnDate(Date.now() - i * 86400000));
  const vals = keys.map((k) => days[k] || 0); const m = Math.max(...vals.map(Math.abs), 1e-4);
  const bw = (w - 10) / keys.length, mid = (h - 20) / 2 + 4;
  ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
  keys.forEach((k, i) => { const v = vals[i], bh = (Math.abs(v) / m) * ((h - 30) / 2), x = 5 + i * bw;
    ctx.fillStyle = v >= 0 ? C.green : C.red; if (v !== 0) ctx.fillRect(x + bw * 0.15, v >= 0 ? mid - bh : mid, bw * 0.7, Math.max(1, bh));
    if (i % 2 === 1 || bw > 34) { ctx.fillStyle = C.dim; ctx.fillText(k.slice(8), x + bw * 0.25, h - 4); }
    if (v !== 0 && bw > 30) { ctx.fillStyle = v >= 0 ? C.green : C.red; ctx.fillText(sgn(v, 3), x, v >= 0 ? mid - bh - 3 : mid + bh + 10); } });
  ctx.fillStyle = C.dim; ctx.fillText('14 DAYS · NET (AFTER FEES)', 6, 12);
}

/* ---------- bot.json ---------- */
async function loadBot() {
  try {
    const url = CFG.BOT_JSON_URL + (CFG.BOT_JSON_URL.includes('?') ? '&' : '?') + 't=' + Date.now();
    const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status);
    const ct = r.headers.get('content-type') || ''; const txt = await r.text(); if (/text\/html/.test(ct) && txt.trim().startsWith('<')) throw new Error('html');
    S.bot = JSON.parse(txt); renderBot();
  } catch (e) { if (!S.bot) renderBotEmpty(); }
}
function renderBotEmpty() {
  $('signal').innerHTML = '<div class="waiting">WAITING FOR BOT DATA<span class="blink">_</span><div class="dim" style="font-size:10px;margin-top:8px">./data/bot.json NOT FOUND — DASHBOARD STILL RUNS NORMALLY</div></div>';
  $('lessons').innerHTML = '<span class="lesson"><b>BOT LESSONS //</b></span><span class="lesson">WAITING FOR BOT DATA — LESSONS WILL APPEAR HERE</span><span class="lesson">DISCIPLINE &gt; PREDICTION</span><span class="lesson">ALWAYS SET A STOP</span>';
}
function renderBot() {
  const b = S.bot || {}; const ls = b.last_signal || {}; const ds = b.daily_stop || {};
  const status = String(b.status || 'UNKNOWN').toUpperCase(); const okS = /RUN|ACTIVE|ON/.test(status);
  const conf = Math.max(0, Math.min(100, +b.confidence || 0)); const side = String(ls.side || '').toUpperCase();
  const kill = b.kill_switch === true || (b.kill_switch && b.kill_switch.active);
  const stale = b.updated_at ? (Date.now() - Date.parse(b.updated_at)) / 60000 : NaN;
  $('signal').innerHTML = `
    <div class="kv"><span>BOT STATUS</span><b><span class="badge ${okS ? 'ok' : 'warn'}">${okS ? '● ' : ''}${esc(status)}</span></b></div>
    <div class="kv"><span>STRATEGY</span><b>${esc(b.strategy || '--')}</b></div>
    <div class="kv"><span>LEVERAGE</span><b>${b.leverage ? esc(b.leverage) + 'X' : '--'}</b></div>
    <div class="sigbox"><div class="dim" style="font-size:9px">LAST SIGNAL ${ls.time ? '· ' + esc(vnTime(Date.parse(ls.time) || Date.now())) : ''}</div>
      <div class="big ${/LONG|BUY/.test(side) ? 'up' : /SHORT|SELL/.test(side) ? 'down' : ''}">${esc(side || '--')} ${esc(ls.coin || '')} ${ls.price ? '@ ' + pxFmt(ls.price) : ''}</div>
      ${ls.reason ? `<div class="reason">${esc(ls.reason)}</div>` : ''}</div>
    <div class="kv"><span>CONFIDENCE</span><b>${conf}%</b></div><div class="conf"><i style="width:${conf}%"></i></div>
    <div class="kv"><span>DAILY STOP ${ds.limit_usd != null ? '(' + esc(ds.limit_usd) + ')' : ''}</span><b><span class="badge ${ds.triggered ? 'bad' : 'ok'}">${ds.triggered ? 'TRIGGERED' : ds.enabled === false ? 'OFF' : 'SAFE'}</span></b></div>
    <div class="kv"><span>KILL-SWITCH</span><b><span class="badge ${kill ? 'bad' : 'ok'}">${kill ? 'ON ■' : 'OFF'}</span></b></div>
    <div class="kv"><span>UPDATED (UTC+7)</span><b class="${stale > 75 ? 'down' : ''}">${b.updated_at ? esc(vnTime(Date.parse(b.updated_at))) + (isFinite(stale) ? ' (' + Math.round(stale) + ' MIN AGO)' : '') : '--'}</b></div>`;
  const L = Array.isArray(b.lessons) && b.lessons.length ? b.lessons : ['NO LESSONS YET'];
  const html = '<span class="lesson"><b>BOT LESSONS //</b></span>' + L.map((l) => `<span class="lesson">${esc(typeof l === 'string' ? l : l.text || JSON.stringify(l))}</span>`).join('');
  const el = $('lessons'); if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; }
}

/* ---------- REST polling ---------- */
async function refreshAccount() {
  try {
    const [spot, perp, orders] = await Promise.all([
      info({ type: 'spotClearinghouseState', user: USER }),
      info({ type: 'clearinghouseState', user: USER }),
      info({ type: 'frontendOpenOrders', user: USER }).catch(() => []),
    ]);
    const usdc = (spot.balances || []).find((b) => b.coin === 'USDC'); S.spotUsdc = usdc ? +usdc.total : 0;
    S.perp = perp; S.orders = orders || [];
    const coins = positions().map((p) => p.coin).sort().join(',');
    if (S.lastPosCoins != null && coins !== S.lastPosCoins) {
      const closed = S.lastPosCoins.split(',').filter((c) => c && !coins.split(',').includes(c));
      if (closed.length && Date.now() - S.lastEventAt > 6000) orbEvent(null);
    }
    S.lastPosCoins = coins;
    const eq = equityNow(); if (isFinite(eq)) { S.curveLive.push([Date.now(), eq]); if (S.curveLive.length > 2000) S.curveLive.shift(); }
    renderPortfolio(true); renderPositions(); renderCurve(); updateTabs();
  } catch (e) { console.warn('account', e); }
}
async function loadPortfolio() { try { S.portfolio = await info({ type: 'portfolio', user: USER }); renderCurve(); renderPortfolio(true); } catch (e) { console.warn(e); } }
async function loadFills() { try { const f = await info({ type: 'userFills', user: USER, aggregateByTime: false }); addFills(f, false); renderLogs(); renderDaily(); } catch (e) { console.warn(e); } }

/* ---------- websocket with reconnect ---------- */
let ws = null, backoff = 1000, pingT = null;
function wsSend(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function subscribeMarket() {
  wsSend({ method: 'subscribe', subscription: { type: 'candle', coin: S.coin, interval: '5m' } });
  wsSend({ method: 'subscribe', subscription: { type: 'l2Book', coin: S.coin } });
}
function connect() {
  try { ws = new WebSocket(CFG.WS_URL); } catch (e) { return scheduleReconnect(); }
  ws.onopen = () => {
    S.wsAlive = true; S.lastMsg = Date.now(); backoff = 1000; tickClock();
    wsSend({ method: 'subscribe', subscription: { type: 'allMids' } });
    wsSend({ method: 'subscribe', subscription: { type: 'userFills', user: USER } });
    subscribeMarket();
    clearInterval(pingT); pingT = setInterval(() => wsSend({ method: 'ping' }), 25000);
  };
  ws.onmessage = (ev) => {
    S.lastMsg = Date.now(); let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    const d = m.data;
    switch (m.channel) {
      case 'allMids': Object.assign(S.mids, d.mids); renderTicker(); renderPortfolio(); updatePosSparks(); if (!S.candles.length) updateMarketHead(); break;
      case 'userFills': addFills(d.fills, !d.isSnapshot); break;
      case 'candle': onCandle(d); break;
      case 'l2Book': if (d.coin === S.coin) { S.book = d; renderBook(); } break;
    }
  };
  ws.onclose = () => { S.wsAlive = false; clearInterval(pingT); tickClock(); scheduleReconnect(); };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}
let reconT = null;
function scheduleReconnect() { clearTimeout(reconT); reconT = setTimeout(() => { connect(); loadFills(); loadCandles(); }, backoff); backoff = Math.min(backoff * 2, 15000); }
// watchdog: no messages for 60s -> force reconnect
setInterval(() => { if (ws && ws.readyState === 1 && Date.now() - S.lastMsg > 60000) { try { ws.close(); } catch (e) {} } }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (!ws || ws.readyState > 1) { clearTimeout(reconT); backoff = 1000; connect(); } refreshAccount(); loadFills(); } });

/* ---------- resize ---------- */
let rzT; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { candleDirty = true; renderCurve(); renderDaily(); renderPortfolio(true); renderPositions(); renderBook(); }, 150); });

/* ---------- boot ---------- */
renderBotEmpty(); updateTabs(); renderLogs(); renderDaily();
connect();
refreshAccount(); loadPortfolio(); loadFills(); loadCandles(); loadTop(); loadBot();
setInterval(refreshAccount, CFG.STATE_POLL_MS || 5000);
setInterval(loadPortfolio, 120000);
setInterval(loadTop, 300000);
setInterval(loadBot, CFG.BOT_POLL_MS || 30000);
window.__HYPER = S; window.__HYPER_orbEvent = orbEvent; // debug
})();
