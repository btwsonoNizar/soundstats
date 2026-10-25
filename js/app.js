'use strict';
/* SoundStats – interfaccia utente */

/* ------------------------------------------------------------------ */
/* Utilità                                                             */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('it-IT');
const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtMin = ms => nf.format(Math.round(ms / 60000));
const fmtHours = ms => nf1.format(ms / 3600000);
const plays = n => nf.format(n) + (n === 1 ? ' ascolto' : ' ascolti');
const dateFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = sec => dateFmt.format(new Date(sec * 1000));

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const GIORNI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
const GIORNI_BREVI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const monYear = m => 2000 + Math.floor(m / 12);
const monName = m => MESI[((m % 12) + 12) % 12] + ' ' + monYear(m);

const KINDS = {
  tracks: { one: 'Brano', tab: 'tracks' },
  artists: { one: 'Artista', tab: 'artists' },
  albums: { one: 'Album', tab: 'albums' },
  shows: { one: 'Podcast', tab: 'podcasts' },
  episodes: { one: 'Episodio', tab: 'podcasts' },
};
const TITLES = {
  overview: 'Panoramica', tracks: 'Top brani', artists: 'Top artisti', albums: 'Top album',
  podcasts: 'Podcast', profile: 'Profilo', welcome: 'Benvenuto', landing: 'SoundStats',
};

function load(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* memoria piena o privata */ }
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 4000);
}

function busy(text) {
  $('#busy').hidden = text == null;
  if (text != null) $('#busyText').textContent = text;
}

/* ------------------------------------------------------------------ */
/* Comunicazione con il worker                                         */
/* ------------------------------------------------------------------ */

const worker = new Worker('js/worker.js');
const pending = new Map();
let seq = 0;
worker.onmessage = e => {
  const m = e.data;
  if (m.type === 'progress') { busy(m.text); return; }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
};
function call(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...payload, id, type });
  });
}

/* ------------------------------------------------------------------ */
/* Stato e filtri                                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_FILTER = { mode: 'all', year: null, month: null, from: '', to: '', minSec: 0, noSkip: false };
const S = {
  meta: null,
  filter: { ...DEFAULT_FILTER, ...load('ss-filter', {}) },
  topN: load('ss-topn', 50),
  podView: load('ss-podview', 'shows'),
  group: load('ss-group', 'month'),
  query: {},
};

const isoDate = sec => {
  const d = new Date(sec * 1000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

// Converte il filtro scelto in un intervallo di secondi per il worker.
function wf() {
  const F = S.filter;
  let from = null, to = null;
  if (F.mode === 'year' && F.year) {
    from = new Date(F.year, 0, 1) / 1000; to = new Date(F.year + 1, 0, 1) / 1000;
  } else if (F.mode === 'month' && F.month != null) {
    const y = monYear(F.month), m = F.month - (y - 2000) * 12;
    from = new Date(y, m, 1) / 1000; to = new Date(y, m + 1, 1) / 1000;
  } else if (F.mode === 'custom') {
    if (F.from) from = new Date(F.from + 'T00:00') / 1000;
    if (F.to) { const d = new Date(F.to + 'T00:00'); d.setDate(d.getDate() + 1); to = d / 1000; }
  }
  return { from, to, minMs: F.minSec * 1000, noSkip: !!F.noSkip && !!(S.meta && S.meta.hasSkip) };
}

function periodLabel() {
  const F = S.filter;
  if (F.mode === 'year' && F.year) return String(F.year);
  if (F.mode === 'month' && F.month != null) return monName(F.month);
  if (F.mode === 'custom' && (F.from || F.to)) {
    const f = s => s.split('-').reverse().join('/');
    return (F.from ? f(F.from) : 'inizio') + ' – ' + (F.to ? f(F.to) : 'oggi');
  }
  return 'Da sempre';
}

function filterChipLabel() {
  const extra = [];
  if (S.filter.minSec) extra.push('≥' + S.filter.minSec + 's');
  if (S.filter.noSkip && S.meta && S.meta.hasSkip) extra.push('no skip');
  return periodLabel() + (extra.length ? ' · ' + extra.join(' · ') : '');
}

// Se i dati cambiano, il filtro salvato potrebbe non essere più valido.
function sanitizeFilter() {
  const m = S.meta;
  if (!m || !m.n) return;
  if (S.filter.mode === 'year' && !m.years.includes(S.filter.year)) S.filter.year = m.years[m.years.length - 1];
  if (S.filter.mode === 'month' && !m.months.includes(S.filter.month)) S.filter.month = m.months[m.months.length - 1];
}

/* ------------------------------------------------------------------ */
/* Componenti HTML                                                     */
/* ------------------------------------------------------------------ */

