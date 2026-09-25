# Agenda & Entrate — Federica

Calendario settimanale drag & drop per la gestione di appuntamenti su più sedi
(centri, studi, tutoraggio a domicilio), con calcolo automatico dei tempi di
spostamento in auto e stima di lordo/netto settimanale.

## Come funziona

- **Categorie** (colonna a sinistra): rappresentano i diversi committenti/tipi
  di lavoro (es. "Centro Sereno", "Tutoraggio a domicilio"). Ognuna ha un
  colore, una tariffa oraria lorda predefinita e — facoltativamente — una sede
  predefinita. Si trascina una categoria in agenda per creare un impegno.
- **Impegni**: si spostano trascinandoli, si allungano/accorciano trascinando
  il bordo inferiore, si aprono con un tocco per modificare orario, sede,
  tariffa, note e stato di fatturazione.
- **Indirizzi**: ogni sede (compresa la residenza personale) va salvata una
  volta in "Gestisci indirizzi". Il sistema calcola la posizione geografica
  automaticamente (geocoding) e poi il tempo di guida tra due sedi consecutive
  la prima volta che serve, tenendolo poi in cache.
- **Tempi di spostamento**: mostrati come fasce tratteggiate tra un impegno e
  il successivo. Se il tempo libero è inferiore al tempo di spostamento
  stimato, la fascia diventa rossa e compare un avviso nella colonna di
  sinistra. Ogni tempo calcolato automaticamente può essere corretto a mano in
  Impostazioni → Spostamenti: la correzione manuale vince sempre su quella
  automatica.
- **Entrate** (pannello a destra): totale lordo, imponibile, contributi,
  imposta sostitutiva e netto stimato per la settimana o il mese in corso, con
  ripartizione per categoria e per stato di fatturazione (da fatturare /
  fatturata / incassata). Le percentuali usate per la stima si impostano in
  Impostazioni → Tariffe & tasse e non sono scritte nel codice: puoi
  aggiornarle quando cambiano le aliquote o la situazione fiscale.

## Novità

- **Spostamenti come blocchi in agenda**: il tempo per andare da un impegno
  all'altro (e da/verso casa a inizio e fine giornata) è disegnato come un
  blocco a sé nel calendario, con lo stesso peso visivo di un impegno vero —
  utile per vedere a colpo d'occhio se una giornata con sedi diverse è
  fattibile o troppo stretta.
- **Suggerimento "torna a casa"**: se tra due impegni c'è molto più tempo
  libero di quanto ne serva per spostarsi direttamente (e c'è abbastanza
  tempo per andare a casa e tornare), il blocco di spostamento diventa un
  suggerimento dedicato invece del solito tempo di percorso.
