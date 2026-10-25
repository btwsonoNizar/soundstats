'use strict';
/*
 * Web Worker: tutto il lavoro pesante avviene qui, fuori dal thread
 * dell'interfaccia, così l'app non si blocca anche con centinaia di
 * migliaia di ascolti.
 *
 *  - lettura dei file JSON / ZIP esportati da Spotify
 *  - unione e rimozione dei duplicati
 *  - salvataggio in IndexedDB (solo sul dispositivo)
 *  - calcolo di classifiche e statistiche
 *
 * Gli ascolti sono memorizzati "a colonne" in array tipizzati
 * (timestamp, millisecondi, brano, flag): occupano poca memoria e si
 * scorrono in pochi millisecondi.
 */
importScripts('unzip.js');

const F_SKIP = 1;        // l'ascolto è stato saltato
const F_POD = 2;         // è un episodio di podcast
const F_SKIPKNOWN = 4;   // il file indicava se è stato saltato
const F_LIVE = 8;        // aggiunto dalla sincronizzazione con Spotify (durata stimata)

const DB_NAME = 'soundstats';
const STORE = 'data';
const KEY = 'main';

let D = null;  // dati salvati
let X = null;  // campi derivati (ora, giorno, mese in ora locale)
const cache = new Map();

/* ------------------------------------------------------------------ */
/* IndexedDB                                                           */
/* ------------------------------------------------------------------ */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbRun(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('Errore del database')); };
  });
}

async function init() {
  try {
    D = (await dbRun('readonly', s => s.get(KEY))) || null;
    if (D && D.importedUntil == null) { D.importedUntil = D.n ? D.t[D.n - 1] : 0; D.lastLive = 0; }
    if (D) derive();
  } catch (e) {
    D = null; // IndexedDB non disponibile: l'app funziona comunque in memoria
  }
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

const progress = text => self.postMessage({ type: 'progress', text });
const baseName = n => n.split('/').pop();
const isHistoryName = n => {
  const b = baseName(n);
  return !b.startsWith('._') && /\.json$/i.test(b) && /(streaming_?history|endsong)/i.test(b);
};
// I file della cronologia estesa vengono letti per primi: contengono più
// informazioni (album, skip) e "vincono" in caso di duplicati.
const extendedFirst = n => (/(streaming_history_|endsong)/i.test(n) ? 0 : 1);

function parseEndTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s));
  if (!m) return NaN;
  return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) / 1000;
}

function makeBuilder() {
  const b = {
    t: [], ms: [], tr: [], f: [],
    tName: [], tArtist: [], tAlbum: [],
    aName: [], aPod: [],
    alName: [], alArtist: [],
    tMap: new Map(), aMap: new Map(), alMap: new Map(), dup: new Map(),
    files: D ? D.files.slice() : [],
  };

  if (D) {
    b.t = Array.from(D.t); b.ms = Array.from(D.ms); b.tr = Array.from(D.tr); b.f = Array.from(D.f);
    b.tName = D.tracks.name.slice(); b.tArtist = Array.from(D.tracks.artist); b.tAlbum = Array.from(D.tracks.album);
    b.aName = D.artists.name.slice(); b.aPod = Array.from(D.artists.pod);
    b.alName = D.albums.name.slice(); b.alArtist = Array.from(D.albums.artist);
    b.aName.forEach((n, i) => b.aMap.set((b.aPod[i] ? 'p|' : 'm|') + n.toLowerCase(), i));
    b.tName.forEach((n, i) => b.tMap.set(b.tArtist[i] + '|' + n.toLowerCase(), i));
    b.alName.forEach((n, i) => b.alMap.set(b.alArtist[i] + '|' + n.toLowerCase(), i));
    for (let i = 0; i < b.t.length; i++) b.dup.set(Math.floor(b.t[i] / 60) + '|' + b.ms[i] + '|' + b.tr[i], i);
  }

  // Ritorna 1 = aggiunto, 2 = duplicato
  b.add = (t, ms, name, artist, album, pod, sf) => {
    const ak = (pod ? 'p|' : 'm|') + artist.toLowerCase();
    let a = b.aMap.get(ak);
    if (a === undefined) { a = b.aName.length; b.aName.push(artist); b.aPod.push(pod ? 1 : 0); b.aMap.set(ak, a); }

    const tk = a + '|' + name.toLowerCase();
    let k = b.tMap.get(tk);
    if (k === undefined) { k = b.tName.length; b.tName.push(name); b.tArtist.push(a); b.tAlbum.push(-1); b.tMap.set(tk, k); }

    if (album && b.tAlbum[k] < 0) {
      const alk = a + '|' + album.toLowerCase();
      let al = b.alMap.get(alk);
      if (al === undefined) { al = b.alName.length; b.alName.push(album); b.alArtist.push(a); b.alMap.set(alk, al); }
      b.tAlbum[k] = al;
    }

    // Stesso brano, stessa durata, stesso minuto = stesso ascolto
    // (succede importando sia i dati base sia la cronologia estesa).
    const dk = Math.floor(t / 60) + '|' + ms + '|' + k;
    const ex = b.dup.get(dk);
    if (ex !== undefined) {
      if ((sf & F_SKIPKNOWN) && !(b.f[ex] & F_SKIPKNOWN)) b.f[ex] = (b.f[ex] & F_POD) | sf;
      return 2;
    }
    b.dup.set(dk, b.t.length);
    b.t.push(t); b.ms.push(ms); b.tr.push(k); b.f.push((pod ? F_POD : 0) | sf);
    return 1;
  };
  return b;
}

