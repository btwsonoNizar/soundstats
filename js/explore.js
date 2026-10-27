'use strict';
/*
 * Sezione "Esplora": ricordi, record, confronti, fissazioni, generi,
 * playlist su Spotify, backup e la storia animata dell'anno.
 * Usa le funzioni dell'interfaccia definite in app.js.
 */

const XICONS = {
  memories: '<path d="M12 2a10 10 0 1 1-9.4 13.4l1.9-.7A8 8 0 1 0 4.3 9H7v2H1V5h2v2.6A10 10 0 0 1 12 2zm1 5v4.6l3.4 3.4-1.4 1.4-4-4V7z"/>',
  records: '<path d="M7 2h10v2h4v4a5 5 0 0 1-5 5h-.3A5 5 0 0 1 13 15.9V19h4v2H7v-2h4v-3.1A5 5 0 0 1 8.3 13H8a5 5 0 0 1-5-5V4h4zm0 4H5v2a3 3 0 0 0 2 2.8zm12 0h-2v4.8A3 3 0 0 0 19 8z"/>',
  compare: '<path d="M4 20V10h4v10zm6 0V4h4v16zm6 0v-7h4v7z"/>',
  obsessions: '<path d="M12 21.4 10.6 20C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1A6 6 0 0 1 16.5 3C19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.5z"/>',
  genres: '<path d="M12 3a9 9 0 0 1 0 18 1.5 1.5 0 0 1-1.1-2.5c.4-.5.4-1.2 0-1.6a1.5 1.5 0 0 1 1.1-2.5h1.8A5.2 5.2 0 0 0 19 9.2C19 5.8 15.9 3 12 3zM6.5 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm3-4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm3 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>',
  story: '<path d="M8 5.1v13.8L19 12z"/>',
  today: '<path d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm12 8H5v9h14zm-7 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>',
  recap: '<path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v10l3.5-3.5 3 3 4-4L19 14V5zm4 1.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>',
  playlist: '<path d="M3 5h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm13 0V5h5v2h-3v8.5a2.5 2.5 0 1 1-2-2.5z"/>',
};
const xicon = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${XICONS[n]}</svg>`;
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
const fullDate = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtDur = sec => { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
const baseFilter = () => ({ from: null, to: null, minMs: S.filter.minSec * 1000, noSkip: !!S.filter.noSkip && !!(S.meta && S.meta.hasSkip) });
const lastDataDate = () => new Date(Math.max(S.meta.last, S.meta.lastLive || 0) * 1000);

/* ------------------------------------------------------------------ */
/* Hub                                                                 */
/* ------------------------------------------------------------------ */

const EXPLORE = [
  ['today', '#/today', 'Oggi', 'La timeline degli ascolti di oggi'],
  ['memories', '#/memories', 'Un anno fa oggi', 'Cosa ascoltavi in questo giorno negli anni passati'],
  ['records', '#/records', 'Record', 'Giorno record, serie, sessione più lunga'],
  ['compare', '#/compare', 'Confronta', 'Periodi e anni a confronto'],
  ['obsessions', '#/obsessions', 'Fissazioni', 'Brani e artisti consumati e poi abbandonati'],
  ['genres', '#/genres', 'Generi', 'I tuoi generi e come cambiano'],
  ['story', '#/story', 'Il tuo anno', 'La storia animata del tuo anno in musica'],
  ['recap', '#/recap', 'Recap', 'Immagini di settimane, mesi e anni'],
];

function exploreGrid(keys) {
  return `<div class="x-grid">${EXPLORE.filter(e => !keys || keys.includes(e[0])).map(([k, href, title, desc]) =>
    `<a class="x-card x-${k}" href="${href}">${xicon(k)}<b>${title}</b><small>${desc}</small></a>`).join('')}</div>`;
}

function viewExplore(el) {
  el.innerHTML = `<p class="hint">Altri modi per guardare i tuoi ascolti.</p>${exploreGrid()}`;
}

/* ------------------------------------------------------------------ */
/* 1. Un anno fa oggi                                                  */
/* ------------------------------------------------------------------ */

async function memoriesCardHtml() {
  const list = await call('memories', baseFilter());
  if (!list.length) return '';
  const m = list[0], t = m.tracks[0];
  return `<a class="mem-card" href="#/memories">
    ${pic('tracks', t.name, t.sub, 'cover-m')}
    <span class="mem-info">
      <span class="np-label">${xicon('memories')}${m.years === 1 ? 'Un anno fa oggi' : m.years + ' anni fa oggi'}</span>
      <b>${esc(t.name)}</b><span>${esc(t.sub)} · ${plays(t.plays)}</span>
      <small>${fmtMin(m.ms)} minuti quel giorno${list.length > 1 ? ` · altri ${list.length - 1} anni` : ''}</small>
    </span>
  </a>`;
}

async function viewMemories(el, alive) {
  const list = await call('memories', baseFilter());
  if (!alive()) return;
  if (!list.length) {
    el.innerHTML = '<div class="empty"><p>Nessun ascolto in questo giorno negli anni passati.</p><p class="hint">Con la cronologia estesa di Spotify trovi i ricordi di tutti gli anni.</p></div>';
    return;
  }
  el.innerHTML = list.map(m => {
    const d = new Date(m.date * 1000);
    return `<section class="card list-card">
      <div class="card-head"><h2>${m.years === 1 ? 'Un anno fa' : m.years + ' anni fa'}</h2><a class="more" href="#/today/${dayKeyOf(d)}">Vedi la giornata</a></div>
      <p class="hint">${capFirst(fullDate.format(d))} · ${fmtMin(m.ms)} min · ${plays(m.plays)}</p>
      ${m.artists[0] ? `<a class="mem-artist" href="#/detail/artists/${m.artists[0].id}">${pic('artists', m.artists[0].name, '', 'mini')}<span><small>Artista del giorno</small><b>${esc(m.artists[0].name)}</b></span></a>` : ''}
      ${m.tracks.map(r => rowHtml('tracks', r, m.tracks[0].ms)).join('')}
    </section>`;
  }).join('');
}

/* ------------------------------------------------------------------ */
/* 2. Record                                                           */
/* ------------------------------------------------------------------ */

function recordCard(icn, label, value, sub, href) {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="rec-card"${href ? ` href="${href}"` : ''}>
    <span class="rec-icon">${xicon(icn)}</span>
    <span class="rec-label">${label}</span>
    <span class="rec-value">${value}</span>
    ${sub ? `<span class="rec-sub">${sub}</span>` : ''}
  </${tag}>`;
}

