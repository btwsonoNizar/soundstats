'use strict';
/*
 * Foto degli artisti e copertine di album, brani e podcast.
 * I file esportati da Spotify non contengono immagini: le cerchiamo con la
 * ricerca di Spotify e le ricordiamo sul dispositivo, così ogni immagine
 * viene cercata una volta sola.
 *
 * Uso nell'HTML:  <span data-k="artists" data-n="Nome" data-s="Artista"></span>
 * (data-size="l" per l'immagine grande). Images.hydrate(root) le riempie
 * quando diventano visibili.
 */
const Images = (() => {
  const KEY = 'ss-img-v1';
  const MAX = 4000;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { cache = {}; }
  let dirty = false;

  function persist() {
    if (!dirty) return;
    dirty = false;
    const keys = Object.keys(cache);
    if (keys.length > MAX) keys.slice(0, keys.length - MAX).forEach(k => delete cache[k]);
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* memoria piena */ }
  }
  setInterval(persist, 3000);
  addEventListener('pagehide', persist);

  const norm = s => String(s || '').toLowerCase().trim();
  const clean = s => String(s || '').replace(/["':()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
  const pick = imgs => {
    const list = (imgs || []).filter(i => i && i.url).sort((a, b) => (a.width || 0) - (b.width || 0));
    if (!list.length) return null;
    return { s: (list.find(i => (i.width || 0) >= 160) || list[list.length - 1]).url, l: list[list.length - 1].url };
  };

  async function lookup(kind, name, sub) {
    let q, type, target = name;
    switch (kind) {
      case 'artists': q = clean(name); type = 'artist'; break;
      case 'tracks': q = `track:${clean(name)} artist:${clean(sub)}`; type = 'track'; break;
      case 'albums': q = `album:${clean(name)} artist:${clean(sub)}`; type = 'album'; break;
      case 'shows': q = clean(name); type = 'show'; break;
      case 'episodes': q = clean(sub); type = 'show'; target = sub; break; // copertina del podcast
      default: return null;
    }
    const res = await Spotify.api(`/search?type=${type}&limit=5&q=${encodeURIComponent(q)}`);
    const items = ((res && res[type + 's']) || {}).items || [];
    const best = items.find(it => it && norm(it.name) === norm(target)) || items.find(Boolean);
    if (!best) return null;
    return pick(type === 'track' ? best.album && best.album.images : best.images);
  }

  const keyOf = (kind, name, sub) => kind === 'episodes' ? 'shows|' + norm(sub) + '|' : kind + '|' + norm(name) + '|' + (kind === 'artists' || kind === 'shows' ? '' : norm(sub));

  const pending = new Map();
  const queue = [];
  let active = 0;

  function pump() {
    while (active < 3 && queue.length) {
      const job = queue.pop(); // le richieste più recenti (quelle visibili ora) per prime
      active++;
      lookup(job.kind, job.name, job.sub)
        .then(v => { cache[job.key] = v || 0; dirty = true; job.resolve(v); },
          () => job.resolve(null)) // errore di rete: si riproverà in seguito
        .finally(() => { active--; pending.delete(job.key); pump(); });
    }
  }

  function get(kind, name, sub = '') {
    const key = keyOf(kind, name, sub);
    if (key in cache) return Promise.resolve(cache[key] || null);
    if (pending.has(key)) return pending.get(key);
    const p = new Promise(resolve => queue.push({ key, kind, name, sub, resolve }));
    pending.set(key, p);
    pump();
    return p;
  }

  function fill(el) {
    get(el.dataset.k, el.dataset.n, el.dataset.s || '').then(v => {
      if (!v) { el.classList.add('none'); return; }
      const url = el.dataset.size === 'l' ? v.l : v.s;
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => { el.style.backgroundImage = `url("${url}")`; el.classList.add('loaded'); };
      img.src = url;
    });
  }

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); fill(e.target); }
    }, { rootMargin: '300px 300px' })
    : null;

  function hydrate(root) {
    if (!Spotify.loggedIn) return;
    root.querySelectorAll('[data-k]:not([data-done])').forEach(el => {
      el.dataset.done = '1';
      if (io) io.observe(el); else fill(el);
    });
  }

  return { get, hydrate };
})();
