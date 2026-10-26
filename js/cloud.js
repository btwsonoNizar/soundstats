'use strict';
/*
 * Sincronizzazione tra dispositivi.
 * Una copia dei dati (lo stesso formato del backup .soundstats) viene salvata
 * sul server di SoundStats, legata all'account Spotify: su un altro
 * dispositivo, dopo il login, i dati vengono scaricati e uniti a quelli locali
 * (gli ascolti uguali non vengono contati due volte).
 * Usa le funzioni dell'interfaccia definite in app.js.
 */
const Cloud = (() => {
  const STATE = 'ss-cloud';
  const UPLOAD_EVERY = 30 * 60 * 1000; // per i soli ascolti sincronizzati da Spotify
  let available = null; // null = non ancora verificato
  let running = null;

  const state = () => load(STATE, { pulled: 0, uploaded: 0, dirty: false });
  const setState = patch => save(STATE, { ...state(), ...patch });
  const device = () => {
    let id = load('ss-device', null);
    if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); save('ss-device', id); }
    return id;
  };

  async function req(method, path, body, headers = {}) {
    const res = await fetch('api/sync' + path, {
      method, body, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + await Spotify.getToken(), ...headers },
    });
    if (res.status === 404 && path === '/meta') { available = false; return null; }
    if (!res.ok && res.status !== 404) throw new Error('Sincronizzazione non riuscita (' + res.status + ')');
    available = true;
    return res;
  }

  async function meta() {
    const res = await req('GET', '/meta');
    return res ? res.json() : null;
  }

  async function upload() {
    const data = await call('exportData');
    const stream = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'));
    const blob = await new Response(stream).blob();
    const res = await req('PUT', '', blob, { 'Content-Type': 'application/gzip', 'X-Rows': String(data.t.length), 'X-Device': device() });
    const m = await res.json();
    setState({ uploaded: Date.now(), pulled: m.updated, dirty: false, rows: m.rows, size: m.size });
    return m;
  }

  async function pull(m) {
    const res = await req('GET', '');
    if (!res || res.status === 404) return 0;
    const blob = await res.blob();
    const r = await call('import', { files: [new File([blob], 'cloud.soundstats')] });
    setState({ pulled: m.updated });
    return r.added;
  }

  /*
   * Allinea dispositivo e server:
   *  - se sul server c'è una copia più recente fatta da un altro dispositivo, la unisce;
   *  - se qui ci sono dati nuovi (import, album, ascolti recenti), li carica.
   * force: carica subito anche se l'ultimo caricamento è recente.
   */
  function sync({ force = false, quiet = true } = {}) {
    if (running) return running;
    if (!Spotify.loggedIn || !navigator.onLine || (available === false && !force)) return Promise.resolve(null);
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    running = (async () => {
      let changed = false;
      try {
        const m = await meta();
        if (!m) return null;
        const st = state();
        const hasLocal = S.meta && S.meta.n > 0;
        if (m.exists && m.updated > (st.pulled || 0) && m.device !== device()) {
          if (!quiet || !hasLocal) busy('Recupero i tuoi dati salvati online…');
          const added = await pull(m);
          if (added) {
            changed = true;
            S.meta = await call('meta');
            if (S.meta.n > (m.rows || 0)) setState({ dirty: true });
          }
        }
        const now = state();
        const due = force || !m.exists || (now.dirty && Date.now() - (now.uploaded || 0) > UPLOAD_EVERY);
        if (S.meta && S.meta.n > 0 && (due && (now.dirty || !m.exists || force))) await upload();
        return { changed };
      } catch (e) {
        if (!quiet) throw e;
        return null;
      } finally {
        busy(null);
        running = null;
      }
    })();
    return running;
  }

  async function remove() {
    await req('DELETE', '');
    setState({ pulled: 0, uploaded: 0, dirty: false, rows: 0, size: 0 });
  }

  return {
    sync, remove, meta,
    markDirty: () => setState({ dirty: true }),
    status: () => ({ available, ...state() }),
  };
})();
