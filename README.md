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

Tutti i dati (categorie, indirizzi, impegni, impostazioni) restano nel
browser tramite IndexedDB — non vengono inviati a nessun server. Questo
significa che i dati sono legati al dispositivo/browser usato: usa
"Esporta dati (JSON)" ogni tanto per avere un backup, soprattutto prima di
cambiare dispositivo o svuotare la cache del browser.

## Struttura dei file

```
index.html   markup dell'app
style.css    stile e token di design
db.js        livello IndexedDB (categorie, indirizzi, impegni, impostazioni)
geo.js       geocoding indirizzi + calcolo tempi di guida (con cache)
finance.js   calcolo lordo → netto
app.js       stato, rendering calendario, drag & drop, finestre modali
manifest.json / sw.js / icons/   installabilità come PWA
```