- **Sposta o duplica un impegno trascinandolo**: un trascinamento normale
  sposta l'impegno. Tenendolo premuto circa mezzo secondo prima di muoverlo
  (l'impegno pulsa per segnalarlo), invece, si sposta una copia e
  l'originale resta al suo posto — un modo rapido per duplicare un impegno
  senza passare dai menu.
- **Vista a 5 o 7 giorni**: in Impostazioni → Preferenze si può nascondere il
  weekend dalla vista settimanale. È solo un filtro visivo: eventuali
  impegni di sabato o domenica restano salvati e continuano a contare nei
  totali e nell'export.
- **Impegni ricorrenti**: aprendo un impegno appena creato compare "Ripeti
  questo impegno", con durate predefinite (4 settimane, 2/3/6 mesi, 1 anno) o
  una data personalizzata. Le occorrenze successive vengono create subito,
  una a settimana, con stato di fatturazione ripristinato a "da fatturare"
  per ciascuna. Eliminare un'occorrenza chiede se togliere anche quelle
  future della stessa serie.
- **Copia settimana precedente**: nel pannello di sinistra, un tasto copia
  tutti gli impegni della settimana appena trascorsa in quella che si sta
  guardando (utile quando una settimana ricalca la precedente ma non è una
  vera ricorrenza).
- **Esporta nel calendario del telefono**: un tasto genera un file `.ics`
  con solo gli impegni veri della settimana (titolo, orario, indirizzo,
  note) — i blocchi di spostamento non vengono mai esportati. Su iPad,
  aprirlo propone di aggiungerlo al Calendario di sistema.
- **Sincronizzazione tra dispositivi**: accedendo con lo stesso account
  Google, i dati restano allineati in tempo reale su tutti i dispositivi —
  vedi la sezione dedicata più sotto per la configurazione.

## Sincronizzazione tra dispositivi (Firebase)

Categorie, indirizzi, impegni e impostazioni vivono su Firebase invece che
solo nel browser di un dispositivo: accedendo con lo stesso account Google
su più dispositivi, i dati restano sincronizzati automaticamente e in tempo
reale — e continuano a funzionare offline, risincronizzandosi da soli
appena torna la connessione.

### Configurazione (una tantum, circa 10 minuti)

1. Vai su https://console.firebase.google.com → "Aggiungi progetto" → dai
   un nome (es. "agenda-federica") → puoi disattivare Google Analytics,
   non serve → Crea.
2. Nel menu a sinistra, "Build → Authentication" → "Inizia" → scheda
   "Sign-in method" → attiva il provider "Google" → scegli un'email di
   supporto del progetto → Salva.
3. "Build → Firestore Database" → "Crea database" → **modalità
   produzione** → scegli una posizione **in Europa** (es. `eur3
   (europe-west)`) → Crea.
4. Nella scheda "Regole" di Firestore, sostituisci il contenuto con:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```
   poi "Pubblica". Così chiunque acceda con un account Google legge e
   scrive solo i propri dati, mai quelli di un altro account — ma non c'è
   restrizione su CHI può accedere: chiunque trovi l'URL può accedere e
   crearsi la propria agenda separata.
5. Icona a forma di ingranaggio → "Impostazioni progetto" → scheda
   "Generali" → in fondo, "Le tue app" → icona `</>` (Web) → dai un nome
   (es. "agenda-web") → **non** selezionare Firebase Hosting (si usa già
   GitHub Pages) → Registra app. Copia l'oggetto `firebaseConfig` mostrato
   a schermo.
6. Apri `firebase-config.js` in questo repository e incolla quei valori al
   posto dei segnaposto `INCOLLA_QUI_...`.
7. Ancora in Authentication → scheda "Settings" → "Authorized domains" →
   "Aggiungi dominio" → inserisci `tuoutente.github.io` (il dominio dove è
   pubblicata l'app). Senza questo passaggio l'accesso con Google fallisce
   con un errore "unauthorized-domain".
8. `ALLOWED_EMAILS` in `firebase-config.js` è vuoto: significa che chiunque
   con un account Google può accedere. Per limitarlo in futuro a poche
   email specifiche, rimettile lì E nelle regole del punto 4 (deve essere
   la stessa lista in entrambi i posti).

Fatto questo, aprendo l'app compare una schermata "Accedi con Google": il
primo accesso su ogni dispositivo va fatto una volta sola, poi la sessione
resta attiva. Se un dispositivo aveva già dei dati salvati da prima di
questa configurazione, al primo accesso l'app chiede se importarli
nell'account appena collegato, invece di lasciarli semplicemente indietro.

Il piano gratuito di Firebase (Spark) include 50.000 letture e 20.000
scritture al giorno su Firestore — molto più di quanto serva a un uso
personale, senza bisogno di inserire una carta di credito.

## Nota sulla stima fiscale

Il calcolo del netto riproduce lo schema tipico del regime forfettario
(coefficiente di redditività → imponibile → contributi previdenziali →
imposta sostitutiva). È pensato per farsi un'idea, non sostituisce il
commercialista — soprattutto se l'iscrizione previdenziale è a una cassa
specifica (es. ENPAP per gli psicologi) invece che alla Gestione Separata
INPS, perché in quel caso i contributi si calcolano diversamente (quota fissa
+ integrativo, non solo percentuale sul reddito).

## Nota sui tempi di spostamento

Indirizzi e percorsi stradali usano servizi pubblici gratuiti
(OpenStreetMap Nominatim per geocodificare gli indirizzi, OSRM per il tempo di
guida). Sono gratuiti ma non garantiti al 100%: se un servizio non risponde,
l'app calcola comunque una stima approssimativa in base alla distanza in linea
d'aria, e in ogni caso ogni tempo è correggibile a mano. Per un uso più
intenso o maggiore affidabilità, le due funzioni in `geo.js`
(`geocodeAddress` e `routeDriving`) possono essere sostituite con una API a
pagamento (Google Maps, Mapbox) con relativa chiave.

## Icona

L'icona dell'app in questo repository è in formato SVG (`icons/icon.svg`)
invece che PNG: è una scelta tecnica per rendere il file facilmente
versionabile come testo. Funziona per l'installazione su Home Screen sulle
versioni recenti di iOS/Safari; se su un dispositivo più datato l'icona non
comparisse, si può sostituire con un PNG dello stesso design caricandolo
direttamente su GitHub e aggiornando i riferimenti in `index.html` e
`manifest.json`.

## Pubblicare su GitHub Pages

1. Nelle impostazioni del repository → Pages, scegli il branch da pubblicare
   (`main`) e la cartella `/ (root)`, poi salva.
2. Il file `.nojekyll` incluso evita che GitHub Pages ignori file o cartelle
   che iniziano con `_` o li processi con Jekyll.
3. Tutti i percorsi nei file sono relativi (`./style.css`, ecc.), quindi
   funziona su `tuoutente.github.io/nome-repo` senza modifiche.
4. Apri il sito da Safari su iPad, tocca l'icona di condivisione → "Aggiungi
   a Home" per installarlo come app a schermo intero.

## Dati e backup

Da quando c'è la sincronizzazione, i dati vivono su Firestore (nel
progetto Firebase creato apposta), non più solo nel browser del
dispositivo. Restano privati: solo l'account Google autorizzato può
leggerli o scriverli, secondo le regole di sicurezza descritte sopra.
Firestore mantiene comunque una copia locale per l'uso offline, che si
risincronizza da sola alla riconnessione.

"Esporta dati (JSON)" resta comunque utile come backup indipendente, a
parte da Firebase.

## Struttura dei file

```
index.html          markup dell'app + schermata di accesso
style.css            stile e token di design
firebase-config.js   configurazione Firebase (da compilare, vedi sopra)
auth.js              accesso con Google, gestisce lo stato di autenticazione
db.js                livello dati su Firestore (stessa interfaccia di prima) + migrazione dati vecchi
sync.js              ascolta Firestore in tempo reale e aggiorna la vista
geo.js               geocoding indirizzi + calcolo tempi di guida (con cache)
finance.js           calcolo lordo → netto
app.js               stato, rendering calendario, drag & drop, finestre modali
manifest.json / sw.js / icons/   installabilità come PWA
```
