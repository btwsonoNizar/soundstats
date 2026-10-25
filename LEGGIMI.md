# SoundStats – guida all'installazione

SoundStats è un'app per vedere le statistiche dei tuoi ascolti Spotify partendo dai file
che hai scaricato da Spotify ("Scarica i tuoi dati"). Funziona su **Android e iPhone**.

- Si entra con **l'account Spotify**; oltre alle statistiche dai file mostra le tue top
  attuali e gli ultimi brani ascoltati, presi in tempo reale da Spotify.
- Nessun server: i file vengono letti **sul telefono** e salvati solo lì.
- Una volta installata, funziona anche **senza internet**.

---

## Perché una PWA

SoundStats è una **PWA** (Progressive Web App): una web app che si installa sulla
schermata Home e si apre a schermo intero, come un'app normale.

| | PWA (scelta) | Flutter / React Native |
|---|---|---|
| Android + iPhone con lo stesso codice | sì | sì |
| Serve installare strumenti di sviluppo sul PC | no | sì (SDK, Android Studio, Xcode) |
| Per l'iPhone serve un Mac e un account sviluppatore (99 €/anno) | no | sì |
| Aggiornamenti | carichi i file e basta | ricompilare e reinstallare |
| Lettura file .json/.zip dal telefono | sì | sì |

Per un uso personale è la strada più semplice: niente store, niente compilazione.
I calcoli pesanti girano in un **Web Worker** (un processo separato), quindi l'interfaccia
non si blocca anche con anni di cronologia. Nei test, 500.000 ascolti (168 MB di JSON)
sono stati importati in circa 2 secondi su PC; su un telefono serve qualche secondo in più.

---

## Cosa c'è nella cartella

```
SoundStats/
├── index.html            pagina principale
├── manifest.webmanifest  nome, colori e icone dell'app installata
├── sw.js                 service worker: fa funzionare l'app offline
├── css/style.css         grafica (tema scuro nero/verde)
├── js/app.js             interfaccia: schede, filtri, ricerca, dettagli
├── js/charts.js          grafici a barre
├── js/worker.js          lettura dei file, salvataggio locale, calcolo statistiche
├── js/unzip.js           apertura dei file .zip
└── icons/                icone dell'app
```

---

## Passo 1 – Metti l'app online (una volta sola, dal PC)

Una PWA va aperta da un indirizzo **https://**: non basta copiare i file sul telefono.
Il modo più semplice e gratuito è **GitHub Pages**. Ci vogliono circa 10 minuti.

> L'app online contiene solo il programma, **non i tuoi dati**. I tuoi ascolti restano sul
> telefono.

1. Vai su **https://github.com/signup** e crea un account gratuito (se non ce l'hai).
2. In alto a destra premi **+** → **New repository**.
   - *Repository name*: `soundstats`
   - Lascia **Public** selezionato.
   - Premi **Create repository**.
3. Nella pagina che si apre, clicca il link **uploading an existing file**.
4. Apri la cartella `SoundStats` sul PC, seleziona **tutto il suo contenuto**
   (i file *e* le cartelle `css`, `js`, `icons`) e trascinalo nella pagina.
   Attenzione: trascina il *contenuto* della cartella, non la cartella stessa, così
   `index.html` finisce nella radice del repository.
5. Premi **Commit changes** e aspetta che il caricamento finisca.
6. Vai su **Settings** (in alto nel repository) → **Pages** (menu a sinistra).
   - In *Build and deployment* → *Source* scegli **Deploy from a branch**.
   - In *Branch* scegli **main** e la cartella **/ (root)**, poi **Save**.
7. Dopo 1–2 minuti, ricarica la pagina: in alto comparirà l'indirizzo dell'app, tipo
   `https://tuonome.github.io/soundstats/`. Questo è il link da aprire sul telefono.

**Alternativa senza GitHub:** su **https://app.netlify.com/drop** puoi trascinare la cartella
`SoundStats` e ottenere subito un indirizzo https. Crea un account gratuito Netlify quando
te lo chiede, altrimenti il sito viene cancellato dopo poco tempo.

---

## Passo 1b – Configura l'accesso con Spotify (una volta sola)

Per entrare in SoundStats si accede con Spotify. L'accesso usa il sistema ufficiale di
Spotify (OAuth con PKCE): la password si inserisce solo sul sito di Spotify e non serve
alcun server.

Requisiti di Spotify (dal 2026): chi crea l'app deve avere **Spotify Premium**, e l'app può
essere usata al massimo da **5 account**, da autorizzare a mano.

1. Vai su **https://developer.spotify.com/dashboard** e accedi con il tuo account Spotify.
   La prima volta accetta i termini per sviluppatori.
2. Premi **Create app** e compila:
   - *App name*: `SoundStats` – *App description*: `Statistiche di ascolto personali`
   - *Redirect URIs*: `https://btwsononizar.github.io/soundstats/` (premi **Add**; la barra
     finale è importante)
   - *Which API/SDKs are you planning to use?*: spunta **Web API**
   - Accetta i termini e premi **Save**.
