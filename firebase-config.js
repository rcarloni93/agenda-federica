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
  apiKey: "INCOLLA_QUI_apiKey",
  authDomain: "INCOLLA_QUI_authDomain",
  projectId: "INCOLLA_QUI_projectId",
  storageBucket: "INCOLLA_QUI_storageBucket",
  messagingSenderId: "INCOLLA_QUI_messagingSenderId",
  appId: "INCOLLA_QUI_appId",
};

// Se impostato, solo questo indirizzo Google potrà accedere all'app anche
// se qualcuno trova l'URL pubblico su GitHub Pages. Lascia null per
// permettere l'accesso a qualsiasi account Google (va bene per uso
// personale/familiare a basso rischio).
const ALLOWED_EMAIL = null; // esempio: 'federica.rossi@gmail.com'