function rowHtml(kind, r, maxMs) {
  const pct = maxMs ? Math.max(1.5, (r.ms / maxMs) * 100) : 0;
  return `<a class="row" href="#/detail/${kind}/${r.id}">
    <span class="rank">${r.rank}</span>
    <span class="main">
      <span class="name">${esc(r.name)}</span>
      ${r.sub ? `<span class="sub">${esc(r.sub)}</span>` : ''}
      <span class="meter"><i style="width:${pct.toFixed(1)}%"></i></span>
    </span>
    <span class="nums"><b>${fmtMin(r.ms)} min</b><small>${fmtHours(r.ms)} h · ${plays(r.plays)}</small></span>
  </a>`;
}

const tile = (label, value, sub = '') =>
  `<div class="tile"><span class="tile-label">${label}</span><span class="tile-value">${value}</span>${sub ? `<span class="tile-sub">${sub}</span>` : ''}</div>`;

function seg(id, options, value) {
  return `<div class="seg" id="${id}" role="tablist">${options.map(([v, l]) =>
    `<button type="button" data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

function onSeg(root, id, fn) {
  const el = $('#' + id, root);
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    fn(b.dataset.v);
  });
}

const minutesFmt = v => `${nf.format(Math.round(v))} min <small>(${nf1.format(v / 60)} h)</small>`;

function monthItems(byMonth) {
  const n = byMonth.values.length;
  const many = n > 14;
  const yearsSpan = n / 12;
  return byMonth.values.map((ms, i) => {
    const m = byMonth.start + i, mi = ((m % 12) + 12) % 12, y = monYear(m);
    let lab = '';
    if (!many) lab = MESI_BREVI[mi];
    else if (mi === 0 && (yearsSpan <= 8 || y % 2 === 0)) lab = String(y);
    return { value: ms / 60000, label: lab, tip: monName(m) };
  });
}

function yearItems(byMonth) {
  const map = new Map();
  byMonth.values.forEach((ms, i) => { const y = monYear(byMonth.start + i); map.set(y, (map.get(y) || 0) + ms); });
  const years = [...map.keys()];
  return years.map(y => ({ value: map.get(y) / 60000, label: years.length > 10 ? `'${String(y).slice(2)}` : String(y), tip: String(y) }));
}

const dayItems = byDay => byDay.map(d => ({
  value: d.ms / 60000,
  label: d.day === 1 || (byDay.length <= 35 && d.day % 7 === 1) ? `${d.day} ${MESI_BREVI[d.month]}` : '',
  tip: `${d.day} ${MESI_BREVI[d.month]}`,
}));
const hourItems =byHour => byHour.map((ms, h) => ({ value: ms / 60000, label: h % 6 === 0 ? String(h) : '', tip: `${h}:00 – ${h}:59` }));
const dowItems = byDow => byDow.map((ms, d) => ({ value: ms / 60000, label: GIORNI_BREVI[d], tip: GIORNI[d] }));

const emptyPeriod = () => `<div class="empty"><p>Nessun ascolto in questo periodo.</p><button class="btn" data-open-filter>Cambia filtro</button></div>`;

/* ------------------------------------------------------------------ */
/* Viste                                                               */
/* ------------------------------------------------------------------ */

async function viewOverview(el, alive) {
  const o = await call('overview', { flt: wf() });
  if (!alive()) return;
  if (!o.plays) { el.innerHTML = emptyPeriod(); return; }

  const peakH = o.byHour.indexOf(Math.max(...o.byHour));
  const peakD = o.byDow.indexOf(Math.max(...o.byDow));

  el.innerHTML = `
    <section class="hero">
      <span class="hero-label">Tempo di ascolto · ${esc(periodLabel())}</span>
      <span class="hero-num">${fmtHours(o.totalMs)}<small> ore</small></span>
      <span class="hero-sub">${fmtMin(o.totalMs)} minuti · ${plays(o.plays)} · ${fmtMin(o.perDayMs)} min al giorno</span>
    </section>
    <section class="tiles">
      ${tile('Musica', fmtHours(o.musicMs) + ' h', fmtMin(o.musicMs) + ' min')}
      ${tile('Podcast', fmtHours(o.podMs) + ' h', fmtMin(o.podMs) + ' min')}
      ${tile('Brani unici', nf.format(o.uTracks))}
      ${tile('Artisti unici', nf.format(o.uArtists))}
      ${tile('Album unici', nf.format(o.uAlbums))}
      ${tile('Programmi podcast', nf.format(o.uShows), nf.format(o.uEpisodes) + ' episodi')}
    </section>
    <section class="card">
      <div class="card-head"><h2>Minuti ascoltati</h2>${o.byDay ? '' : seg('grp', [['month', 'Mese'], ['year', 'Anno']], S.group)}</div>
      ${o.byDay ? '<p class="hint">Giorno per giorno</p>' : ''}
      <div id="chMonths"></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Orari</h2></div>
      <p class="hint">Ascolti di più tra le ${peakH}:00 e le ${(peakH + 1) % 24}:00</p>
      <div id="chHours"></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Giorni della settimana</h2></div>
      <p class="hint">Il giorno in cui ascolti di più è il ${GIORNI[peakD]}</p>
      <div id="chDays"></div>
    </section>
    <section class="card list-card">
      <div class="card-head"><h2>Top artisti</h2><a class="more" href="#/artists">Vedi tutti</a></div>
      ${o.topArtists.map(r => rowHtml('artists', r, o.topArtists[0].ms)).join('') || '<p class="hint">Nessun artista.</p>'}
    </section>
    <section class="card list-card">
      <div class="card-head"><h2>Top brani</h2><a class="more" href="#/tracks">Vedi tutti</a></div>
      ${o.topTracks.map(r => rowHtml('tracks', r, o.topTracks[0].ms)).join('') || '<p class="hint">Nessun brano.</p>'}
    </section>`;

  const drawMonths = () => barChart($('#chMonths', el),
    o.byDay ? dayItems(o.byDay) : S.group === 'year' ? yearItems(o.byMonth) : monthItems(o.byMonth),
    { fmt: minutesFmt, title: 'Minuti ascoltati' });
  drawMonths();
  if (!o.byDay) onSeg(el, 'grp', v => { S.group = v; save('ss-group', v); drawMonths(); });
  barChart($('#chHours', el), hourItems(o.byHour), { fmt: minutesFmt, height: 140, title: 'Minuti per ora' });
  barChart($('#chDays', el), dowItems(o.byDow), { fmt: minutesFmt, height: 140, title: 'Minuti per giorno' });
}

