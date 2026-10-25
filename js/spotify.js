'use strict';
/*
 * Accesso con Spotify (OAuth 2.0 "Authorization Code" con PKCE) e
 * chiamate alla Web API. Funziona senza server: la password si inserisce
 * solo sul sito di Spotify e l'app riceve un token salvato sul dispositivo.
 */
const Spotify = (() => {
  const SCOPES = 'user-top-read user-read-recently-played';
  const AUTH_KEY = 'ss-auth';
  const PKCE_KEY = 'ss-pkce';

  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } };
  const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* memoria piena */ } };
  const remove = key => { try { localStorage.removeItem(key); } catch (e) { /* ignorato */ } };

  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomString = bytes => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

  // Indirizzo dell'app senza file, parametri e #: deve coincidere con il
  // "Redirect URI" registrato su developer.spotify.com.
  const redirectUri = () => new URL('./', location.href).href;

  let auth = read(AUTH_KEY); // { access, refresh, exp }

  function store(t) {
    auth = {
      access: t.access_token,
      refresh: t.refresh_token || (auth && auth.refresh),
      exp: Date.now() + (t.expires_in - 60) * 1000,
    };
    write(AUTH_KEY, auth);
  }

  async function tokenRequest(params) {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CONFIG.spotifyClientId, ...params }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error_description || json.error || 'Errore ' + res.status);
      err.code = json.error;
      throw err;
    }
    return json;
  }

  async function login() {
    const verifier = randomString(48);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = randomString(12);
    write(PKCE_KEY, { verifier, state });
    location.assign('https://accounts.spotify.com/authorize?' + new URLSearchParams({
      response_type: 'code',
      client_id: CONFIG.spotifyClientId,
      scope: SCOPES,
      redirect_uri: redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    }));
  }

  // Al ritorno da Spotify l'indirizzo contiene ?code=… : lo scambia con un token.
  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return false;
    const pkce = read(PKCE_KEY);
    remove(PKCE_KEY);
    history.replaceState(null, '', redirectUri() + location.hash);

    if (q.get('error')) {
      throw new Error(q.get('error') === 'access_denied' ? 'Accesso annullato.' : 'Spotify ha risposto: ' + q.get('error'));
    }
    if (!pkce || pkce.state !== q.get('state')) throw new Error('La richiesta di accesso è scaduta. Riprova.');
    store(await tokenRequest({
      grant_type: 'authorization_code',
      code: q.get('code'),
      redirect_uri: redirectUri(),
      code_verifier: pkce.verifier,
    }));
    return true;
  }

  async function token() {
    if (!auth) throw new Error('Accesso a Spotify necessario.');
    if (Date.now() < auth.exp) return auth.access;
    try {
      store(await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh }));
    } catch (e) {
      if (e.code === 'invalid_grant' || e.code === 'invalid_client') { logout(); e.expired = true; }
      throw e;
    }
    return auth.access;
  }

  async function api(path, retry = true) {
    const res = await fetch('https://api.spotify.com/v1' + path, { headers: { Authorization: 'Bearer ' + await token() } });
    if (res.status === 401 && retry) { auth.exp = 0; return api(path, false); }
    if (res.status === 429 && retry) {
      const wait = Math.min(+res.headers.get('Retry-After') || 2, 10);
      await new Promise(r => setTimeout(r, wait * 1000));
      return api(path, false);
    }
    if (res.status === 403) {
      throw new Error('Spotify ha negato l\'accesso. Controlla che il tuo account sia tra gli utenti autorizzati dell\'app su developer.spotify.com (User Management).');
    }
    if (!res.ok) throw new Error('Errore di Spotify (' + res.status + ')');
    return res.status === 204 ? null : res.json();
  }

  function logout() {
    auth = null;
    remove(AUTH_KEY);
    remove('ss-profile');
  }

  return {
    login, handleRedirect, api, logout, redirectUri,
    get loggedIn() { return !!auth; },
    get configured() { return !!CONFIG.spotifyClientId; },
  };
})();
