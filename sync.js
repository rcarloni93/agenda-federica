/* ============================================================
   sync.js — keeps state.* mirrored to Firestore in real time, so
   a change made on one device (or by this same device's own
   write) shows up in the UI immediately, and a change made on a
   different device signed into the same account appears here too
   without a manual refresh.
   ============================================================ */
function attachRealtimeListeners(){
  const root = firebase.firestore().collection('users').doc(window.CURRENT_UID);

  unsubscribers.push(root.collection('categories').onSnapshot((snap)=>{
    state.categories = snap.docs.map(d=>d.data());
    rebuildIndexes();
    renderSidebarCategories();
    renderCalendarGrid();
    renderSummaryPanel();
  }, (err)=> console.warn('Sync categorie non riuscita:', err)));

  unsubscribers.push(root.collection('locations').onSnapshot((snap)=>{
    state.locations = snap.docs.map(d=>d.data());
    rebuildIndexes();
    renderCalendarGrid();
    renderSummaryPanel();
  }, (err)=> console.warn('Sync indirizzi non riuscita:', err)));

  unsubscribers.push(root.collection('events').onSnapshot((snap)=>{
    state.events = snap.docs.map(d=>d.data());
    renderCalendarGrid();
    renderSummaryPanel();
  }, (err)=> console.warn('Sync impegni non riuscita:', err)));

  unsubscribers.push(root.collection('settings').doc('main').onSnapshot((doc)=>{
    if (doc.exists){
      state.settings = doc.data();
      renderWeekChrome();
      renderCalendarGrid();
      renderSummaryPanel();
    }
  }, (err)=> console.warn('Sync impostazioni non riuscita:', err)));
}