function addRecord(b, r) {
  if (!r || typeof r !== 'object') return 0;
  let t, ms, name, artist, album = null, pod = false, sf = 0;

  if (r.ts !== undefined) {
    // Cronologia estesa: Streaming_History_Audio_*.json / endsong_*.json
    t = Math.floor(Date.parse(r.ts) / 1000);
    ms = +r.ms_played || 0;
    if (r.master_metadata_track_name) {
      name = r.master_metadata_track_name;
      artist = r.master_metadata_album_artist_name || 'Artista sconosciuto';
      album = r.master_metadata_album_album_name || null;
    } else if (r.episode_name || r.episode_show_name) {
      name = r.episode_name || 'Episodio senza titolo';
      artist = r.episode_show_name || 'Podcast sconosciuto';
      pod = true;
    } else {
      return 0; // audiolibri o voci senza metadati
    }
    if (r.skipped === true || r.skipped === false) sf = F_SKIPKNOWN | (r.skipped ? F_SKIP : 0);
    else if (r.reason_end) sf = F_SKIPKNOWN | (r.reason_end === 'fwdbtn' ? F_SKIP : 0);
  } else if (r.endTime !== undefined) {
    // Dati account base: StreamingHistory_music_*.json / StreamingHistory_podcast_*.json
    t = parseEndTime(r.endTime);
    ms = +r.msPlayed || 0;
    if (r.trackName !== undefined) {
      name = r.trackName || 'Brano sconosciuto';
      artist = r.artistName || 'Artista sconosciuto';
    } else if (r.episodeName !== undefined) {
      name = r.episodeName || 'Episodio senza titolo';
      artist = r.podcastName || 'Podcast sconosciuto';
      pod = true;
    } else {
      return 0;
    }
  } else {
    return 0;
  }
  if (!Number.isFinite(t) || t < 0) return 0;
  return b.add(t, Math.max(0, Math.round(ms)), String(name), String(artist), album && String(album), pod, sf);
}

function finalize(b) {
  const tt = b.t;
  // Gli ascolti sincronizzati da Spotify servono solo dopo la fine dei file
  // importati: dove i file ci sono, valgono i file (minuti reali).
  let importedUntil = 0, lastLive = 0;
  for (let i = 0; i < tt.length; i++) if (!(b.f[i] & F_LIVE) && tt[i] > importedUntil) importedUntil = tt[i];
  const keep = [];
  for (let i = 0; i < tt.length; i++) {
    if (b.f[i] & F_LIVE) { if (tt[i] <= importedUntil) continue; if (tt[i] > lastLive) lastLive = tt[i]; }
    keep.push(i);
  }
  const n = keep.length;
  const order = Uint32Array.from(keep);
  order.sort((x, y) => tt[x] - tt[y]);

  const t = new Uint32Array(n), ms = new Uint32Array(n), tr = new Uint32Array(n), f = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    t[k] = tt[i]; ms[k] = b.ms[i]; tr[k] = b.tr[i]; f[k] = b.f[i];
  }
  D = {
    version: 1, n, t, ms, tr, f, importedUntil, lastLive,
    tracks: { name: b.tName, artist: Int32Array.from(b.tArtist), album: Int32Array.from(b.tAlbum) },
    artists: { name: b.aName, pod: Uint8Array.from(b.aPod) },
    albums: { name: b.alName, artist: Int32Array.from(b.alArtist) },
    files: b.files,
    updated: Date.now(),
  };
}

async function doImport({ files }) {
  // Raccoglie le "sorgenti" senza decomprimerle tutte subito (risparmio di memoria).
  const sources = [];
  for (const file of files) {
    progress('Lettura di ' + file.name + '…');
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4b) {
      const buf = await file.arrayBuffer();
      for (const en of listZip(buf)) {
        if (isHistoryName(en.name)) sources.push({ name: baseName(en.name), read: () => inflateEntry(en) });
      }
    } else if (head[0] === 0x1f && head[1] === 0x8b) {
      // Backup di SoundStats (JSON compresso con gzip)
      sources.push({ name: file.name, read: () => new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text() });
    } else if (/\.(json|soundstats)$/i.test(file.name) || file.type.includes('json')) {
      sources.push({ name: file.name, read: () => file.text() });
    }
  }
  if (!sources.length) {
    throw new Error('Nessun file di cronologia trovato. Seleziona i file "StreamingHistory…" o "Streaming_History_Audio…" (oppure il file .zip scaricato da Spotify).');
  }
  sources.sort((a, b) => extendedFirst(a.name) - extendedFirst(b.name) || a.name.localeCompare(b.name));

  const b = makeBuilder();
  let added = 0, dups = 0, used = 0;
  const ignored = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    progress('Analisi file ' + (i + 1) + ' di ' + sources.length + '\n' + src.name);
    let rows;
    try { rows = JSON.parse(await src.read()); } catch (e) { ignored.push(src.name); continue; }
    if (rows && rows.format === 'soundstats-backup') {
      const r = addBackup(b, rows);
      added += r.added; dups += r.dups; used++;
      rows = null;
      continue;
    }
    if (!Array.isArray(rows)) { ignored.push(src.name); continue; }
    let ok = 0;
    for (let j = 0; j < rows.length; j++) {
      const res = addRecord(b, rows[j]);
      if (res === 1) { added++; ok++; } else if (res === 2) { dups++; ok++; }
    }
    rows = null;
    if (ok) { used++; if (!b.files.includes(src.name)) b.files.push(src.name); } else ignored.push(src.name);
  }

  progress('Salvataggio sul dispositivo…');
  finalize(b);
  derive();
  cache.clear();
  let saved = true;
  try { await dbRun('readwrite', s => s.put(D, KEY)); } catch (e) { saved = false; }
  return { added, dups, files: used, ignored, saved, total: D.n };
}

