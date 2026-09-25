/* ============================================================
   auth.js — Google sign-in via Firebase Authentication
   ------------------------------------------------------------
   Gates the whole app behind sign-in: every device signed in
   with the same Google account sees the same synced data (see
   db.js and sync.js).
   ------------------------------------------------------------
   Uses signInWithPopup rather than signInWithRedirect: this app
   is hosted on GitHub Pages (rcarloni93.github.io), a different
   origin from Firebase's authDomain (agenda-federica.firebaseapp.com).
   The redirect flow needs to share session state between those two
   origins, which Safari (and increasingly Chrome) blocks by default
   as third-party storage — Google confirms the sign-in, but the app
   never finds out. A popup avoids this: the result comes back via a
   direct postMessage between windows instead of shared storage.
   If the popup is blocked, we fall back to redirect as a last resort.
   Note: on an installed home-screen PWA on iPad, popups can behave
   oddly (iOS may not support a real popup window there) — if sign-in
   ever misbehaves specifically in that installed-app context, that's
   the next thing to look at; it works fine in a normal Safari tab.
   ============================================================ */

let unsubscribers = [];
let appStarted = false;

function showAuthScreen(message){
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
  const err = document.getElementById('authError');
  if (message){ err.textContent = message; err.classList.remove('hidden'); }
  else { err.classList.add('hidden'); err.textContent = ''; }
}

function showApp(){
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

function detachRealtimeListeners(){
  unsubscribers.forEach(u => { try { u(); } catch(e){} });
  unsubscribers = [];
}

async function startApp(){
  await migrateOldLocalDataIfAny();
  await init(); // defined in app.js: ensureSeedData + loadAllData + wireTopLevel + refreshAll
  attachRealtimeListeners();
}

function initAuth(){
  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});

  try {
    firebase.firestore().enablePersistence({ synchronizeTabs: true })
      .catch((err)=> console.warn('Persistenza offline non attiva:', err.code));
  } catch(e){ /* already enabled, e.g. multiple calls during dev reloads */ }

  document.getElementById('googleSignInBtn').addEventListener('click', async ()=>{
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await auth.signInWithPopup(provider);
      // onAuthStateChanged below picks up the result from here.
    } catch (err){
      if (err && err.code === 'auth/popup-closed-by-user') return; // they just closed it, not a real error
      if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request')){
        try { await auth.signInWithRedirect(provider); }
        catch (err2){ showAuthScreen('Accesso non riuscito: ' + err2.message); }
        return;
      }
      showAuthScreen('Accesso non riuscito: ' + err.message);
    }
  });

  auth.onAuthStateChanged(async (user)=>{
    if (user){
      if (typeof ALLOWED_EMAILS !== 'undefined' && Array.isArray(ALLOWED_EMAILS) && ALLOWED_EMAILS.length
          && !ALLOWED_EMAILS.includes(user.email)){
        showAuthScreen(`Questo account (${user.email}) non è autorizzato a usare questa agenda.`);
        await auth.signOut();
        return;
      }
      window.CURRENT_UID = user.uid;
      window.CURRENT_USER_EMAIL = user.email;
      showApp();
      if (!appStarted){
        appStarted = true;
        await startApp();
      }
    } else {
      appStarted = false;
      window.CURRENT_UID = null;
      window.CURRENT_USER_EMAIL = null;
      detachRealtimeListeners();
      showAuthScreen();
    }
  });

  // Only relevant if we fell back to signInWithRedirect above.
  auth.getRedirectResult().catch((err)=>{
    if (err && err.code && err.code !== 'auth/no-auth-event'){
      showAuthScreen('Accesso non riuscito: ' + err.message);
    }
  });
}

// Exposed for the "Esci" button in Impostazioni → Account (see app.js).
async function signOutOfApp(){
  detachRealtimeListeners();
  await firebase.auth().signOut();
}

initAuth();