async function viewList(el, alive, kind, extraHead = '') {
  const q = S.query[kind] || '';
  el.innerHTML = `
    ${extraHead}
    <div class="toolbar">
      <label class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.8 4.8-1.4 1.4-4.8-4.8A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>
        <input type="search" id="q" placeholder="Cerca nella classifica" value="${esc(q)}" autocomplete="off" enterkeyhint="search">
      </label>
      ${seg('topn', [[10, 'Top 10'], [50, '50'], [100, '100']], S.topN)}
    </div>
    <p class="count" id="count"></p>
    <div id="list" class="list"></div>`;

  let token = 0;
  const refresh = async () => {
    const my = ++token;
    const r = await call('top', { flt: wf(), kind, n: S.topN, q: S.query[kind] || '' });
    if (my !== token || !alive()) return;
    const listEl = $('#list', el);
    if (!r.total) { listEl.innerHTML = emptyPeriod(); $('#count', el).textContent = ''; return; }
    $('#count', el).textContent = (S.query[kind] ? `${nf.format(r.matched)} risultati su ${nf.format(r.total)}` : `${nf.format(r.total)} in totale`) + ' · ' + periodLabel();
    listEl.innerHTML = r.rows.map(row => rowHtml(kind, row, r.maxMs)).join('') || '<p class="hint pad">Nessun risultato per questa ricerca.</p>';
  };

  let t;
  $('#q', el).addEventListener('input', e => {
    S.query[kind] = e.target.value;
    clearTimeout(t);
    t = setTimeout(refresh, 150);
  });
  onSeg(el, 'topn', v => { S.topN = +v; save('ss-topn', S.topN); refresh(); });
  await refresh();
}

async function viewPodcasts(el, alive) {
  const head = seg('podview', [['shows', 'Programmi'], ['episodes', 'Episodi']], S.podView).replace('class="seg"', 'class="seg wide"');
  await viewList(el, alive, S.podView, head);
  onSeg(el, 'podview', v => { S.podView = v; save('ss-podview', v); route(); });
}

async function viewDetail(el, alive, kind, id) {
  if (!KINDS[kind]) { location.hash = '#/overview'; return; }
  const d = await call('detail', { kind, itemId: id, flt: wf() });
  if (!alive()) return;
  $('#title').textContent = KINDS[kind].one;

  const links = [];
  if (d.sub) links.push(`<a class="dsub" href="#/detail/${d.subKind}/${d.subId}">${esc(d.sub)}</a>`);
  if (d.album) links.push(`<a class="dsub muted" href="#/detail/albums/${d.albumId}">${esc(d.album)}</a>`);

  el.innerHTML = `
    <section class="dhead">
      <span class="dkind">${KINDS[kind].one}</span>
      <h2 class="dname">${esc(d.name)}</h2>
      ${links.join('<span class="dot">·</span>')}
    </section>
    ${d.allPlays ? `
    <section class="tiles">
      ${tile(esc(periodLabel()), fmtMin(d.perMs) + ' min', `${fmtHours(d.perMs)} h · ${plays(d.perPlays)}`)}
      ${tile('Posizione', d.rank ? '#' + nf.format(d.rank) : '—', d.rank ? 'su ' + nf.format(d.rankOf) : 'nessun ascolto nel periodo')}
      ${S.filter.mode !== 'all' ? tile('Da sempre', fmtMin(d.allMs) + ' min', `${fmtHours(d.allMs)} h · ${plays(d.allPlays)}`) : ''}
      ${d.uniqueTracks != null ? tile(kind === 'shows' ? 'Episodi ascoltati' : 'Brani ascoltati', nf.format(d.uniqueTracks), 'nel periodo') : ''}
      ${tile('Primo ascolto', fmtDate(d.first))}
      ${tile('Ultimo ascolto', fmtDate(d.last))}
    </section>
    <section class="card">
      <div class="card-head"><h2>Andamento nel tempo</h2></div>
      <p class="hint">Minuti al mese, da sempre</p>
      <div id="chTrend"></div>
    </section>
    ${d.perPlays ? `<section class="card">
      <div class="card-head"><h2>Orari</h2></div>
      <p class="hint">${esc(periodLabel())}</p>
      <div id="chHours"></div>
    </section>` : ''}
    ${d.tracks && d.tracks.length ? `<section class="card list-card">
      <div class="card-head"><h2>${kind === 'shows' ? 'Episodi' : 'Brani'} più ascoltati</h2></div>
      <p class="hint">${esc(periodLabel())}</p>
      ${d.tracks.map(r => rowHtml(d.trackKind, r, d.tracks[0].ms)).join('')}
    </section>` : ''}` : '<div class="empty"><p>Nessun ascolto con i filtri attuali.</p></div>'}`;

  if (d.allPlays) {
    barChart($('#chTrend', el), monthItems(d.byMonth), { fmt: minutesFmt, title: 'Andamento' });
    if (d.perPlays) barChart($('#chHours', el), hourItems(d.byHour), { fmt: minutesFmt, height: 130, title: 'Orari' });
  }
}