async function saveAll() {
  derive();
  cache.clear();
  try { await dbRun('readwrite', s => s.put(D, KEY)); return true; } catch (e) { return false; }
}

// Ascolti recenti letti da Spotify: [{ t, ms, name, artist, album, pod }]
async function addLive({ rows }) {
  const b = makeBuilder();
  const until = D.importedUntil || 0;
  let added = 0;
  for (const r of rows) {
    if (!r || !r.name || !Number.isFinite(r.t) || r.t <= until) continue;
    if (b.add(r.t, Math.max(0, Math.round(r.ms || 0)), String(r.name), String(r.artist || 'Artista sconosciuto'),
      r.album ? String(r.album) : null, !!r.pod, F_LIVE) === 1) added++;
  }
  if (!added) return { added: 0 };
  finalize(b);
  await saveAll();
  return { added };
}

// Album ricavati da Spotify per i brani che non ne hanno: [{ track, album }]
async function setAlbums({ items }) {
  const T = D.tracks, AL = D.albums;
  const albumArtist = Array.from(AL.artist);
  const map = new Map(AL.name.map((n, i) => [albumArtist[i] + '|' + n.toLowerCase(), i]));
  let set = 0;
  for (const { track, album } of items) {
    if (!album || track < 0 || track >= T.name.length || T.album[track] >= 0) continue;
    const a = T.artist[track];
    const key = a + '|' + album.toLowerCase();
    let al = map.get(key);
    if (al === undefined) { al = AL.name.length; AL.name.push(album); albumArtist.push(a); map.set(key, al); }
    T.album[track] = al;
    set++;
  }
  AL.artist = Int32Array.from(albumArtist);
  await saveAll();
  return { set };
}

// Minuti totali per una lista di intervalli (per l'elenco dei recap).
function totals({ ranges, minMs, noSkip }) {
  return ranges.map(([from, to]) => {
    const lo = lowerBound(D.t, from), hi = lowerBound(D.t, to);
    let sum = 0;
    for (let i = lo; i < hi; i++) {
      if (D.ms[i] < (minMs || 0) || (noSkip && (D.f[i] & F_SKIP))) continue;
      sum += D.ms[i];
    }
    return sum;
  });
}

/* ---------- Esplora: ricordi, record, confronti, fissazioni ---------- */

const topOf = (flt, kind, n) => {
  const g = aggregate(flt, kind);
  return g.ids.slice(0, n).map((id, r) => ({ rank: r + 1, id, ms: g.sum[id], plays: g.cnt[id], ...label(kind, id) }));
};

function rangeTotals(flt) {
  const [lo, hi] = bounds(flt);
  const T = D.tracks, seenT = new Set(), seenA = new Set();
  let ms = 0, plays = 0;
  for (let i = lo; i < hi; i++) {
    const v = D.ms[i];
    if (v < (flt.minMs || 0) || (flt.noSkip && (D.f[i] & F_SKIP))) continue;
    ms += v; plays++;
    if (!(D.f[i] & F_POD)) { seenT.add(D.tr[i]); seenA.add(T.artist[D.tr[i]]); }
  }
  return { ms, plays, uTracks: seenT.size, uArtists: seenA.size };
}

// "Un anno fa oggi": lo stesso giorno negli anni passati.
function memories({ minMs, noSkip }) {
  const now = new Date(), out = [];
  for (let k = 1; k <= 20; k++) {
    const from = new Date(now.getFullYear() - k, now.getMonth(), now.getDate());
    if (from.getMonth() !== now.getMonth()) continue; // 29 febbraio
    const to = new Date(from); to.setDate(to.getDate() + 1);
    if (to / 1000 < D.t[0]) break;
    const flt = { from: from / 1000, to: to / 1000, minMs, noSkip };
    const tot = rangeTotals(flt);
    if (!tot.plays) continue;
    out.push({ years: k, date: from / 1000, ...tot, tracks: topOf(flt, 'tracks', 5), artists: topOf(flt, 'artists', 3) });
  }
  return out;
}

// Numero del giorno locale (per serie e record), con cache ogni 15 minuti.
function dayNumbers(lo, hi) {
  const out = new Int32Array(hi - lo);
  let last = -1, val = 0;
  for (let i = lo; i < hi; i++) {
    const q = Math.floor(D.t[i] / 900);
    if (q !== last) { last = q; const d = new Date(q * 900000); val = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; }
    out[i - lo] = val;
  }
  return out;
}
const dayToSec = n => { const d = new Date(n * 86400000); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000; };

