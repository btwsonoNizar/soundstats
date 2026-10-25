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
  const n = b.t.length;
  const tt = b.t;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((x, y) => tt[x] - tt[y]);

  const t = new Uint32Array(n), ms = new Uint32Array(n), tr = new Uint32Array(n), f = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    t[k] = tt[i]; ms[k] = b.ms[i]; tr[k] = b.tr[i]; f[k] = b.f[i];
  }
  D = {
    version: 1, n, t, ms, tr, f,
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
    } else if (/\.json$/i.test(file.name) || file.type.includes('json')) {
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
  X = { hour, dow, mon };
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
  return {
    n: D.n, first: D.t[0], last: D.t[D.n - 1], months: uniq, years, hasSkip,
    files: D.files, updated: D.updated,
  };
}

function overview({ flt }) {
  const T = D.tracks, t = D.t, ms = D.ms, f = D.f, tr = D.tr;
  const seenT = new Uint8Array(T.name.length), seenA = new Uint8Array(D.artists.name.length), seenAl = new Uint8Array(D.albums.name.length);
  const byHour = new Array(24).fill(0), byDow = new Array(7).fill(0), months = new Map();
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
    byHour[X.hour[i]] += v; byDow[X.dow[i]] += v;
    const m = X.mon[i]; months.set(m, (months.get(m) || 0) + v);
    if (first < 0) first = t[i];
    last = t[i];
  }

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
      byDay.push({ day: d.getDate(), month: d.getMonth(), ms: 0 });
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
    byHour, byDow, byMonth: fillMonths(months), byDay,
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