function importButton(label = 'Importa file JSON o ZIP') {
  return `<button class="btn primary block" data-import>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v9.2l3.3-3.3 1.4 1.4L12 17l-5.7-5.7 1.4-1.4 3.3 3.3zM5 18h14v2H5z"/></svg>${label}</button>`;
}

const HOWTO = `
  <details class="howto">
    <summary>Come scarico i miei dati da Spotify?</summary>
    <ol>
      <li>Apri <b>spotify.com/account/privacy</b> dal browser e accedi.</li>
      <li>Nella sezione <b>Scarica i tuoi dati</b> spunta <b>Cronologia di streaming estesa</b> (la più completa) e/o <b>Dati dell'account</b>, poi richiedi i dati.</li>
      <li>Conferma l'email. Spotify ti manderà un link per scaricare uno <b>.zip</b> (da pochi giorni fino a 30).</li>
      <li>Scarica lo .zip sul telefono e importalo qui: puoi selezionare direttamente lo .zip oppure i singoli file .json.</li>
    </ol>
  </details>`;

/* ---------- Profilo Spotify ---------- */

function profile() { return load('ss-profile', null); }

async function refreshProfile() {
  try {
    const me = await Spotify.api('/me');
    const imgs = (me.images || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
    save('ss-profile', {
      name: me.display_name || me.id,
      image: (imgs.find(i => (i.width || 0) >= 64) || imgs[imgs.length - 1] || {}).url || '',
      url: (me.external_urls || {}).spotify || '',
    });
    renderAvatar();
  } catch (e) {
    if (e.expired) { toast('Sessione Spotify scaduta: accedi di nuovo.'); route(); }
  }
}

function avatarHtml(p, size) {
  if (p && p.image) return `<img src="${esc(p.image)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">`;
  return `<span>${esc(((p && p.name) || '?').trim().charAt(0).toUpperCase())}</span>`;
}

function renderAvatar() {
  $('#profileBtn').innerHTML = avatarHtml(profile(), 32);
}

/* ---------- Pagina di accesso ---------- */

const ICONS = {
  rank: '<path d="M4 13h4v7H4zm6-9h4v16h-4zm6 5h4v11h-4z"/>',
  clock: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm1 3v4.6l3.4 3.4-1.4 1.4-4-4V7z"/>',
  lock: '<path d="M12 2a5 5 0 0 1 5 5v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3zm0 9a2 2 0 0 0-1 3.7V18h2v-1.3A2 2 0 0 0 12 13z"/>',
  live: '<path d="M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM6.3 6.3l1.4 1.4a6 6 0 0 0 0 8.6l-1.4 1.4a8 8 0 0 1 0-11.4zm11.4 0a8 8 0 0 1 0 11.4l-1.4-1.4a6 6 0 0 0 0-8.6zM3.5 3.5l1.4 1.4a10 10 0 0 0 0 14.2l-1.4 1.4a12 12 0 0 1 0-17zm17 0a12 12 0 0 1 0 17l-1.4-1.4a10 10 0 0 0 0-14.2z"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function viewLanding(el) {
  const bars = [38, 52, 44, 70, 62, 84, 58, 76, 92, 66, 80, 100];
  el.innerHTML = `
    <div class="landing">
      <header class="l-nav">
        <span class="brand"><img src="icons/icon.svg" alt="" width="32" height="32">SoundStats</span>
      </header>

      <section class="l-hero">
        <div class="l-copy">
          <span class="eyebrow">Statistiche di ascolto per Spotify</span>
          <h1>Scopri quanto ascolti <em>davvero</em>.</h1>
          <p class="lead">Classifiche di brani, artisti, album e podcast basate sui minuti effettivamente ascoltati, calcolate dalla tua cronologia completa.</p>
          <button class="btn spotify" id="loginBtn" ${Spotify.configured ? '' : 'disabled'}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm4.6 14.4a.75.75 0 0 0-.25-1.03c-2.6-1.6-5.9-1.95-9.6-1.1a.75.75 0 1 0 .33 1.46c3.4-.78 6.3-.46 8.5.92.36.22.82.1 1.02-.25zm1.2-2.8a.94.94 0 0 0-.3-1.28c-3-1.85-7.4-2.37-10.9-1.3a.94.94 0 1 0 .55 1.79c3-.92 6.9-.47 9.4 1.08.44.27 1.02.14 1.29-.29zm.1-2.9c.32-.53.15-1.22-.38-1.54C14 7.1 8.6 6.9 5.4 7.9a1.12 1.12 0 1 0 .65 2.14c2.8-.85 7.6-.69 10.3 1.06.53.32 1.22.15 1.54-.4z"/></svg>
            Accedi con Spotify
          </button>
          <p class="fine">${Spotify.configured
            ? 'La password si inserisce solo sul sito di Spotify. SoundStats riceve unicamente il permesso di leggere le tue classifiche.'
            : 'Accesso non ancora configurato: inserisci il Client ID in <code>js/config.js</code>.'}</p>
        </div>
        <div class="l-preview" aria-hidden="true">
          <div class="pv-card">
            <span class="pv-label">Tempo di ascolto · 2025</span>
            <span class="pv-num">1.284<small> ore</small></span>
            <div class="pv-bars">${bars.map(h => `<i style="height:${h}%"></i>`).join('')}</div>
            <div class="pv-row"><b>1</b><span><em>Artista preferito</em><small>412 ore · 6.208 ascolti</small></span></div>
            <div class="pv-row"><b>2</b><span><em>Secondo artista</em><small>187 ore · 2.931 ascolti</small></span></div>
            <div class="pv-row"><b>3</b><span><em>Terzo artista</em><small>96 ore · 1.540 ascolti</small></span></div>
          </div>
        </div>
      </section>

      <section class="l-features">
        <article>${icon('clock')}<h3>Minuti, non solo ascolti</h3><p>Ogni classifica è ordinata per tempo realmente ascoltato, con ore, minuti e numero di riproduzioni.</p></article>
        <article>${icon('rank')}<h3>Tutta la tua storia</h3><p>Anni di cronologia, filtri per anno, mese o date, grafici, orari e giorni preferiti.</p></article>
        <article>${icon('live')}<h3>In tempo reale</h3><p>Le tue top di Spotify delle ultime settimane, mesi e dell'anno, e gli ultimi brani ascoltati.</p></article>
        <article>${icon('lock')}<h3>Privato per davvero</h3><p>I file vengono analizzati sul tuo dispositivo. Nessun server, nessun dato condiviso.</p></article>
      </section>

      <section class="l-steps">
        <h2>Come funziona</h2>
        <ol>
          <li><b>Accedi con Spotify</b><span>Un tocco, e l'accesso avviene sul sito ufficiale di Spotify.</span></li>
          <li><b>Importa i tuoi dati</b><span>Carica lo .zip ricevuto da Spotify dopo aver richiesto i tuoi dati.</span></li>
          <li><b>Esplora</b><span>Classifiche, grafici e dettagli per ogni artista, brano, album e podcast.</span></li>
        </ol>
      </section>

      <footer class="l-foot">
        <p>SoundStats è un progetto indipendente e non è affiliato né approvato da Spotify AB. Spotify è un marchio registrato di Spotify AB.</p>
      </footer>
    </div>`;
  const btn = $('#loginBtn', el);
  btn.addEventListener('click', () => {
    btn.disabled = true;
    Spotify.login().catch(e => { btn.disabled = false; alert('Impossibile avviare l\'accesso: ' + e.message); });
  });
}

function viewWelcome(el) {
  const p = profile();
  el.innerHTML = `
    <div class="welcome">
      <div class="welcome-avatar">${avatarHtml(p, 88)}</div>
      <h2>${p ? 'Ciao, ' + esc(p.name.split(' ')[0]) + '!' : 'Benvenuto!'}</h2>
      <p>Ultimo passo: importa i file che hai scaricato da Spotify per scoprire quanto tempo hai passato ad ascoltare ogni brano, artista, album e podcast.</p>
      ${importButton()}
      <p class="note">I file vengono analizzati su questo dispositivo e non vengono inviati a nessuno.</p>
      ${HOWTO}
      <a class="more" href="#/profile">Intanto guarda le tue top in tempo reale →</a>
    </div>`;
}

/* ---------- Dati in tempo reale da Spotify ---------- */

const live = { range: load('ss-live-range', 'short_term'), type: load('ss-live-type', 'tracks'), cache: new Map() };
const RANGES = [['short_term', '4 settimane'], ['medium_term', '6 mesi'], ['long_term', '12 mesi']];
const relTime = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });
function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'adesso';
  if (s < 3600) return relTime.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return relTime.format(-Math.round(s / 3600), 'hour');
  return relTime.format(-Math.round(s / 86400), 'day');
}
const smallImage = imgs => {
  const list = (imgs || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
  return (list.find(i => (i.width || 0) >= 60) || list[list.length - 1] || {}).url || '';
};
const thumb = (url, round) => url
  ? `<img class="thumb${round ? ' round' : ''}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
  : `<span class="thumb${round ? ' round' : ''}"></span>`;

function liveRow(rank, img, round, name, sub, right, url) {
  return `<a class="row live" href="${esc(url || '#')}" target="_blank" rel="noopener">
    ${rank != null ? `<span class="rank">${rank}</span>` : ''}
    ${thumb(img, round)}
    <span class="main"><span class="name">${esc(name)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span>
    ${right ? `<span class="nums"><small>${esc(right)}</small></span>` : ''}
  </a>`;
}

async function cachedApi(path) {
  if (!live.cache.has(path)) live.cache.set(path, Spotify.api(path).catch(e => { live.cache.delete(path); throw e; }));
  return live.cache.get(path);
}

async function drawLiveTop(box) {
  box.innerHTML = '<div class="loading small"><div class="spinner"></div></div>';
  try {
    const data = await cachedApi(`/me/top/${live.type}?time_range=${live.range}&limit=50`);
    const items = data.items || [];
    if (!items.length) { box.innerHTML = '<p class="hint pad">Spotify non ha ancora abbastanza ascolti per questo periodo.</p>'; return; }
    box.innerHTML = items.map((it, i) => live.type === 'tracks'
      ? liveRow(i + 1, smallImage(it.album && it.album.images), false, it.name,
        (it.artists || []).map(a => a.name).join(', '), '', (it.external_urls || {}).spotify)
      : liveRow(i + 1, smallImage(it.images), true, it.name,
        (it.genres || []).slice(0, 2).join(', '), '', (it.external_urls || {}).spotify)).join('');
  } catch (e) {
    box.innerHTML = `<p class="hint pad">${esc(liveError(e))}</p>`;
  }
}

async function drawRecent(box) {
  box.innerHTML = '<div class="loading small"><div class="spinner"></div></div>';
  try {
    const data = await cachedApi('/me/player/recently-played?limit=50');
    const items = data.items || [];
    if (!items.length) { box.innerHTML = '<p class="hint pad">Nessun ascolto recente.</p>'; return; }
    box.innerHTML = items.map(it => {
      const t = it.track || {};
      return liveRow(null, smallImage(t.album && t.album.images), false, t.name,
        (t.artists || []).map(a => a.name).join(', '), ago(it.played_at), (t.external_urls || {}).spotify);
    }).join('');
  } catch (e) {
    box.innerHTML = `<p class="hint pad">${esc(liveError(e))}</p>`;
  }
}

function liveError(e) {
  if (e.expired) { setTimeout(route, 1500); return 'Sessione scaduta: accedi di nuovo.'; }
  if (!navigator.onLine) return 'Sei offline: i dati in tempo reale richiedono la connessione.';
  return e.message;
}

/* ---------- Profilo e impostazioni ---------- */

function viewProfile(el) {
  const m = S.meta, p = profile();
  el.innerHTML = `
    <section class="profile-head">
      <div class="profile-avatar">${avatarHtml(p, 72)}</div>
      <div class="profile-info">
        <span class="dkind">Account Spotify</span>
        <h2>${esc(p ? p.name : 'Il tuo profilo')}</h2>
        ${p && p.url ? `<a class="more" href="${esc(p.url)}" target="_blank" rel="noopener">Apri su Spotify ↗</a>` : ''}
      </div>
      <button class="btn small" id="logoutBtn">Esci</button>
    </section>

    <section class="card list-card">
      <div class="card-head"><h2>Le tue top su Spotify</h2><span class="badge">Live</span></div>
      ${seg('liveType', [['tracks', 'Brani'], ['artists', 'Artisti']], live.type).replace('class="seg"', 'class="seg wide"')}
      ${seg('liveRange', RANGES, live.range).replace('class="seg"', 'class="seg wide"')}
      <div id="liveTop" class="list"></div>
    </section>

    <section class="card list-card">
      <div class="card-head"><h2>Ascoltati di recente</h2><span class="badge">Live</span></div>
      <div id="recent" class="list"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>I tuoi dati</h2></div>
      <p class="hint">Puoi importare più file insieme o uno .zip. Gli ascolti già presenti vengono riconosciuti e non sono contati due volte.</p>
      ${importButton(m.n ? 'Aggiungi altri file' : 'Importa file JSON o ZIP')}
      ${m.n ? `
      <dl class="facts">
        <dt>Ascolti</dt><dd>${nf.format(m.n)}</dd>
        <dt>Dal</dt><dd>${fmtDate(m.first)}</dd>
        <dt>Al</dt><dd>${fmtDate(m.last)}</dd>
        <dt>Informazioni sugli skip</dt><dd>${m.hasSkip ? 'presenti' : 'assenti (solo cronologia estesa)'}</dd>
        <dt>Aggiornato</dt><dd>${new Date(m.updated).toLocaleString('it-IT')}</dd>
      </dl>
      <details class="files"><summary>${m.files.length} file importati</summary><ul>${m.files.map(f => `<li>${esc(f)}</li>`).join('')}</ul></details>
      <button class="btn danger block" id="clearBtn">Cancella i dati importati</button>` : ''}
      ${HOWTO}
    </section>

    <section class="card">
      <div class="card-head"><h2>Privacy</h2></div>
      <p class="hint">I file importati vengono letti e salvati solo su questo dispositivo. L'accesso a Spotify serve a mostrare le tue top e gli ascolti recenti: SoundStats legge questi dati direttamente da Spotify e non li invia ad altri.</p>
      <p class="hint">I minuti sono quelli effettivamente ascoltati (campo <i>ms_played</i>), non la durata dei brani. Ore e giorni usano il fuso orario del dispositivo.</p>
      <p class="hint small">SoundStats non è affiliato né approvato da Spotify AB.</p>
    </section>`;

  const topBox = $('#liveTop', el);
  drawLiveTop(topBox);
  drawRecent($('#recent', el));
  onSeg(el, 'liveType', v => { live.type = v; save('ss-live-type', v); drawLiveTop(topBox); });
  onSeg(el, 'liveRange', v => { live.range = v; save('ss-live-range', v); drawLiveTop(topBox); });

  $('#logoutBtn', el).addEventListener('click', () => {
    if (!confirm('Vuoi uscire dal tuo account Spotify? I dati importati restano su questo dispositivo.')) return;
    Spotify.logout();
    live.cache.clear();
    location.hash = '#/overview';
    route();
  });

  const clear = $('#clearBtn', el);
  if (clear) clear.addEventListener('click', async () => {
    if (!confirm('Vuoi cancellare tutti gli ascolti importati da questo dispositivo?')) return;
    await call('clear');
    S.meta = await call('meta');
    toast('Dati cancellati');
    location.hash = '#/overview';
    route();
  });
}

/* ------------------------------------------------------------------ */
/* Pannello filtri                                                     */
/* ------------------------------------------------------------------ */

function openFilters() {
  const m = S.meta;
  if (!m || !m.n) return;
  const F = { ...S.filter };
  if (F.year == null) F.year = m.years[m.years.length - 1];
  if (F.month == null) F.month = m.months[m.months.length - 1];
  if (!F.from) F.from = isoDate(m.first);
  if (!F.to) F.to = isoDate(m.last);

  const sheet = $('#sheet');
  sheet.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <div class="sheet-panel" role="dialog" aria-label="Filtri">
      <div class="grab"></div>
      <h3>Filtri</h3>
      <span class="lbl">Periodo</span>
      ${seg('fMode', [['all', 'Sempre'], ['year', 'Anno'], ['month', 'Mese'], ['custom', 'Date']], F.mode).replace('class="seg"', 'class="seg wide"')}
      <div class="field" data-for="year">
        <select id="fYear">${m.years.slice().reverse().map(y => `<option value="${y}" ${y === F.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      <div class="field" data-for="month">
        <select id="fMonth">${m.months.slice().reverse().map(x => `<option value="${x}" ${x === F.month ? 'selected' : ''}>${monName(x)}</option>`).join('')}</select>
      </div>
      <div class="field two" data-for="custom">
        <label>Dal<input type="date" id="fFrom" value="${F.from}"></label>
        <label>Al<input type="date" id="fTo" value="${F.to}"></label>
      </div>
      <span class="lbl">Escludi ascolti più brevi di</span>
      ${seg('fMin', [[0, 'Nessuno'], [10, '10 s'], [30, '30 s'], [60, '60 s']], F.minSec).replace('class="seg"', 'class="seg wide"')}
      <label class="switch ${m.hasSkip ? '' : 'disabled'}">
        <span><b>Escludi gli skip</b><small>${m.hasSkip ? 'Ignora i brani che hai saltato' : 'Disponibile solo con la cronologia estesa'}</small></span>
        <input type="checkbox" id="fSkip" ${F.noSkip && m.hasSkip ? 'checked' : ''} ${m.hasSkip ? '' : 'disabled'}>
      </label>
      <div class="sheet-actions">
        <button class="btn" id="fReset">Azzera</button>
        <button class="btn primary" id="fApply">Applica</button>
      </div>
    </div>`;

  const sync = () => sheet.querySelectorAll('[data-for]').forEach(x => { x.hidden = x.dataset.for !== F.mode; });
  sync();
  onSeg(sheet, 'fMode', v => { F.mode = v; sync(); });
  onSeg(sheet, 'fMin', v => { F.minSec = +v; });
  $('#fYear', sheet).onchange = e => { F.year = +e.target.value; };
  $('#fMonth', sheet).onchange = e => { F.month = +e.target.value; };
  $('#fFrom', sheet).onchange = e => { F.from = e.target.value; };
  $('#fTo', sheet).onchange = e => { F.to = e.target.value; };
  $('#fSkip', sheet).onchange = e => { F.noSkip = e.target.checked; };
  $('#fReset', sheet).onclick = () => apply({ ...DEFAULT_FILTER });
  $('#fApply', sheet).onclick = () => apply(F);

  function apply(next) {
    if (next.mode === 'custom' && next.from && next.to && next.from > next.to) [next.from, next.to] = [next.to, next.from];
    S.filter = next;
    save('ss-filter', next);
    closeFilters();
    route();
  }
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
}

function closeFilters() {
  const sheet = $('#sheet');
  sheet.classList.remove('open');
  setTimeout(() => { sheet.hidden = true; sheet.innerHTML = ''; }, 200);
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

async function doImport(files) {
  if (!files || !files.length) return;
  busy('Preparazione…');
  try {
    const r = await call('import', { files: [...files] });
    S.meta = await call('meta');
    sanitizeFilter();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    let msg = `Importati ${nf.format(r.added)} ascolti da ${r.files} file`;
    if (r.dups) msg += ` (${nf.format(r.dups)} doppi ignorati)`;
    if (r.ignored.length) msg += `. File non riconosciuti: ${r.ignored.length}`;
    if (!r.saved) msg += '. Attenzione: non è stato possibile salvarli in memoria.';
    toast(msg);
    if (location.hash === '#/overview') route(); else location.hash = '#/overview';
  } catch (e) {
    alert('Importazione non riuscita:\n' + e.message);
  } finally {
    busy(null);
  }
}

/* ------------------------------------------------------------------ */
/* Navigazione                                                         */
/* ------------------------------------------------------------------ */

let renderId = 0;
let lastTab = 'overview';

async function route() {
  const my = ++renderId;
  const alive = () => my === renderId;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  let view = parts[0] || 'overview';
  if (!TITLES[view] && view !== 'detail') view = 'overview';

  if (!S.meta) { S.meta = await call('meta'); sanitizeFilter(); }
  const hasData = S.meta.n > 0;
  if (!Spotify.loggedIn) view = 'landing';
  else if (!hasData && view !== 'profile') view = 'welcome';

  document.body.classList.toggle('is-landing', view === 'landing');
  const tab = view === 'detail' ? (KINDS[parts[1]] || {}).tab || lastTab : view;
  if (TITLES[tab] && view !== 'detail' && view !== 'profile') lastTab = tab;
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  $('.tabs').hidden = !hasData || view === 'landing';
  $('#title').textContent = TITLES[view] || '';
  $('#backBtn').hidden = !(view === 'detail' || (view === 'profile' && !hasData));
  $('#filterBtn').hidden = !hasData || view === 'profile';
  $('#filterBtn span').textContent = filterChipLabel();
  $('#profileBtn').classList.toggle('on', view === 'profile');
  renderAvatar();

  const el = $('#view');
  const loader = setTimeout(() => { if (alive()) el.innerHTML = '<div class="loading"><div class="spinner"></div></div>'; }, 120);
  try {
    switch (view) {
      case 'landing': viewLanding(el); break;
      case 'welcome': viewWelcome(el); break;
      case 'profile': viewProfile(el); break;
      case 'overview': await viewOverview(el, alive); break;
      case 'podcasts': await viewPodcasts(el, alive); break;
      case 'detail': await viewDetail(el, alive, parts[1], parseInt(parts[2], 10)); break;
      default: await viewList(el, alive, view);
    }
  } catch (e) {
    if (alive()) el.innerHTML = `<div class="empty"><p>Si è verificato un errore:<br>${esc(e.message)}</p></div>`;
  } finally {
    clearTimeout(loader);
  }
  if (alive() && route.lastHash !== location.hash) window.scrollTo(0, 0);
  route.lastHash = location.hash;
}

window.addEventListener('hashchange', route);

document.addEventListener('click', e => {
  if (e.target.closest('[data-import]')) $('#fileInput').click();
  else if (e.target.closest('[data-open-filter]')) openFilters();
  else if (e.target.closest('[data-close]')) closeFilters();
});
$('#filterBtn').addEventListener('click', openFilters);
$('#profileBtn').addEventListener('click', () => { location.hash = '#/profile'; });
$('#backBtn').addEventListener('click', () => {
  if (history.length > 1 && route.navigated) history.back();
  else location.hash = '#/' + lastTab;
});
window.addEventListener('hashchange', () => { route.navigated = true; }, { once: true });
$('#fileInput').addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  doImport(files);
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Avvio: se torniamo da Spotify completa l'accesso, poi mostra la pagina giusta.
(async () => {
  try {
    if (await Spotify.handleRedirect()) {
      await refreshProfile();
      const p = profile();
      toast(p ? `Ciao ${p.name.split(' ')[0]}, accesso eseguito` : 'Accesso eseguito');
    } else if (Spotify.loggedIn && navigator.onLine) {
      refreshProfile();
    }
  } catch (e) {
    alert('Accesso a Spotify non riuscito:\n' + e.message);
  }
  route();
})();