function records({ flt }) {
  const [lo, hi] = bounds(flt);
  const T = D.tracks, minMs = flt.minMs || 0, noSkip = !!flt.noSkip;
  const days = dayNumbers(lo, hi);
  const perDay = new Map();
  let bestDay = null, sess = null, best = null, prevEnd = -1;
  let rep = { count: 0 }, artistDay = { ms: 0 };
  let curDay = -1, dayTracks = new Map(), dayArtists = new Map();
  let night = 0, total = 0;
  const flushDay = () => {
    for (const [k, c] of dayTracks) if (c > rep.count) rep = { count: c, track: k, day: curDay };
    for (const [a, v] of dayArtists) if (v > artistDay.ms) artistDay = { ms: v, artist: a, day: curDay };
  };
  for (let i = lo; i < hi; i++) {
    const v = D.ms[i];
    if (v < minMs || (noSkip && (D.f[i] & F_SKIP))) continue;
    const day = days[i - lo];
    if (day !== curDay) { if (curDay >= 0) flushDay(); curDay = day; dayTracks = new Map(); dayArtists = new Map(); }
    perDay.set(day, (perDay.get(day) || 0) + v);
    total += v;
    if (X.hour[i] < 5) night += v;
    const k = D.tr[i];
    if (!(D.f[i] & F_POD)) {
      dayTracks.set(k, (dayTracks.get(k) || 0) + 1);
      const a = T.artist[k];
      dayArtists.set(a, (dayArtists.get(a) || 0) + v);
    }
    // Sessioni: ascolti separati da meno di 15 minuti.
    const start = D.t[i] - v / 1000;
    if (!sess || start - prevEnd > 900) {
      if (sess && (!best || sess.end - sess.start > best.end - best.start)) best = sess;
      sess = { start, end: D.t[i], plays: 0, ms: 0 };
    }
    sess.end = Math.max(sess.end, D.t[i]); sess.plays++; sess.ms += v;
    prevEnd = Math.max(prevEnd, D.t[i]);
  }
  if (curDay >= 0) flushDay();
  if (sess && (!best || sess.end - sess.start > best.end - best.start)) best = sess;

  // Giorno record e serie di giorni consecutivi.
  const dayList = [...perDay.keys()].sort((a, b) => a - b);
  let streak = { len: 0 }, run = 0, runStart = 0;
  for (let j = 0; j < dayList.length; j++) {
    const d = dayList[j];
    if (j && d === dayList[j - 1] + 1) run++; else { run = 1; runStart = d; }
    if (run > streak.len) streak = { len: run, from: runStart, to: d };
    const v = perDay.get(d);
    if (!bestDay || v > bestDay.ms) bestDay = { day: d, ms: v };
  }
  const todayN = (() => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86400000; })();
  let current = 0;
  if (dayList.length && dayList[dayList.length - 1] >= todayN - 1) {
    current = 1;
    for (let j = dayList.length - 1; j > 0 && dayList[j - 1] === dayList[j] - 1; j--) current++;
  }

  // Da quando ascolti i tuoi artisti preferiti.
  const since = topOf(flt, 'artists', 8).map(a => ({ ...a, first: D.t[X.artistFirst[a.id]] }));

  return {
    total, activeDays: dayList.length,
    spanDays: dayList.length ? dayList[dayList.length - 1] - dayList[0] + 1 : 0,
    bestDay: bestDay && { date: dayToSec(bestDay.day), ms: bestDay.ms },
    streak: streak.len ? { len: streak.len, from: dayToSec(streak.from), to: dayToSec(streak.to) } : null,
    current,
    session: best && { start: best.start, end: best.end, plays: best.plays, ms: best.ms },
    repeat: rep.count ? { count: rep.count, date: dayToSec(rep.day), ...label('tracks', rep.track), id: rep.track } : null,
    artistDay: artistDay.ms ? { ms: artistDay.ms, date: dayToSec(artistDay.day), id: artistDay.artist, name: D.artists.name[artistDay.artist] } : null,
    nightShare: total ? night / total : 0,
    since,
  };
}

// Confronto tra due periodi: totali e chi sale/scende in classifica.
function compare({ a, b, kind }) {
  const ga = aggregate(a, kind), gb = aggregate(b, kind);
  const rankB = new Map(gb.ids.map((id, r) => [id, r + 1]));
  const rows = ga.ids.slice(0, 50).map((id, r) => ({
    rank: r + 1, prevRank: rankB.get(id) || 0, id, ms: ga.sum[id], plays: ga.cnt[id], prevMs: gb.sum[id], ...label(kind, id),
  }));
  const inA = new Set(ga.ids.slice(0, 50));
  const dropped = gb.ids.slice(0, 20).filter(id => !inA.has(id)).slice(0, 10)
    .map(id => ({ prevRank: rankB.get(id), id, prevMs: gb.sum[id], ms: ga.sum[id], ...label(kind, id) }));
  return { A: rangeTotals(a), B: rangeTotals(b), rows, dropped };
}

