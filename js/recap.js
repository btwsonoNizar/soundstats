'use strict';
/*
 * Recap settimanali, mensili e annuali: per ogni periodo concluso crea
 * un'immagine verticale (formato storia, 1080×1920) da salvare o condividere.
 * Usa le funzioni dell'interfaccia definite in app.js.
 */

/* ---------- Periodi ---------- */

function mondayOf(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const shortDate = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });

function periodOf(key) {
  const [k, v] = [key.charAt(0), key.slice(2)];
  if (k === 'w') {
    const from = new Date(v + 'T00:00'), to = new Date(from); to.setDate(to.getDate() + 7);
    const last = new Date(to); last.setDate(last.getDate() - 1);
    const prev = new Date(from); prev.setDate(prev.getDate() - 7);
    const label = from.getMonth() === last.getMonth()
      ? `${from.getDate()}–${last.getDate()} ${MESI_BREVI[from.getMonth()]} ${last.getFullYear()}`
      : `${shortDate.format(from)} – ${shortDate.format(last)} ${last.getFullYear()}`;
    return { key, kind: 'w', from, to, prevFrom: prev, label, kindLabel: 'Recap settimanale', vs: 'rispetto alla settimana prima', short: 'Settimana' };
  }
  if (k === 'm') {
    const m = +v, y = monYear(m), mi = m - (y - 2000) * 12;
    return {
      key, kind: 'm', from: new Date(y, mi, 1), to: new Date(y, mi + 1, 1), prevFrom: new Date(y, mi - 1, 1),
      label: MESI[mi] + ' ' + y, kindLabel: 'Recap mensile', vs: 'rispetto al mese prima', short: 'Mese',
    };
  }
  const y = +v;
  const running = new Date().getFullYear() === y;
  return {
    key, kind: 'y', from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1), prevFrom: new Date(y - 1, 0, 1),
    label: running ? `${y} (finora)` : String(y), kindLabel: running ? 'Il tuo anno finora' : 'Il tuo anno', vs: 'rispetto all\'anno prima', short: 'Anno',
  };
}

// Periodi conclusi presenti nei dati, dal più recente.
function recapPeriods(kind) {
  const m = S.meta, now = new Date();
  if (!m || !m.n) return [];
  const lastT = Math.max(m.last, m.lastLive || 0);
  if (kind === 'w') {
    const out = [];
    const thisWeek = mondayOf(now);
    for (let d = mondayOf(new Date(lastT * 1000)); d >= mondayOf(new Date(m.first * 1000)) && out.length < 60; d.setDate(d.getDate() - 7)) {
      if (d < thisWeek) out.push('w-' + ymd(d));
    }
    return out;
  }
  if (kind === 'm') {
    const cur = (now.getFullYear() - 2000) * 12 + now.getMonth();
    return m.months.filter(x => x < cur).reverse().map(x => 'm-' + x);
  }
  return m.years.slice().reverse().map(y => 'y-' + y);
}

const seenRecaps = () => new Set(load('ss-recap-seen', []));
function markSeen(key) { const s = seenRecaps(); s.add(key); save('ss-recap-seen', [...s].slice(-300)); }

function recapFilter(p, from, to) {
  return { from: from / 1000, to: to / 1000, minMs: S.filter.minSec * 1000, noSkip: !!S.filter.noSkip && !!S.meta.hasSkip };
}

/* ---------- Schede dei recap ---------- */

function recapTile(p, ms, isNew) {
  return `<a class="recap-tile k-${p.kind}" href="#/recap/${p.key}">
    ${isNew ? '<span class="badge">Nuovo</span>' : ''}
    <span class="rt-kind">${p.short}</span>
    <b>${esc(p.label)}</b>
    <span class="rt-num">${ms != null ? fmtHours(ms) + ' h' : ''}</span>
  </a>`;
}

