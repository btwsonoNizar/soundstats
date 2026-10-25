'use strict';
/*
 * Configurazione dell'accesso con Spotify.
 *
 * spotifyClientId: il "Client ID" dell'app creata su
 * https://developer.spotify.com/dashboard  (non è un segreto: con il
 * flusso PKCE non serve il Client Secret, che NON va mai messo qui).
 *
 * Nella dashboard Spotify, tra i "Redirect URIs", aggiungi l'indirizzo
 * esatto dove è pubblicata l'app, con la barra finale, ad esempio:
 *   https://btwsononizar.github.io/soundstats/
 */
const CONFIG = {
  spotifyClientId: 'ec6ef365feef468a989338392da8c5ed',
};