// Fissazioni: tanti ascolti in due settimane e poi quasi più niente.
function obsessions({ flt, kind }) {
  const [lo, hi] = bounds(flt);
  const T = D.tracks, minMs = flt.minMs || 0, noSkip = !!flt.noSkip;
  if (hi <= lo) return { items: [] };
  const W = 604800, w0 = Math.floor(D.t[lo] / W), wEnd = Math.floor(D.t[D.n - 1] / W);
  const weeks = new Map(), totals = new Map();
  for (let i = lo; i < hi; i++) {
    if (D.ms[i] < minMs || (noSkip && (D.f[i] & F_SKIP)) || (D.f[i] & F_POD)) continue;
    const id = kind === 'artists' ? T.artist[D.tr[i]] : D.tr[i];
    const key = id * 8192 + (Math.floor(D.t[i] / W) - w0);
    weeks.set(key, (weeks.get(key) || 0) + 1);
    totals.set(id, (totals.get(id) || 0) + 1);
  }
  // Per ogni elemento: finestra di 2 settimane con più ascolti.
  const peak = new Map();
  for (const [key, c] of weeks) {
    const id = Math.floor(key / 8192), w = key % 8192;
    const c2 = c + (weeks.get(key + 1) || 0);
    const p = peak.get(id);
    if (!p || c2 > p.count) peak.set(id, { count: c2, week: w });
  }
  const minPeak = kind === 'artists' ? 25 : 10;
  const items = [];
  for (const [id, p] of peak) {
    if (p.count < minPeak) continue;
    let before = 0, after = 0;
    // Conta prima/dopo il picco usando i totali settimanali dell'elemento.
    for (let w = 0; w <= (wEnd - w0); w++) {
      const c = weeks.get(id * 8192 + w);
      if (!c) continue;
      if (w < p.week) before += c; else if (w > p.week + 1) after += c;
    }
    const total = totals.get(id);
    const weeksAfter = wEnd - w0 - (p.week + 1);
    const share = p.count / total;
    if (share < 0.45) continue; // ascoltato con continuità, non una fissazione
    const status = weeksAfter < 4 ? 'in corso' : after <= p.count * 0.3 ? 'abbandonato' : 'ancora presente';
    items.push({ id, ...label(kind, id), peak: p.count, peakFrom: (w0 + p.week) * W, total, before, after, share, status });
  }
  items.sort((x, y) => y.peak * y.share - x.peak * x.share);
  return { items: items.slice(0, 30) };
}

// Minuti per anno di alcuni artisti (per l'evoluzione dei generi).
function artistYears({ ids, flt }) {
  const want = new Map(ids.map((id, j) => [id, j]));
  const [lo, hi] = bounds(flt);
  const y0 = 2000 + Math.floor(X.mon[lo] / 12), y1 = 2000 + Math.floor(X.mon[Math.max(lo, hi - 1)] / 12);
  const years = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  const ms = ids.map(() => new Array(years.length).fill(0));
  for (let i = lo; i < hi; i++) {
    if (D.ms[i] < (flt.minMs || 0) || (flt.noSkip && (D.f[i] & F_SKIP))) continue;
    const j = want.get(D.tracks.artist[D.tr[i]]);
    if (j === undefined) continue;
    ms[j][2000 + Math.floor(X.mon[i] / 12) - y0] += D.ms[i];
  }
  return { years, ms };
}

// Backup: tutti i dati in un formato semplice da reimportare.
function exportData() {
  return {
    format: 'soundstats-backup', version: 1, exported: Date.now(),
    t: Array.from(D.t), ms: Array.from(D.ms), tr: Array.from(D.tr), f: Array.from(D.f),
    tracks: { name: D.tracks.name, artist: Array.from(D.tracks.artist), album: Array.from(D.tracks.album) },
    artists: { name: D.artists.name, pod: Array.from(D.artists.pod) },
    albums: { name: D.albums.name, artist: Array.from(D.albums.artist) },
    files: D.files,
  };
}

function addBackup(b, bk) {
  let added = 0, dups = 0;
  const flags = F_SKIP | F_SKIPKNOWN | F_LIVE;
  for (let i = 0; i < bk.t.length; i++) {
    const k = bk.tr[i], a = bk.tracks.artist[k], al = bk.tracks.album[k];
    const res = b.add(bk.t[i], bk.ms[i], bk.tracks.name[k], bk.artists.name[a], al >= 0 ? bk.albums.name[al] : null,
      !!bk.artists.pod[a], bk.f[i] & flags);
    if (res === 1) added++; else if (res === 2) dups++;
  }
  (bk.files || []).forEach(f => { if (!b.files.includes(f)) b.files.push(f); });
  return { added, dups };
}

// Tutti gli ascolti di un intervallo (la timeline di un giorno), dal più recente.
function dayPlays({ from, to }) {
  const T = D.tracks;
  const lo = lowerBound(D.t, from), hi = lowerBound(D.t, to);
  const items = [];
  for (let i = hi - 1; i >= lo && items.length < 1000; i--) {
    const k = D.tr[i], al = T.album[k], fl = D.f[i];
    items.push({
      t: D.t[i], ms: D.ms[i], track: k, name: T.name[k],
      artistId: T.artist[k], artist: D.artists.name[T.artist[k]],
      albumId: al, album: al >= 0 ? D.albums.name[al] : '',
      pod: !!(fl & F_POD), skip: !!(fl & F_SKIP), live: !!(fl & F_LIVE),
    });
  }
  return { items, first: D.t[0], last: D.t[D.n - 1] };
}