// Riquadro in homepage: ultima settimana, ultimo mese, anno.
async function recapShelfHtml() {
  const keys = [recapPeriods('w')[0], recapPeriods('m')[0], recapPeriods('y')[0]].filter(Boolean);
  if (!keys.length) return '';
  const ps = keys.map(periodOf);
  const sums = await call('totals', { ranges: ps.map(p => [p.from / 1000, p.to / 1000]), minMs: S.filter.minSec * 1000, noSkip: false });
  const seen = seenRecaps();
  const tiles = ps.map((p, i) => sums[i] ? recapTile(p, sums[i], !seen.has(p.key)) : '').join('');
  if (!tiles) return '';
  return `<section class="shelf">
    <div class="card-head"><h2>I tuoi recap</h2><a class="more" href="#/recap">Tutti</a></div>
    <div class="recap-row">${tiles}</div>
  </section>`;
}

async function viewRecapList(el, alive) {
  const kind = S.recapKind || 'w';
  const keys = recapPeriods(kind);
  const ps = keys.map(periodOf);
  const sums = ps.length ? await call('totals', { ranges: ps.map(p => [p.from / 1000, p.to / 1000]), minMs: S.filter.minSec * 1000, noSkip: false }) : [];
  if (!alive()) return;
  const seen = seenRecaps();
  const tiles = ps.map((p, i) => sums[i] ? recapTile(p, sums[i], !seen.has(p.key)) : '').join('');
  el.innerHTML = `
    <p class="hint">Ogni settimana, mese e anno concluso diventa un'immagine da salvare o condividere nelle storie.</p>
    ${seg('recapKind', [['w', 'Settimane'], ['m', 'Mesi'], ['y', 'Anni']], kind).replace('class="seg"', 'class="seg wide"')}
    <div class="recap-grid">${tiles || '<p class="hint pad">Nessun periodo concluso con ascolti.</p>'}</div>
    ${kind === 'w' && S.meta.lastLive === 0 ? '<p class="hint small">Per avere i recap delle settimane più recenti apri SoundStats ogni tanto: l\'app salva gli ascolti recenti da Spotify.</p>' : ''}`;
  onSeg(el, 'recapKind', v => { S.recapKind = v; route(); });
}

async function viewRecap(el, alive, key) {
  const p = periodOf(key);
  const flt = recapFilter(p, p.from, p.to);
  const [o, prev] = await Promise.all([
    call('overview', { flt }),
    call('totals', { ranges: [[p.prevFrom / 1000, p.from / 1000]], minMs: flt.minMs, noSkip: flt.noSkip }),
  ]);
  if (!alive()) return;
  $('#title').textContent = p.kindLabel;
  if (!o.plays) { el.innerHTML = '<div class="empty"><p>Nessun ascolto in questo periodo.</p></div>'; return; }
  markSeen(key);
  el.innerHTML = `
    <div class="recap-view">
      <div class="recap-frame"><div class="loading"><div class="spinner"></div><p class="hint">Creo l'immagine…</p></div></div>
      <div class="recap-actions">
        <button class="btn primary" id="rcShare" disabled>Condividi o salva</button>
        <a class="btn" id="rcDownload" download="soundstats-${key}.png">Scarica</a>
      </div>
      <p class="hint small">Su iPhone: "Condividi o salva" → "Salva immagine" per metterla nelle Foto.</p>
    </div>`;
  const canvas = await drawRecap(p, o, prev[0]);
  if (!alive()) return;
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const url = URL.createObjectURL(blob);
  $('.recap-frame', el).innerHTML = `<img src="${url}" alt="Recap ${esc(p.label)}">`;
  const dl = $('#rcDownload', el);
  dl.href = url;
  const file = new File([blob], `soundstats-${key}.png`, { type: 'image/png' });
  const share = $('#rcShare', el);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    share.disabled = false;
    share.onclick = () => navigator.share({ files: [file], title: `SoundStats · ${p.label}` }).catch(() => {});
  } else {
    share.hidden = true;
    dl.classList.add('primary');
  }
}

/* ---------- Disegno dell'immagine ---------- */

const RC_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const rcFont = (w, s) => `${w} ${s}px ${RC_FONT}`;