async function viewRecords(el, alive) {
  const r = await call('records', { flt: wf() });
  if (!alive()) return;
  if (!r.total) { el.innerHTML = emptyPeriod(); return; }
  const dd = s => fmtDate(s);
  const night = Math.round(r.nightShare * 100);
  el.innerHTML = `
    <p class="hint">${esc(periodLabel())}</p>
    <div class="rec-grid">
      ${r.bestDay ? recordCard('records', 'Giorno record', fmtMin(r.bestDay.ms) + ' min', capFirst(fullDate.format(new Date(r.bestDay.date * 1000))), `#/today/${dayKeyOf(new Date(r.bestDay.date * 1000))}`) : ''}
      ${r.streak ? recordCard('today', 'Serie più lunga', r.streak.len + (r.streak.len === 1 ? ' giorno' : ' giorni'), `dal ${dd(r.streak.from)} al ${dd(r.streak.to)}`) : ''}
      ${recordCard('today', 'Serie attuale', r.current + (r.current === 1 ? ' giorno' : ' giorni'), r.current ? 'di fila con almeno un ascolto' : 'riparti oggi!')}
      ${r.session ? recordCard('story', 'Sessione più lunga', fmtDur(r.session.end - r.session.start), `${plays(r.session.plays)} · ${dd(r.session.start)}`) : ''}
      ${r.repeat ? recordCard('obsessions', 'Brano in loop', r.repeat.count + ' volte', `<b>${esc(r.repeat.name)}</b> in un giorno · ${dd(r.repeat.date)}`, `#/detail/tracks/${r.repeat.id}`) : ''}
      ${r.artistDay ? recordCard('memories', 'Maratona di un artista', fmtMin(r.artistDay.ms) + ' min', `<b>${esc(r.artistDay.name)}</b> · ${dd(r.artistDay.date)}`, `#/detail/artists/${r.artistDay.id}`) : ''}
      ${recordCard('compare', 'Giorni con ascolti', nf.format(r.activeDays), `su ${nf.format(r.spanDays)} giorni (${Math.round((r.activeDays / Math.max(1, r.spanDays)) * 100)}%)`)}
      ${recordCard('genres', 'Ascolti notturni', night + '%', night >= 20 ? 'tra mezzanotte e le 5: sei un nottambulo' : 'tra mezzanotte e le 5 del mattino')}
    </div>
    ${r.since.length ? `<section class="card list-card">
      <div class="card-head"><h2>Da quando li ascolti</h2></div>
      ${r.since.map(a => `<a class="row with-pic" href="#/detail/artists/${a.id}">
        <span class="rank">${a.rank}</span>${pic('artists', a.name, '', 'thumb')}
        <span class="main"><span class="name">${esc(a.name)}</span><span class="sub">Primo ascolto: ${fmtDate(a.first)}</span></span>
        <span class="nums"><b>${sinceText(a.first)}</b><small>${fmtHours(a.ms)} h</small></span></a>`).join('')}
    </section>` : ''}`;
}

function sinceText(sec) {
  const days = (Date.now() / 1000 - sec) / 86400;
  if (days < 60) return Math.max(1, Math.round(days)) + ' giorni';
  if (days < 730) return Math.round(days / 30.4) + ' mesi';
  return nf1.format(days / 365.25) + ' anni';
}

/* ------------------------------------------------------------------ */
/* 3. Confronto tra periodi                                            */
/* ------------------------------------------------------------------ */

function comparePresets() {
  const ref = lastDataDate();
  const endDay = new Date(ref); endDay.setHours(0, 0, 0, 0); endDay.setDate(endDay.getDate() + 1);
  const daysAgo = (d, n) => { const x = new Date(d); x.setDate(x.getDate() - n); return x; };
  const y = ref.getFullYear(), m = ref.getMonth();
  const short = d => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const ytdEndPrev = new Date(endDay); ytdEndPrev.setFullYear(y - 1);
  return {
    '30': { a: [daysAgo(endDay, 30), endDay], b: [daysAgo(endDay, 60), daysAgo(endDay, 30)], la: 'Ultimi 30 giorni', lb: '30 giorni prima' },
    month: { a: [new Date(y, m - 1, 1), new Date(y, m, 1)], b: [new Date(y, m - 2, 1), new Date(y, m - 1, 1)], la: monName((y - 2000) * 12 + m - 1), lb: monName((y - 2000) * 12 + m - 2) },
    ytd: { a: [new Date(y, 0, 1), endDay], b: [new Date(y - 1, 0, 1), ytdEndPrev], la: `${y} fino al ${short(ref)}`, lb: `${y - 1} stesso periodo` },
    year: { a: [new Date(y - 1, 0, 1), new Date(y, 0, 1)], b: [new Date(y - 2, 0, 1), new Date(y - 1, 0, 1)], la: String(y - 1), lb: String(y - 2) },
    years: yearsPreset(ref),
  };
}

// Due anni a scelta. "Stesso periodo": entrambi solo fino al giorno dell'ultimo ascolto.
function yearsPreset(ref) {
  const years = S.meta.years;
  const A = years.includes(S.cmpA) ? S.cmpA : years[years.length - 1];
  const B = years.includes(S.cmpB) && S.cmpB !== A ? S.cmpB : (years.filter(y => y !== A).pop() || A);
  const same = S.cmpSame !== false && (A === ref.getFullYear() || B === ref.getFullYear());
  const cut = y => same ? new Date(y, ref.getMonth(), ref.getDate() + 1) : new Date(y + 1, 0, 1);
  const short = ref.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  return {
    A, B, same,
    a: [new Date(A, 0, 1), cut(A)], b: [new Date(B, 0, 1), cut(B)],
    la: same ? `${A} fino al ${short}` : String(A), lb: same ? `${B} fino al ${short}` : String(B),
    cutoff: same ? [ref.getMonth(), ref.getDate()] : null,
  };
}

// Tabella "anno per anno" con un grafico delle ore.
async function yearsTableHtml(cutoff) {
  const list = await call('yearsSummary', { minMs: S.filter.minSec * 1000, noSkip: !!S.filter.noSkip && !!S.meta.hasSkip, cutoff });
  if (list.length < 2) return '';
  const max = Math.max(...list.map(y => y.ms));
  return `<section class="card list-card">
    <div class="card-head"><h2>Anno per anno</h2></div>
    ${cutoff ? '<p class="hint">Ogni anno fino allo stesso giorno, per un confronto alla pari</p>' : ''}
    <div class="yt">${list.slice().reverse().map((y, i, arr) => {
      const prev = arr[i + 1];
      return `<div class="yt-row">
        <b class="yt-year">${y.year}</b>
        <span class="yt-bar"><i style="width:${Math.max(3, (y.ms / max) * 100).toFixed(1)}%"></i><em>${fmtHours(y.ms)} h</em></span>
        <span class="yt-delta">${prev ? delta(y.ms, prev.ms) : ''}</span>
        ${y.artist ? `<a class="yt-top" href="#/detail/artists/${y.artist.id}">${pic('artists', y.artist.name, '', 'mini')}<span><small>Artista n.1</small>${esc(y.artist.name)}</span></a>` : '<span></span>'}
        ${y.track ? `<a class="yt-top" href="#/detail/tracks/${y.track.id}">${pic('tracks', y.track.name, y.track.sub, 'mini')}<span><small>Canzone n.1</small>${esc(y.track.name)}</span></a>` : '<span></span>'}
      </div>`;
    }).join('')}</div>
  </section>`;
}

function delta(a, b) {
  if (!b) return a ? '<span class="dl up">nuovo</span>' : '';
  const p = Math.round(((a - b) / b) * 100);
  return `<span class="dl ${p > 0 ? 'up' : p < 0 ? 'down' : ''}">${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${Math.abs(p)}%</span>`;
}

function moveHtml(r) {
  if (!r.prevRank) return '<span class="mv new">NUOVO</span>';
  const d = r.prevRank - r.rank;
  if (!d) return '<span class="mv">=</span>';
  return `<span class="mv ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`;
}

async function viewCompare(el, alive) {
  const presetKey = S.cmpPreset || '30', kind = S.cmpKind || 'artists';
  const p = comparePresets()[presetKey];
  const f = range => ({ from: range[0] / 1000, to: range[1] / 1000, minMs: S.filter.minSec * 1000, noSkip: !!S.filter.noSkip && !!S.meta.hasSkip });
  const [r, yearsTable] = await Promise.all([
    call('compare', { a: f(p.a), b: f(p.b), kind }),
    presetKey === 'years' ? yearsTableHtml(p.cutoff) : '',
  ]);
  if (!alive()) return;
  const A = r.A, B = r.B;
  const years = S.meta.years.slice().reverse();
  const yearSelect = (id, val) => `<select id="${id}">${years.map(y => `<option value="${y}" ${y === val ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
  el.innerHTML = `
    ${seg('cmpPreset', [['30', '30 giorni'], ['month', 'Mese'], ['ytd', 'Anno'], ['years', 'Anni']], presetKey).replace('class="seg"', 'class="seg wide"')}
    ${presetKey === 'years' ? `
    <div class="cmp-years">${yearSelect('cmpA', p.A)}<span class="vs">vs</span>${yearSelect('cmpB', p.B)}</div>
    ${p.A === lastDataDate().getFullYear() || p.B === lastDataDate().getFullYear() ? `<label class="switch">
      <span><b>Stesso periodo</b><small>Confronta entrambi gli anni solo fino al ${lastDataDate().toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}</small></span>
      <input type="checkbox" id="cmpSame" ${p.same ? 'checked' : ''}></label>` : ''}` : ''}
    <div class="cmp-head"><span><small>Periodo</small><b>${esc(p.la)}</b></span><span class="vs">vs</span><span><small>Confronto</small><b>${esc(p.lb)}</b></span></div>
    <section class="tiles">
      ${tile('Tempo di ascolto', fmtHours(A.ms) + ' h', `${delta(A.ms, B.ms)} · prima ${fmtHours(B.ms)} h`)}
      ${tile('Ascolti', nf.format(A.plays), `${delta(A.plays, B.plays)} · prima ${nf.format(B.plays)}`)}
      ${tile('Brani diversi', nf.format(A.uTracks), `${delta(A.uTracks, B.uTracks)} · prima ${nf.format(B.uTracks)}`)}
      ${tile('Artisti diversi', nf.format(A.uArtists), `${delta(A.uArtists, B.uArtists)} · prima ${nf.format(B.uArtists)}`)}
    </section>
    ${seg('cmpKind', [['artists', 'Artisti'], ['tracks', 'Brani'], ['albums', 'Album']], kind).replace('class="seg"', 'class="seg wide"')}
    <section class="card list-card">
      <div class="card-head"><h2>Classifica e movimenti</h2></div>
      ${r.rows.length ? r.rows.map(row => `<a class="row with-pic cmp-row" href="#/detail/${kind}/${row.id}">
        <span class="rank">${row.rank}</span>${pic(kind, row.name, row.sub, 'thumb')}
        <span class="main"><span class="name">${esc(row.name)}</span>${row.sub ? `<span class="sub">${esc(row.sub)}</span>` : ''}</span>
        <span class="nums"><b>${fmtHours(row.ms)} h</b>${moveHtml(row)}</span></a>`).join('') : '<p class="hint pad">Nessun ascolto nel periodo.</p>'}
    </section>
    ${r.dropped.length ? `<section class="card list-card">
      <div class="card-head"><h2>Usciti dalla top 50</h2></div>
      ${r.dropped.map(row => `<a class="row with-pic" href="#/detail/${kind}/${row.id}">
        <span class="rank">${row.prevRank}</span>${pic(kind, row.name, row.sub, 'thumb')}
        <span class="main"><span class="name">${esc(row.name)}</span><span class="sub">prima: #${row.prevRank} · ${fmtHours(row.prevMs)} h</span></span>
        <span class="nums"><b>${fmtHours(row.ms)} h</b><small>ora</small></span></a>`).join('')}
    </section>` : ''}
    ${yearsTable}`;
  if (presetKey === 'years') {
    $('#cmpA', el).onchange = e => { S.cmpA = +e.target.value; route(); };
    $('#cmpB', el).onchange = e => { S.cmpB = +e.target.value; route(); };
    const same = $('#cmpSame', el);
    if (same) same.onchange = e => { S.cmpSame = e.target.checked; route(); };
  }
  onSeg(el, 'cmpPreset', v => { S.cmpPreset = v; route(); });
  onSeg(el, 'cmpKind', v => { S.cmpKind = v; route(); });
}

/* ------------------------------------------------------------------ */
/* 4. Fissazioni                                                       */
/* ------------------------------------------------------------------ */

async function viewObsessions(el, alive) {
  const kind = S.obsKind || 'tracks';
  const r = await call('obsessions', { flt: wf(), kind });
  if (!alive()) return;
  const status = { 'abbandonato': 'gone', 'in corso': 'now', 'ancora presente': 'still' };
  el.innerHTML = `
    <p class="hint">Quello che hai ascoltato tantissimo in due settimane. "Abbandonato" vuol dire che dopo non l'hai quasi più ascoltato.</p>
    ${seg('obsKind', [['tracks', 'Brani'], ['artists', 'Artisti']], kind).replace('class="seg"', 'class="seg wide"')}
    <div class="list">${r.items.length ? r.items.map(it => {
      const from = new Date(it.peakFrom * 1000);
      return `<a class="row with-pic obs-row" href="#/detail/${kind}/${it.id}">
        <span class="rank">${it.peak}</span>${pic(kind, it.name, it.sub, 'thumb')}
        <span class="main"><span class="name">${esc(it.name)}</span>
          <span class="sub">${it.peak} ascolti in 2 settimane · dal ${fmtDate(from / 1000)}</span>
          <span class="meter"><i style="width:${Math.round(it.share * 100)}%"></i></span></span>
        <span class="nums"><span class="chip ${status[it.status]}">${it.status}</span><small>${Math.round(it.share * 100)}% di tutti gli ascolti</small></span></a>`;
    }).join('') : '<p class="hint pad">Nessuna fissazione trovata in questo periodo.</p>'}</div>`;
  onSeg(el, 'obsKind', v => { S.obsKind = v; route(); });
}

/* ------------------------------------------------------------------ */
/* 5. Backup                                                           */
/* ------------------------------------------------------------------ */

async function exportBackup() {
  busy('Preparo il backup…');
  try {
    const data = await call('exportData');
    const stream = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'));
    const blob = await new Response(stream).blob();
    const name = `soundstats-backup-${dayKeyOf(new Date())}.soundstats`;
    const file = new File([blob], name, { type: 'application/octet-stream' });
    busy(null);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Backup SoundStats' }).catch(() => {});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    }
    toast(`Backup pronto: ${nf.format(data.t.length)} ascolti (${nf1.format(blob.size / 1048576)} MB)`);
  } catch (e) {
    busy(null);
    alert('Backup non riuscito:\n' + e.message);
  }
}

/* ------------------------------------------------------------------ */
/* 6. Playlist su Spotify                                              */
/* ------------------------------------------------------------------ */

function showDialog(html) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-backdrop" data-close></div><div class="sheet-panel"><div class="grab"></div>${html}</div>`;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
}

async function createPlaylist(title, description, rows) {
  if (!Spotify.hasScope('playlist-modify-private')) {
    if (confirm('Per creare playlist serve un nuovo permesso di Spotify. Vuoi riaccedere ora?')) Spotify.login();
    return;
  }
  rows = rows.filter(r => r && r.name).slice(0, 100);
  if (!rows.length) { toast('Nessun brano da aggiungere'); return; }
  let done = 0;
  busy(`Cerco i brani su Spotify…\n0 di ${rows.length}`);
  try {
    const uris = await Promise.all(rows.map(r => Images.get('uri', r.name, r.artist).then(v => {
      done++; busy(`Cerco i brani su Spotify…\n${done} di ${rows.length}`);
      return v && v.u;
    })));
    const list = [...new Set(uris.filter(Boolean))];
    if (!list.length) throw new Error('Nessun brano trovato su Spotify.');
    busy('Creo la playlist…');
    const pl = await Spotify.post('/me/playlists', { name: title, description, public: false });
    for (let i = 0; i < list.length; i += 100) await Spotify.post(`/playlists/${pl.id}/items`, { uris: list.slice(i, i + 100) });
    busy(null);
    showDialog(`<div class="pl-done">${xicon('playlist')}<h3>Playlist creata</h3>
      <p class="hint"><b>${esc(title)}</b><br>${list.length} brani${list.length < rows.length ? ` (${rows.length - list.length} non trovati)` : ''}, privata.</p>
      <a class="btn primary block" href="${esc((pl.external_urls || {}).spotify || 'https://open.spotify.com')}" target="_blank" rel="noopener">Apri in Spotify</a>
      <button class="btn block" data-close>Chiudi</button></div>`);
  } catch (e) {
    busy(null);
    alert('Playlist non creata:\n' + e.message);
  }
}

const playlistButton = (attr = 'data-playlist') => `<button class="btn small pl-btn" ${attr}>${xicon('playlist')}Crea playlist</button>`;

async function playlistFromTop(flt, n, title) {
  const r = await call('top', { flt, kind: 'tracks', n, q: '' });
  await createPlaylist(title, `Creata con SoundStats: i tuoi ${r.rows.length} brani più ascoltati.`, r.rows.map(x => ({ name: x.name, artist: x.sub })));
}

/* ------------------------------------------------------------------ */
/* 7. Generi                                                           */
/* ------------------------------------------------------------------ */

const GENRE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
const GENRE_OTHER = '#5a5a5a';

async function genreData(flt, n, onProgress) {
  const top = await call('top', { flt, kind: 'artists', n, q: '' });
  let done = 0;
  const infos = await Promise.all(top.rows.map(r => Images.get('artists', r.name, '', { genres: true }).then(v => {
    done++; if (onProgress) onProgress(done, top.rows.length);
    return v && v.g ? v.g : [];
  })));
  const genres = new Map(), artistGenres = new Map();
  top.rows.forEach((r, i) => {
    const g = infos[i];
    if (!g.length) return;
    artistGenres.set(r.id, g);
    for (const name of g) {
      const e = genres.get(name) || { name, ms: 0, artists: [] };
      e.ms += r.ms / g.length;
      e.artists.push(r);
      genres.set(name, e);
    }
  });
  const list = [...genres.values()].sort((a, b) => b.ms - a.ms);
  const total = list.reduce((s, g) => s + g.ms, 0);
  return { list, total, artistGenres, rows: top.rows };
}

async function viewGenres(el, alive) {
  el.innerHTML = `<div class="loading small"><div class="spinner"></div><p class="hint" id="gProg">Raccolgo i generi da Spotify…</p></div>`;
  const flt = wf();
  const g = await genreData(flt, 60, (d, t) => { const p = $('#gProg', el); if (p) p.textContent = `Raccolgo i generi da Spotify… ${d} di ${t}`; });
  if (!alive()) return;
  if (!g.list.length) {
    el.innerHTML = `<div class="empty"><p>Spotify non ha fornito generi per i tuoi artisti.</p><p class="hint">Spotify assegna i generi solo a una parte degli artisti; per alcuni account non sono disponibili.</p></div>`;
    return;
  }
  const max = g.list[0].ms;
  el.innerHTML = `
    <p class="hint">${esc(periodLabel())} · basato sui tuoi ${g.rows.length} artisti più ascoltati</p>
    <section class="card">
      <div class="card-head"><h2>I tuoi generi</h2></div>
      <div class="genre-list">${g.list.slice(0, 15).map((x, i) => `<div class="genre-row">
        <span class="rank">${i + 1}</span>
        <span class="main"><span class="name">${esc(capFirst(x.name))}</span>
          <span class="sub">${x.artists.slice(0, 3).map(a => esc(a.name)).join(', ')}</span>
          <span class="meter"><i style="width:${Math.max(2, (x.ms / max) * 100).toFixed(1)}%"></i></span></span>
        <span class="nums"><b>${Math.round((x.ms / g.total) * 100)}%</b><small>${fmtHours(x.ms)} h</small></span>
      </div>`).join('')}</div>
    </section>
    <section class="card" id="gEvo"><div class="card-head"><h2>Come cambiano nel tempo</h2></div><div class="loading small"><div class="spinner"></div></div></section>`;

  // Evoluzione per anno dei 5 generi principali (stessi artisti, tutti gli anni).
  const ids = [...g.artistGenres.keys()];
  const yrs = await call('artistYears', { ids, flt: baseFilter() });
  if (!alive()) return;
  const top5 = g.list.slice(0, 5).map(x => x.name);
  const rowsY = yrs.years.map((y, yi) => {
    const shares = new Array(6).fill(0);
    ids.forEach((id, j) => {
      const v = yrs.ms[j][yi]; if (!v) return;
      const gs = g.artistGenres.get(id);
      gs.forEach(name => { const k = top5.indexOf(name); shares[k >= 0 ? k : 5] += v / gs.length; });
    });
    const tot = shares.reduce((s, v) => s + v, 0);
    return { y, tot, shares: shares.map(v => (tot ? v / tot : 0)) };
  }).filter(r => r.tot > 0);
  const evo = $('#gEvo', el);
  if (rowsY.length < 2) { evo.remove(); return; }
  evo.innerHTML = `<div class="card-head"><h2>Come cambiano nel tempo</h2></div>
    <p class="hint">Quota di ogni genere per anno</p>
    <div class="legend">${top5.map((n, i) => `<span><i style="background:${GENRE_COLORS[i]}"></i>${esc(capFirst(n))}</span>`).join('')}<span><i style="background:${GENRE_OTHER}"></i>Altri</span></div>
    <div class="stack-rows">${rowsY.map(r => `<div class="stack-row"><span>${r.y}</span><div class="stack">${r.shares.map((s, i) => s > 0.004
      ? `<i style="width:${(s * 100).toFixed(2)}%;background:${i < 5 ? GENRE_COLORS[i] : GENRE_OTHER}" title="${esc(i < 5 ? capFirst(top5[i]) : 'Altri')}: ${Math.round(s * 100)}%"></i>` : '').join('')}</div></div>`).join('')}</div>
    <p class="hint small" id="stackCap">Tocca una barra per vedere la percentuale.</p>`;
  evo.querySelector('.stack-rows').addEventListener('click', e => {
    const seg = e.target.closest('i[title]');
    if (seg) $('#stackCap', el).textContent = seg.closest('.stack-row').firstElementChild.textContent + ' · ' + seg.title;
  });
}

/* ------------------------------------------------------------------ */
/* 8. Storia animata dell'anno                                         */
/* ------------------------------------------------------------------ */

function personality(byHour, nightShare) {
  if (nightShare >= 0.2) return ['Nottambulo', 'La musica ti tiene compagnia anche a notte fonda.'];
  const peak = byHour.indexOf(Math.max(...byHour));
  if (peak < 11) return ['Mattiniero', `Il tuo momento è la mattina, verso le ${peak}:00.`];
  if (peak < 17) return ['Pomeridiano', `Dai il meglio nel pomeriggio, verso le ${peak}:00.`];
  return ['Serale', `La sera è tutta tua: il picco è verso le ${peak}:00.`];
}

function countUp(el, to, dur = 1400) {
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = nf.format(Math.round(to * e));
    if (k < 1 && document.contains(el)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let storyState = null;

// Slide "quest'anno contro l'anno prima".
function versusSlide(year, o, prevO, running) {
  const max = Math.max(o.totalMs, prevO.totalMs);
  const pa = prevO.topArtists[0], na = o.topArtists[0];
  const prevTop = new Set(prevO.topArtists.slice(0, 5).map(a => a.id));
  const newcomers = o.topArtists.slice(0, 5).filter(a => !prevTop.has(a.id));
  const bar = (label, ms, cls) => `<div class="vs-row ${cls}"><span>${label}</span>
    <span class="vs-bar"><i data-grow="${Math.max(4, (ms / max) * 100).toFixed(1)}%"></i></span><b>${fmtHours(ms)} h</b></div>`;
  return `<div class="st st-versus"><span class="st-kicker">${year} contro ${year - 1}${running ? ' · stesso periodo' : ''}</span>
    <h2>${o.totalMs >= prevO.totalMs ? 'Più musica che mai' : 'Un anno più tranquillo'}</h2>
    <div class="vs-bars">${bar(String(year - 1), prevO.totalMs, 'old')}${bar(String(year), o.totalMs, 'new')}</div>
    ${pa && na ? `<div class="vs-swap">
      <span>${pic('artists', pa.name, '', 'st-thumb')}<small>${year - 1}</small><b>${esc(pa.name)}</b></span>
      <em>→</em>
      <span>${pic('artists', na.name, '', 'st-thumb')}<small>${year}</small><b>${esc(na.name)}</b></span></div>
    <p class="st-small">${pa.id === na.id ? `<b>${esc(na.name)}</b> resta il tuo numero uno.` : `Il tuo numero uno è cambiato.`}
      ${newcomers.length ? ` Nuovi nella tua top 5: <b>${newcomers.map(a => esc(a.name)).join(', ')}</b>.` : ''}</p>` : ''}</div>`;
}

// Strato decorativo di ogni slide: sfumature in movimento, grana, equalizzatore
// e un effetto diverso a seconda della slide.
function storyDeco(slide) {
  const rnd = (a, b) => (a + Math.random() * (b - a)).toFixed(2);
  let h = '<div class="st-deco" aria-hidden="true"><i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i><span class="grain"></span>';
  h += '<div class="st-eq">' + Array.from({ length: 28 }, () => `<s style="--d:${rnd(0.5, 1.4)}s;--o:${rnd(-1.4, 0)}s"></s>`).join('') + '</div>';
  if (/st-(intro|outro)/.test(slide)) {
    const colors = ['#1ed760', '#ffd23f', '#ff5fa2', '#4dd8ff', '#ffffff', '#b28dff'];
    h += Array.from({ length: 46 }, (_, i) => `<b class="confetti" style="--x:${rnd(0, 100)}%;--dl:${rnd(0, 1.6)}s;--dr:${rnd(2.6, 4.8)}s;--r:${rnd(-540, 540)}deg;--c:${colors[i % colors.length]};--w:${rnd(6, 11)}px"></b>`).join('');
  }
  if (/st-minutes|st-track/.test(slide)) {
    h += Array.from({ length: 12 }, (_, i) => `<b class="note" style="--x:${rnd(5, 95)}%;--dl:${rnd(0, 4)}s;--dr:${rnd(4, 7)}s;--s:${rnd(18, 34)}px">${i % 2 ? '♪' : '♫'}</b>`).join('');
  }
  if (/st-persona night/.test(slide)) {
    h += Array.from({ length: 50 }, () => `<b class="star" style="--x:${rnd(0, 100)}%;--y:${rnd(0, 70)}%;--dl:${rnd(0, 3)}s;--s:${rnd(1, 3)}px"></b>`).join('') + '<b class="moon"></b>';
  } else if (/st-persona/.test(slide)) {
    h += '<b class="sun"></b>';
  }
  if (/st-records|st-genre/.test(slide)) h += '<b class="rays"></b>';
  return h + '</div>';
}

async function viewStory(el, alive, yearArg) {
  const years = S.meta.years;
  const year = +(yearArg || (new Date().getMonth() < 1 ? new Date().getFullYear() - 1 : years[years.length - 1]));
  if (!yearArg && years.length > 1) {
    // Scelta dell'anno
    el.innerHTML = `<p class="hint">Scegli l'anno da rivivere.</p><div class="x-grid">${years.slice().reverse().map(y =>
      `<a class="x-card x-story" href="#/story/${y}">${xicon('story')}<b>${y}</b><small>${y === new Date().getFullYear() ? 'Finora' : 'Il tuo anno in musica'}</small></a>`).join('')}</div>`;
    return;
  }
  const p = periodOf('y-' + year);
  const flt = recapFilter(p, p.from, p.to);
  // L'anno prima, per il confronto (se l'anno è in corso: fino allo stesso giorno).
  const now = new Date();
  const prevTo = year === now.getFullYear() ? new Date(year - 1, now.getMonth(), now.getDate() + 1) : p.from;
  const prevFlt = { ...flt, from: p.prevFrom / 1000, to: prevTo / 1000 };
  const [o, rec, prevO] = await Promise.all([
    call('overview', { flt }),
    call('records', { flt }),
    call('overview', { flt: prevFlt }),
  ]);
  const prev = [prevO.totalMs];
  if (!alive()) return;
  if (!o.plays) { el.innerHTML = '<div class="empty"><p>Nessun ascolto in questo anno.</p></div>'; return; }
  // I generi arrivano da Spotify: se non sono pronti in pochi secondi, la storia parte senza.
  const genres = await Promise.race([genreData(flt, 30).catch(() => null), new Promise(r => setTimeout(() => r(null), 5000))]);
  if (!alive()) return;

  const me = profile();
  const minutes = Math.round(o.totalMs / 60000);
  const pct = prev[0] ? Math.round(((o.totalMs - prev[0]) / prev[0]) * 100) : null;
  const bestMonth = o.byMonth.values.indexOf(Math.max(...o.byMonth.values));
  const [persona, personaText] = personality(o.byHour, rec.nightShare);
  const topA = o.topArtists[0], topT = o.topTracks[0];
  const firstA = rec.since.find(a => a.id === (topA && topA.id));
  const running = year === new Date().getFullYear();

  const slides = [
    `<div class="st st-intro">${me ? `<div class="st-avatar">${avatarHtml(me, 120)}</div>` : ''}
      <span class="st-kicker">SoundStats presenta</span><h1>Il tuo ${year}<br><em>in musica</em></h1>
      <p>${running ? 'Com\'è andata finora.' : 'Riviviamolo insieme.'}</p></div>`,
    `<div class="st st-minutes"><span class="st-kicker">Quest'anno hai ascoltato</span>
      <span class="st-big" data-count="${minutes}">0</span><span class="st-unit">minuti</span>
      <p>Sono <b>${nf1.format(o.totalMs / 86400000)} giorni</b> interi di musica, <b>${fmtMin(o.perDayMs)} minuti</b> al giorno.</p>
      ${pct != null ? `<p class="st-delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% rispetto al ${year - 1}</p>` : ''}</div>`,
    prevO.plays ? versusSlide(year, o, prevO, running) : '',
    topA ? `<div class="st st-artist"><div class="halo">${pic('artists', topA.name, '', 'st-photo', 'l')}<i class="spark s1"></i><i class="spark s2"></i><i class="spark s3"></i><i class="spark s4"></i></div>
      <span class="st-kicker">Il tuo artista dell'anno</span><h2>${esc(topA.name)}</h2>
      <p><b>${fmtHours(topA.ms)} ore</b> insieme · ${plays(topA.plays)}</p>
      ${firstA ? `<p class="st-small">Lo ascolti dal ${fmtDate(firstA.first)}</p>` : ''}</div>` : '',
    `<div class="st st-list"><span class="st-kicker">I tuoi artisti più ascoltati</span>
      <ol>${o.topArtists.slice(0, 5).map(a => `<li>${pic('artists', a.name, '', 'st-thumb')}<span><b>${esc(a.name)}</b><small>${fmtHours(a.ms)} ore</small></span></li>`).join('')}</ol></div>`,
    topT ? `<div class="st st-track"><div class="sleeve">
        <div class="disc"><span class="disc-label">${pic('tracks', topT.name, topT.sub, 'disc-pic', 'l')}</span></div>
        ${pic('tracks', topT.name, topT.sub, 'st-cover', 'l')}</div>
      <span class="st-kicker">La tua canzone dell'anno</span><h2>${esc(topT.name)}</h2><p>${esc(topT.sub)}</p>
      <p class="st-small">L'hai ascoltata <b>${nf.format(topT.plays)} volte</b>, per ${fmtHours(topT.ms)} ore.</p></div>` : '',
    `<div class="st st-list"><span class="st-kicker">Le tue canzoni più ascoltate</span>
      <ol>${o.topTracks.slice(0, 5).map(t => `<li>${pic('tracks', t.name, t.sub, 'st-thumb sq')}<span><b>${esc(t.name)}</b><small>${esc(t.sub)}</small></span></li>`).join('')}</ol></div>`,
    genres && genres.list.length ? `<div class="st st-genre"><span class="st-kicker">Il tuo genere</span>
      <h2>${esc(capFirst(genres.list[0].name))}</h2>
      <div class="st-chips">${genres.list.slice(1, 6).map(g => `<span>${esc(capFirst(g.name))}</span>`).join('')}</div></div>` : '',
    `<div class="st st-persona${rec.nightShare >= 0.2 ? ' night' : ''}"><span class="st-kicker">Il tuo stile di ascolto</span><h2>${persona}</h2><p>${personaText}</p>
      <p class="st-small">Il mese con più musica: <b>${MESI[(o.byMonth.start + bestMonth) % 12]}</b>.${o.discovered ? ` Hai scoperto <b>${nf.format(o.discovered)}</b> nuovi artisti.` : ''}</p></div>`,
    `<div class="st st-records"><span class="st-kicker">I tuoi record</span>
      ${rec.bestDay ? `<p><b>${fmtMin(rec.bestDay.ms)} minuti</b><small>nel tuo giorno record, ${fmtDate(rec.bestDay.date)}</small></p>` : ''}
      ${rec.streak ? `<p><b>${rec.streak.len} giorni</b><small>di fila con la musica</small></p>` : ''}
      ${rec.repeat ? `<p><b>${rec.repeat.count} volte</b><small>${esc(rec.repeat.name)} in un solo giorno</small></p>` : ''}</div>`,
    `<div class="st st-outro"><span class="st-kicker">È tutto!</span><h2>Grazie per questo ${year}${running ? ' (finora)' : ''}</h2>
      <div class="st-actions">
        <a class="btn primary" href="#/recap/y-${year}" data-nav>Salva l'immagine</a>
        <button class="btn" data-story-playlist>Crea la playlist del ${year}</button>
        <button class="btn" data-story-restart>Rivedi</button>
      </div></div>`,
  ].filter(Boolean);

  document.body.classList.add('is-story');
  el.innerHTML = `<div class="story" tabindex="-1">
    <div class="story-bars">${slides.map(() => '<span><i></i></span>').join('')}</div>
    <button class="story-close" aria-label="Chiudi">×</button>
    <div class="story-stage"></div>
  </div>`;
  const story = $('.story', el), stage = $('.story-stage', el), bars = [...story.querySelectorAll('.story-bars i')];
  let idx = 0, timer = null, started = 0, paused = false, elapsed = 0;
  const DUR = 6500;

  const show = i => {
    idx = Math.max(0, Math.min(slides.length - 1, i));
    stage.innerHTML = slides[idx];
    stage.firstElementChild.insertAdjacentHTML('afterbegin', storyDeco(slides[idx]));
    stage.firstElementChild.classList.add('in');
    stage.querySelectorAll('[data-grow]').forEach(b => setTimeout(() => { b.style.width = b.dataset.grow; }, 60));
    story.dataset.slide = idx;
    bars.forEach((b, j) => { b.style.transition = 'none'; b.style.width = j < idx ? '100%' : '0%'; });
    const c = stage.querySelector('[data-count]');
    if (c) countUp(c, +c.dataset.count);
    elapsed = 0; start();
  };
  const start = () => {
    clearTimeout(timer);
    if (idx === slides.length - 1) { bars[idx].style.width = '100%'; return; }
    const left = DUR - elapsed;
    started = performance.now();
    requestAnimationFrame(() => { bars[idx].style.transition = `width ${left}ms linear`; bars[idx].style.width = '100%'; });
    timer = setTimeout(() => show(idx + 1), left);
  };
  const pause = () => {
    if (paused) return;
    paused = true; clearTimeout(timer);
    elapsed += performance.now() - started;
    const w = getComputedStyle(bars[idx]).width;
    bars[idx].style.transition = 'none'; bars[idx].style.width = w;
  };
  const resume = () => { if (!paused) return; paused = false; start(); };
  const close = () => { clearTimeout(timer); document.body.classList.remove('is-story'); location.hash = '#/explore'; };

  storyState = { stop: () => { clearTimeout(timer); document.body.classList.remove('is-story'); } };
  let downAt = 0;
  story.addEventListener('pointerdown', e => { if (e.target.closest('button, a')) return; downAt = performance.now(); pause(); });
  story.addEventListener('pointerup', e => {
    if (e.target.closest('button, a')) return;
    const held = performance.now() - downAt > 300;
    if (held) { resume(); return; }
    paused = false;
    const x = e.clientX / story.clientWidth;
    show(x < 0.3 ? idx - 1 : idx + 1);
  });
  story.addEventListener('click', e => {
    if (e.target.closest('.story-close')) close();
    else if (e.target.closest('[data-story-restart]')) show(0);
    else if (e.target.closest('[data-story-playlist]')) playlistFromTop(flt, 50, `SoundStats · Il mio ${year}`);
    else if (e.target.closest('[data-nav]')) { clearTimeout(timer); document.body.classList.remove('is-story'); }
  });
  show(0);
}