3. Nella pagina dell'app apri **Settings** e copia il **Client ID** (NON il Client Secret).
4. Incolla il Client ID in `js/config.js` al posto di `''` in `spotifyClientId`, poi
   ricarica i file su GitHub.
5. In **User Management** aggiungi nome ed email Spotify di ogni persona che deve usare
   l'app (massimo 5), compreso il tuo account se l'accesso viene rifiutato.

---

## Passo 2 – Installa l'app sul telefono

### Android (Chrome)
1. Apri l'indirizzo dell'app con **Chrome**.
2. Tocca il menu **⋮** in alto a destra → **Installa app** (oppure
   **Aggiungi a schermata Home** → **Installa**).
3. Trovi l'icona **SoundStats** nella schermata Home / nel cassetto delle app.

### iPhone (Safari)
1. Apri l'indirizzo dell'app con **Safari** (non con Chrome: su iPhone solo Safari
   permette di installarla in modo affidabile).
2. Tocca il pulsante **Condividi** (il quadrato con la freccia verso l'alto).
3. Scorri e tocca **Aggiungi alla schermata Home** → **Aggiungi**.
4. Apri SoundStats **dall'icona sulla Home**: così i dati restano salvati in modo
   permanente (Safari può cancellare i dati dei siti aperti solo nel browser se non li usi
   per settimane).

---

## Passo 3 – Scarica i tuoi dati da Spotify

1. Vai su **https://www.spotify.com/account/privacy/** e accedi.
2. Nella sezione **Scarica i tuoi dati** spunta:
   - **Cronologia di streaming estesa** – consigliata: contiene tutta la storia del tuo
     account, gli album e gli skip;
   - e/o **Dati dell'account** – arriva prima ma contiene solo l'ultimo anno.
3. Premi **Richiedi dati** e conferma dall'email che ti arriva.
4. Quando i dati sono pronti (di solito pochi giorni, al massimo 30) ricevi un'email con il
   link per scaricare un file **.zip**. Scaricalo **direttamente sul telefono**:
   - **Android**: finisce nella cartella *Download*;
   - **iPhone**: Safari lo salva nell'app **File** → *Download*.

---

## Passo 4 – Importa i dati nell'app

1. Apri SoundStats e tocca **Importa file JSON o ZIP**.
2. Scegli lo **.zip** scaricato da Spotify. In alternativa puoi selezionare insieme più file
   `.json` (`Streaming_History_Audio_*.json`, `StreamingHistory_music_*.json`,
   `StreamingHistory_podcast_*.json`, `endsong_*.json`).
3. Aspetta qualche secondo: l'app legge i file, li unisce e li salva sul telefono.

Puoi importare più volte, ad esempio prima i dati base e poi quelli estesi, o una nuova
esportazione l'anno prossimo: gli ascolti già presenti vengono riconosciuti e **non sono
contati due volte**. Per ricominciare da zero: ⚙️ **Impostazioni** → **Cancella tutti i dati**.

> **Se lo .zip non si apre** (iPhone con iOS più vecchio di 16.4 o browser datati): nell'app
> **File** tocca lo .zip per estrarlo, poi importa i file `.json` che contiene.

---

## Come si usa

- **Schede in basso**: Panoramica, Brani, Artisti, Album, Podcast.
- **Filtro (pulsante col calendario in alto)**: periodo (sempre, anno, mese, date a scelta),
  esclusione degli ascolti brevi (sotto 10/30/60 secondi) e degli skip.
  Il filtro vale per tutte le schede.
- **Classifiche**: ordinate per **minuti effettivamente ascoltati**. Per ogni voce vedi
  posizione, minuti, ore e numero di ascolti. Scegli **Top 10 / 50 / 100** e usa la
  **ricerca**: i risultati mantengono la posizione reale in classifica.
- **Dettaglio**: tocca un brano, artista, album o podcast per vedere andamento nel tempo,
  orari, primo/ultimo ascolto e brani più ascoltati.
- **Grafici**: tocca o trascina il dito sulle barre per leggere i valori.

Note:
- Gli **skip** sono presenti solo nella cronologia estesa; con i dati base l'opzione è
  disattivata.
- Ore e giorni della settimana usano il **fuso orario del telefono** (Spotify registra gli
  orari in UTC).
- I brani sono raggruppati per titolo + artista: lo stesso brano uscito su un singolo e su un
  album conta come un unico brano.

---

## Aggiornare l'app

Se modifichi i file, ricaricali su GitHub (stesso procedimento del passo 1, i file vengono
sostituiti) e in `sw.js` cambia `soundstats-v1` in `soundstats-v2` (poi v3, ecc.).
Il telefono scarica la nuova versione la volta successiva che apri l'app con internet; chiudila
e riaprila per vederla. I dati importati non vengono toccati.

## Provarla sul PC

Puoi aprire l'indirizzo GitHub Pages anche dal browser del PC (Chrome, Edge, Firefox, Safari):
funziona allo stesso modo e i dati restano nel browser di quel PC.
