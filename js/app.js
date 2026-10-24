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
  podcasts: 'Podcast', settings: 'Impostazioni', welcome: 'SoundStats',
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

function viewWelcome(el) {
  el.innerHTML = `
    <div class="welcome">
      <img src="icons/icon.svg" alt="" width="88" height="88">
      <h2>Le tue statistiche di ascolto</h2>
      <p>Importa i file che hai scaricato da Spotify per scoprire quanto tempo hai passato ad ascoltare ogni brano, artista, album e podcast.</p>
      ${importButton()}
      <p class="note">I dati restano solo su questo telefono: nessun server, nessun login.</p>
      ${HOWTO}
    </div>`;
}

function viewSettings(el) {
  const m = S.meta;
  el.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Importa</h2></div>
      <p class="hint">Puoi importare più file insieme o uno .zip. I file già importati vengono riconosciuti: gli ascolti doppi non vengono contati due volte.</p>
      ${importButton(m.n ? 'Aggiungi altri file' : 'Importa file JSON o ZIP')}
      ${HOWTO}
    </section>
    ${m.n ? `
    <section class="card">
      <div class="card-head"><h2>Dati sul dispositivo</h2></div>
      <dl class="facts">
        <dt>Ascolti</dt><dd>${nf.format(m.n)}</dd>
        <dt>Dal</dt><dd>${fmtDate(m.first)}</dd>
        <dt>Al</dt><dd>${fmtDate(m.last)}</dd>
        <dt>Informazioni sugli skip</dt><dd>${m.hasSkip ? 'presenti' : 'assenti (solo cronologia estesa)'}</dd>
        <dt>Aggiornato</dt><dd>${new Date(m.updated).toLocaleString('it-IT')}</dd>
      </dl>
      <details class="files"><summary>${m.files.length} file importati</summary><ul>${m.files.map(f => `<li>${esc(f)}</li>`).join('')}</ul></details>
      <button class="btn danger block" id="clearBtn">Cancella tutti i dati</button>
    </section>` : ''}
    <section class="card">
      <div class="card-head"><h2>Informazioni</h2></div>
      <p class="hint">SoundStats funziona anche senza connessione. I file vengono letti sul telefono e salvati nella memoria locale dell'app; nulla viene inviato in rete.</p>
      <p class="hint">I minuti sono quelli effettivamente ascoltati (campo <i>ms_played</i>), non la durata dei brani. Le ore e i giorni usano il fuso orario del telefono.</p>
    </section>`;

  const clear = $('#clearBtn', el);
  if (clear) clear.addEventListener('click', async () => {
    if (!confirm('Vuoi cancellare tutti gli ascolti importati da questo telefono?')) return;
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
  if (!hasData && view !== 'settings') view = 'welcome';

  const tab = view === 'detail' ? (KINDS[parts[1]] || {}).tab || lastTab : view;
  if (TITLES[tab] && view !== 'detail') lastTab = tab;
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  $('.tabs').hidden = !hasData;
  $('#title').textContent = TITLES[view] || '';
  $('#backBtn').hidden = !(view === 'detail' || (view === 'settings' && hasData));
  $('#filterBtn').hidden = !hasData || view === 'settings';
  $('#filterBtn span').textContent = filterChipLabel();
  $('#settingsBtn').hidden = view === 'settings';

  const el = $('#view');
  const loader = setTimeout(() => { if (alive()) el.innerHTML = '<div class="loading"><div class="spinner"></div></div>'; }, 120);
  try {
    switch (view) {
      case 'welcome': viewWelcome(el); break;
      case 'settings': viewSettings(el); break;
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
$('#settingsBtn').addEventListener('click', () => { location.hash = '#/settings'; });
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

route();