async function doClear() {
  D = null; X = null; cache.clear();
  try { await dbRun('readwrite', s => s.delete(KEY)); } catch (e) { /* niente da cancellare */ }
  return true;
}

/* ------------------------------------------------------------------ */
/* Calcoli                                                             */
/* ------------------------------------------------------------------ */

// Ora, giorno della settimana e mese in ora locale del telefono.
// I fusi orari sono multipli di 15 minuti: basta un Date ogni 15 minuti.
function derive() {
  const n = D.n, t = D.t;
  const hour = new Uint8Array(n), dow = new Uint8Array(n), mon = new Int16Array(n);
  let last = -1, h = 0, w = 0, m = 0;
  for (let i = 0; i < n; i++) {
    const q = Math.floor(t[i] / 900);
    if (q !== last) {
      last = q;
      const d = new Date(q * 900000);
      h = d.getHours(); w = (d.getDay() + 6) % 7; m = (d.getFullYear() - 2000) * 12 + d.getMonth();
    }
    hour[i] = h; dow[i] = w; mon[i] = m;
  }
  // Primo ascolto di ogni artista (per il grafico delle scoperte).
  const artistFirst = new Int32Array(D.artists.name.length).fill(-1);
  for (let i = 0; i < n; i++) { const a = D.tracks.artist[D.tr[i]]; if (artistFirst[a] < 0) artistFirst[a] = i; }
  X = { hour, dow, mon, artistFirst };
}

function lowerBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}

// Gli ascolti sono ordinati per data: il periodo diventa un intervallo di indici.
function bounds(flt) {
  return [
    flt.from == null ? 0 : lowerBound(D.t, flt.from),
    flt.to == null ? D.n : lowerBound(D.t, flt.to),
  ];
}

function fillMonths(map) {
  if (!map.size) return { start: 0, values: [] };
  const keys = [...map.keys()];
  const start = Math.min(...keys), end = Math.max(...keys);
  const values = [];
  for (let m = start; m <= end; m++) values.push(map.get(m) || 0);
  return { start, values };
}

const isPodKind = kind => kind === 'shows' || kind === 'episodes';

function aggregate(flt, kind) {
  const key = kind + JSON.stringify(flt);
  if (cache.has(key)) return cache.get(key);

  const T = D.tracks, tr = D.tr, f = D.f, ms = D.ms;
  const wantPod = isPodKind(kind);
  const size = (kind === 'tracks' || kind === 'episodes') ? T.name.length
    : kind === 'albums' ? D.albums.name.length : D.artists.name.length;
  const map = (kind === 'tracks' || kind === 'episodes') ? null : kind === 'albums' ? T.album : T.artist;

  const sum = new Float64Array(size), cnt = new Uint32Array(size);
  const [lo, hi] = bounds(flt);
  const minMs = flt.minMs || 0, noSkip = !!flt.noSkip;
  for (let i = lo; i < hi; i++) {
    if (ms[i] < minMs) continue;
    const fl = f[i];
    if (noSkip && (fl & F_SKIP)) continue;
    if (((fl & F_POD) !== 0) !== wantPod) continue;
    const k = map ? map[tr[i]] : tr[i];
    if (k < 0) continue;
    sum[k] += ms[i]; cnt[k]++;
  }
  const ids = [];
  for (let k = 0; k < size; k++) if (cnt[k]) ids.push(k);
  ids.sort((a, b) => sum[b] - sum[a] || cnt[b] - cnt[a]);

  const res = { ids, sum, cnt };
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  cache.set(key, res);
  return res;
}

function label(kind, id) {
  const T = D.tracks, A = D.artists.name, AL = D.albums;
  switch (kind) {
    case 'tracks': case 'episodes':
      return { name: T.name[id], sub: A[T.artist[id]], subKind: kind === 'tracks' ? 'artists' : 'shows', subId: T.artist[id] };
    case 'albums':
      return { name: AL.name[id], sub: A[AL.artist[id]], subKind: 'artists', subId: AL.artist[id] };
    default:
      return { name: A[id], sub: '', subKind: null, subId: -1 };
  }
}

function meta() {
  if (!D || !D.n) return { n: 0 };
  const months = [];
  for (let i = 0; i < D.n; i++) { const m = X.mon[i]; if (months[months.length - 1] !== m) months.push(m); }
  const uniq = [...new Set(months)].sort((a, b) => a - b);
  const years = [...new Set(uniq.map(m => 2000 + Math.floor(m / 12)))];
  let hasSkip = false;
  for (let i = 0; i < D.n; i++) if (D.f[i] & F_SKIPKNOWN) { hasSkip = true; break; }
  // Quota del tempo di musica per cui conosciamo l'album.
  let musicMs = 0, withAlbum = 0;
  for (let i = 0; i < D.n; i++) {
    if (D.f[i] & F_POD) continue;
    musicMs += D.ms[i];
    if (D.tracks.album[D.tr[i]] >= 0) withAlbum += D.ms[i];
  }
  return {
    n: D.n, first: D.t[0], last: D.t[D.n - 1], months: uniq, years, hasSkip,
    files: D.files, updated: D.updated,
    hasAlbums: D.albums.name.length > 0,
    albumCoverage: musicMs ? withAlbum / musicMs : 1,
    importedUntil: D.importedUntil || 0, lastLive: D.lastLive || 0,
  };
}