async function rcImage(kind, name, sub) {
  try {
    const v = await Images.get(kind, name, sub);
    if (!v) return null;
    const res = await fetch(v.l, { mode: 'cors' });
    return await createImageBitmap(await res.blob());
  } catch (e) {
    return null;
  }
}

function rcFit(g, text, maxW) {
  text = String(text);
  if (g.measureText(text).width <= maxW) return text;
  while (text.length > 1 && g.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text.trimEnd() + '…';
}

function rcCover(g, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function rcRound(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

async function drawRecap(p, o, prevMs) {
  const W = 1080, H = 1920, L = 80;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const green = '#1db954';

  const topA = o.topArtists[0];
  const [artistImg, ...trackImgs] = await Promise.all([
    topA ? rcImage('artists', topA.name, '') : null,
    ...o.topTracks.slice(0, 5).map(t => rcImage('tracks', t.name, t.sub)),
  ]);

  // Sfondo: foto dell'artista n.1 sfumata nel nero, con un bagliore verde.
  g.fillStyle = '#0e0e0e';
  g.fillRect(0, 0, W, H);
  if (artistImg) {
    g.globalAlpha = 0.55;
    rcCover(g, artistImg, 0, 0, W, 1200);
    g.globalAlpha = 1;
  }
  let grd = g.createLinearGradient(0, 0, 0, 1260);
  grd.addColorStop(0, 'rgba(14,14,14,0.25)');
  grd.addColorStop(0.6, 'rgba(14,14,14,0.85)');
  grd.addColorStop(1, '#0e0e0e');
  g.fillStyle = grd; g.fillRect(0, 0, W, 1260);
  grd = g.createRadialGradient(W, H, 0, W, H, 900);
  grd.addColorStop(0, 'rgba(29,185,84,0.28)'); grd.addColorStop(1, 'rgba(29,185,84,0)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);

  g.textBaseline = 'alphabetic';

  // Marchio e titolo.
  g.fillStyle = green;
  g.beginPath(); g.arc(L + 22, 118, 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0e0e0e';
  [[-10, 8], [-2, 14], [6, 10], [14, 6]].forEach(([dx, h]) => g.fillRect(L + 22 + dx - 3, 118 - h / 2 + 2, 5, h));
  g.fillStyle = '#fff'; g.font = rcFont(800, 40);
  g.fillText('SoundStats', L + 60, 132);

  g.fillStyle = green; g.font = rcFont(800, 34);
  g.fillText(p.kindLabel.toUpperCase(), L, 260);
  g.fillStyle = '#fff'; g.font = rcFont(900, 84);
  g.fillText(rcFit(g, p.label, W - 2 * L), L, 352);

  // Numero grande.
  const hours = fmtHours(o.totalMs);
  g.font = rcFont(900, 220); g.fillStyle = green;
  g.fillText(hours, L - 8, 600);
  const hw = g.measureText(hours).width;
  g.font = rcFont(800, 64); g.fillStyle = '#fff';
  g.fillText('ore', L + hw + 8, 600);
  g.font = rcFont(500, 38); g.fillStyle = 'rgba(255,255,255,0.78)';
  g.fillText(`${fmtMin(o.totalMs)} minuti · ${plays(o.plays)}`, L, 668);
  if (prevMs > 0) {
    const pct = Math.round(((o.totalMs - prevMs) / prevMs) * 100);
    g.font = rcFont(700, 36);
    g.fillStyle = pct >= 0 ? green : '#f15e6c';
    const head = `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%`;
    g.fillText(head, L, 730);
    const w = g.measureText(head + ' ').width;
    g.font = rcFont(500, 36); g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(p.vs, L + w, 730);
  }

  // Mini grafico: giorni (settimana/mese) o mesi (anno).
  const series = o.byDay && p.kind !== 'y'
    ? o.byDay.map(d => ({ v: d.ms, l: p.kind === 'w' ? GIORNI_BREVI[(new Date(d.year || 2000, d.month, d.day).getDay() + 6) % 7] : (d.day % 5 === 1 ? String(d.day) : '') }))
    : o.byMonth.values.map((v, i) => ({ v, l: MESI_BREVI[((o.byMonth.start + i) % 12 + 12) % 12].charAt(0).toUpperCase() }));
  if (series.length) {
    const cx = L, cy = 790, cw = W - 2 * L, ch = 150;
    const max = Math.max(...series.map(s => s.v)) || 1;
    const bw = cw / series.length, gap = Math.min(10, bw * 0.25);
    g.font = rcFont(600, 24); g.textAlign = 'center';
    series.forEach((s, i) => {
      const h = Math.max(4, (s.v / max) * ch);
      g.fillStyle = s.v === max ? green : 'rgba(29,185,84,0.55)';
      rcRound(g, cx + i * bw + gap / 2, cy + ch - h, bw - gap, h, Math.min(8, (bw - gap) / 2));
      g.fill();
      if (s.l) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillText(s.l, cx + i * bw + bw / 2, cy + ch + 34); }
    });
    g.textAlign = 'left';
  }

  // Artista del periodo.
  if (topA) {
    const y = 1030, size = 220;
    g.save();
    g.beginPath(); g.arc(L + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); g.clip();
    if (artistImg) rcCover(g, artistImg, L, y, size, size); else { g.fillStyle = '#2e2e2e'; g.fillRect(L, y, size, size); }
    g.restore();
    const tx = L + size + 40, tw = W - tx - L;
    g.fillStyle = green; g.font = rcFont(800, 28);
    g.fillText('ARTISTA DEL PERIODO', tx, y + 70);
    g.fillStyle = '#fff'; g.font = rcFont(900, 64);
    g.fillText(rcFit(g, topA.name, tw), tx, y + 145);
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = rcFont(600, 36);
    g.fillText(`${fmtHours(topA.ms)} ore · ${plays(topA.plays)}`, tx, y + 200);
  }

  // Classifiche: artisti a sinistra, brani a destra.
  const top = 1340, colW = 430, rx = L + colW + 60;
  g.fillStyle = green; g.font = rcFont(800, 32);
  g.fillText('TOP ARTISTI', L, top);
  g.fillText('TOP BRANI', rx, top);
  o.topArtists.slice(0, 5).forEach((a, i) => {
    const y = top + 70 + i * 92;
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = rcFont(800, 34);
    g.fillText(String(i + 1), L, y);
    g.fillStyle = '#fff'; g.font = rcFont(800, 36);
    g.fillText(rcFit(g, a.name, colW - 56), L + 50, y);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = rcFont(500, 26);
    g.fillText(fmtHours(a.ms) + ' ore', L + 50, y + 34);
  });
  o.topTracks.slice(0, 5).forEach((t, i) => {
    const y = top + 70 + i * 92, img = trackImgs[i], s = 72, tx = rx + s + 20, tw = W - L - tx;
    g.save(); rcRound(g, rx, y - 46, s, s, 10); g.clip();
    if (img) rcCover(g, img, rx, y - 46, s, s); else { g.fillStyle = '#2e2e2e'; g.fillRect(rx, y - 46, s, s); }
    g.restore();
    g.fillStyle = '#fff'; g.font = rcFont(800, 32);
    g.fillText(rcFit(g, t.name, tw), tx, y - 6);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = rcFont(500, 26);
    g.fillText(rcFit(g, t.sub, tw), tx, y + 26);
  });

  // Piè di pagina.
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(L, 1838, W - 2 * L, 2);
  g.fillStyle = 'rgba(255,255,255,0.65)'; g.font = rcFont(600, 28);
  g.fillText(`${nf.format(o.uTracks)} brani · ${nf.format(o.uArtists)} artisti · ${nf.format(o.discovered)} nuovi`, L, 1882);
  g.textAlign = 'right'; g.fillStyle = green; g.font = rcFont(800, 28);
  g.fillText('SoundStats', W - L, 1882);
  g.textAlign = 'left';
  return c;
}
