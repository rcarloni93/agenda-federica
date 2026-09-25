/* ============================================================
   firebase-config.js — incolla qui i valori da:
   Firebase Console → Impostazioni progetto → Le tue app → Web app
   (vedi README.md, sezione "Sincronizzazione tra dispositivi")
   ------------------------------------------------------------
   Questi valori sono identificatori pubblici, non segreti: è
   normale (e previsto da Firebase) che stiano in un repository
   pubblico. Quello che protegge davvero i dati è la combinazione
   di richiedere l'accesso con Google + le regole di sicurezza di
   Firestore descritte nel README, non la segretezza di questo file.
   ============================================================ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD6JEIg2WF8BDdUnZ32gxwf5jHMiCvz4dY",
  authDomain: "agenda-federica.firebaseapp.com",
  projectId: "agenda-federica",
  storageBucket: "agenda-federica.firebasestorage.app",
  messagingSenderId: "936188869138",
  appId: "1:936188869138:web:465b391c1188a5a145f6cb",
};

// Ognuno di questi account ha i propri dati separati (la propria agenda,
// non condivisa con gli altri): questa lista serve solo a decidere CHI può
// accedere all'app. Per aggiungere o togliere una persona, modifica questa
// lista E la lista identica nelle regole di sicurezza di Firestore (vedi
// README) — quella è il controllo che conta davvero, lato server; questa
// qui è solo il messaggio mostrato nell'app a chi non è autorizzato.
const ALLOWED_EMAILS = [
  'rcarloni93@gmail.com',
  'fedecommi98@gmail.com',
  'federica.commisso98@gmail.com',
];