function overview({ flt }) {
  const T = D.tracks, t = D.t, ms = D.ms, f = D.f, tr = D.tr;
  const seenT = new Uint8Array(T.name.length), seenA = new Uint8Array(D.artists.name.length), seenAl = new Uint8Array(D.albums.name.length);
  const byHour = new Array(24).fill(0), byDow = new Array(7).fill(0), months = new Map();
  const byWeekHour = new Array(7 * 24).fill(0);
  let musicMs = 0, podMs = 0, musicPlays = 0, podPlays = 0;
  let uTracks = 0, uArtists = 0, uAlbums = 0, uShows = 0, uEpisodes = 0, first = -1, last = -1;

  const [lo, hi] = bounds(flt);
  const minMs = flt.minMs || 0, noSkip = !!flt.noSkip;
  for (let i = lo; i < hi; i++) {
    const v = ms[i];
    if (v < minMs) continue;
    const fl = f[i];
    if (noSkip && (fl & F_SKIP)) continue;
    const k = tr[i], a = T.artist[k];
    if (fl & F_POD) {
      podMs += v; podPlays++;
      if (!seenT[k]) { seenT[k] = 1; uEpisodes++; }
      if (!seenA[a]) { seenA[a] = 1; uShows++; }
    } else {
      musicMs += v; musicPlays++;
      if (!seenT[k]) { seenT[k] = 1; uTracks++; }
      if (!seenA[a]) { seenA[a] = 1; uArtists++; }
      const al = T.album[k];
      if (al >= 0 && !seenAl[al]) { seenAl[al] = 1; uAlbums++; }
    }
    byHour[X.hour[i]] += v; byDow[X.dow[i]] += v; byWeekHour[X.dow[i] * 24 + X.hour[i]] += v;
    const m = X.mon[i]; months.set(m, (months.get(m) || 0) + v);
    if (first < 0) first = t[i];
    last = t[i];
  }
  const byMonth = fillMonths(months);

  // Calendario: minuti di ogni giorno (fino a ~1 anno, fino all'ultimo giorno del periodo).
  let calendar = null;
  if (first >= 0) {
    const endT = flt.to != null ? Math.min(flt.to - 1, last) : last;
    const end = new Date(endT * 1000); end.setHours(0, 0, 0, 0);
    const startD = new Date(end); startD.setDate(startD.getDate() - 370);
    const firstD = new Date((flt.from != null ? Math.max(flt.from, first) : first) * 1000); firstD.setHours(0, 0, 0, 0);
    const s = startD > firstD ? startD : firstD;
    const keyOf = d => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
    const pos = new Map(), values = [];
    for (const d = new Date(s); d <= end; d.setDate(d.getDate() + 1)) { pos.set(keyOf(d), values.length); values.push(0); }
    const from = lowerBound(t, s / 1000);
    for (let i = Math.max(lo, from); i < hi; i++) {
      if (ms[i] < minMs || (noSkip && (f[i] & F_SKIP))) continue;
      const p = pos.get(keyOf(new Date(t[i] * 1000)));
      if (p !== undefined) values[p] += ms[i];
    }
    calendar = { start: [s.getFullYear(), s.getMonth(), s.getDate()], dow: (s.getDay() + 6) % 7, values };
  }

  // Artisti scoperti (primo ascolto in assoluto) per mese.
  const disc = new Map();
  let discovered = 0;
  for (let a = 0; a < X.artistFirst.length; a++) {
    const i = X.artistFirst[a];
    if (i < lo || i >= hi || D.artists.pod[a]) continue;
    discovered++;
    disc.set(X.mon[i], (disc.get(X.mon[i]) || 0) + 1);
  }
  const discoveries = { start: byMonth.start, values: byMonth.values.map((_, k) => disc.get(byMonth.start + k) || 0) };

  const totalMs = musicMs + podMs;
  const start = flt.from != null ? flt.from : first;
  const end = flt.to != null ? Math.min(flt.to, Date.now() / 1000) : last;
  const days = Math.max(1, (end - start) / 86400);

  // Per periodi brevi (fino a ~3 mesi) anche il dettaglio giorno per giorno.
  let byDay = null;
  const lastDay = flt.to != null ? flt.to - 1 : last;
  if (first >= 0 && lastDay - start <= 93 * 86400) {
    const dayKey = d => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
    const pos = new Map();
    byDay = [];
    const d = new Date(start * 1000); d.setHours(0, 0, 0, 0);
    const stop = new Date(lastDay * 1000);
    while (d <= stop && byDay.length < 100) {
      pos.set(dayKey(d), byDay.length);
      byDay.push({ year: d.getFullYear(), day: d.getDate(), month: d.getMonth(), ms: 0 });
      d.setDate(d.getDate() + 1);
    }
    for (let i = lo; i < hi; i++) {
      if (ms[i] < minMs || (noSkip && (f[i] & F_SKIP))) continue;
      const p = pos.get(dayKey(new Date(t[i] * 1000)));
      if (p !== undefined) byDay[p].ms += ms[i];
    }
  }

  const top = (kind, n) => {
    const g = aggregate(flt, kind);
    return g.ids.slice(0, n).map((id, r) => ({ rank: r + 1, id, ms: g.sum[id], plays: g.cnt[id], ...label(kind, id) }));
  };

  return {
    totalMs, musicMs, podMs, plays: musicPlays + podPlays, musicPlays, podPlays,
    uTracks, uArtists, uAlbums, uShows, uEpisodes,
    perDayMs: totalMs / days, first, last,
    byHour, byDow, byMonth, byDay, byWeekHour, calendar, discoveries, discovered,
    topArtists: top('artists', 10), topTracks: top('tracks', 5), topAlbums: top('albums', 10),
  };
}

function top({ flt, kind, n, q }) {
  const g = aggregate(flt, kind);
  const query = (q || '').trim().toLowerCase();
  const rows = [];
  let matched = 0;
  for (let r = 0; r < g.ids.length; r++) {
    const id = g.ids[r];
    const l = label(kind, id);
    if (query && !l.name.toLowerCase().includes(query) && !(l.sub && l.sub.toLowerCase().includes(query))) continue;
    matched++;
    if (rows.length < n) rows.push({ rank: r + 1, id, ms: g.sum[id], plays: g.cnt[id], ...l });
    else if (!query) { matched = g.ids.length; break; }
  }
  return { rows, total: g.ids.length, matched, maxMs: g.ids.length ? g.sum[g.ids[0]] : 0 };
}

function detail({ kind, itemId: id, flt }) {
  const T = D.tracks, t = D.t, ms = D.ms, f = D.f, tr = D.tr;
  const isTrack = kind === 'tracks' || kind === 'episodes';
  const map = isTrack ? null : kind === 'albums' ? T.album : T.artist;
  const wantPod = isPodKind(kind);
  const from = flt.from == null ? -Infinity : flt.from, to = flt.to == null ? Infinity : flt.to;
  const minMs = flt.minMs || 0, noSkip = !!flt.noSkip;

  let allMs = 0, allPlays = 0, perMs = 0, perPlays = 0, first = -1, last = -1;
  const months = new Map(), byHour = new Array(24).fill(0), perTrack = new Map();
  for (let i = 0; i < D.n; i++) {
    const k = tr[i];
    if (map ? map[k] !== id : k !== id) continue;
    const fl = f[i];
    if (((fl & F_POD) !== 0) !== wantPod) continue;
    const v = ms[i];
    if (v < minMs || (noSkip && (fl & F_SKIP))) continue;
    allMs += v; allPlays++;
    if (first < 0) first = t[i];
    last = t[i];
    const m = X.mon[i]; months.set(m, (months.get(m) || 0) + v);
    if (t[i] >= from && t[i] < to) {
      perMs += v; perPlays++; byHour[X.hour[i]] += v;
      if (!isTrack) { const p = perTrack.get(k); if (p) { p[0] += v; p[1]++; } else perTrack.set(k, [v, 1]); }
    }
  }

  const g = aggregate(flt, kind);
  const pos = g.ids.indexOf(id);
  const res = {
    kind, id, ...label(kind, id),
    allMs, allPlays, perMs, perPlays, first, last,
    rank: pos >= 0 ? pos + 1 : 0, rankOf: g.ids.length,
    byMonth: fillMonths(months), byHour,
  };
  if (kind === 'tracks' && T.album[id] >= 0) { res.albumId = T.album[id]; res.album = D.albums.name[T.album[id]]; }
  if (!isTrack) {
    const sub = [...perTrack.entries()].sort((a, b) => b[1][0] - a[1][0]);
    res.uniqueTracks = sub.length;
    const subKind = wantPod ? 'episodes' : 'tracks';
    res.trackKind = subKind;
    res.tracks = sub.slice(0, 20).map(([k, [v, c]], r) => ({
      rank: r + 1, id: k, ms: v, plays: c, name: T.name[k], artist: D.artists.name[T.artist[k]],
      sub: kind === 'artists' && T.album[k] >= 0 ? D.albums.name[T.album[k]] : '',
    }));
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Messaggi dall'interfaccia                                           */
/* ------------------------------------------------------------------ */

const needData = fn => args => { if (!D || !D.n) throw new Error('Nessun dato importato.'); return fn(args); };
const handlers = {
  meta, import: doImport, clear: doClear,
  addLive: needData(addLive), setAlbums: needData(setAlbums), totals: needData(totals), day: needData(dayPlays),
  memories: needData(memories), records: needData(records), compare: needData(compare),
  obsessions: needData(obsessions), artistYears: needData(artistYears), exportData: needData(exportData),
  overview: needData(overview), top: needData(top), detail: needData(detail),
};

const ready = init();
self.onmessage = async e => {
  const { id, type } = e.data;
  try {
    await ready;
    if (!handlers[type]) throw new Error('Richiesta sconosciuta: ' + type);
    const result = await handlers[type](e.data);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
  }
};
