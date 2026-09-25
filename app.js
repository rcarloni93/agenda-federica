/* ============================================================
   app.js — UI state, calendar rendering, drag & drop, modals
   ============================================================ */

const PALETTE = ['#2F6F6B','#B5573F','#C98A3B','#3E6B8A','#7A5C8E','#4C7A3E','#A24B72','#5C6B23','#8A5A2E','#2B5F8A','#8B3A3A','#255A52'];

const LOCATION_TYPES = {
  sede: 'Sede di lavoro (centro / studio)',
  domicilio: 'Domicilio del paziente / famiglia',
  residenza: 'Mia residenza',
};

const state = {
  categories: [], locations: [], events: [], settings: null,
  categoriesById: {}, locationsById: {},
  weekStart: startOfWeek(new Date(), 1),
  summaryPeriod: 'week',
  renderToken: 0,
};

/* ---------------- date helpers ---------------- */
function pad2(n){ return String(n).padStart(2,'0'); }
function toISODate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function parseISODate(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(d,n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function startOfWeek(d, weekStartsOn){
  const day = d.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate()-diff);
  return r;
}
function timeToMinutes(t){ const [h,m]=t.split(':').map(Number); return h*60+m; }
function minutesToTime(m){ m=((m%1440)+1440)%1440; return `${pad2(Math.floor(m/60))}:${pad2(m%60)}`; }
const IT_DOW = ['dom','lun','mar','mer','gio','ven','sab'];
const IT_MONTHS = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];

function weekLabel(weekStart){
  const end = addDays(weekStart, 6);
  if (weekStart.getMonth() === end.getMonth()){
    return `${weekStart.getDate()}–${end.getDate()} ${IT_MONTHS[end.getMonth()]} ${end.getFullYear()}`;
  }
  return `${weekStart.getDate()} ${IT_MONTHS[weekStart.getMonth()]} – ${end.getDate()} ${IT_MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}

function hourPx(){
  const v = getComputedStyle(document.documentElement).getPropertyValue('--hour-h').trim();
  return parseFloat(v) || 64;
}

/* ---------------- data load ---------------- */
async function loadAllData(){
  state.categories = await DB.getAll('categories');
  state.locations = await DB.getAll('locations');
  state.events = await DB.getAll('events');
  state.settings = await DB.get('settings', 'main');
  rebuildIndexes();
}
function rebuildIndexes(){
  state.categoriesById = Object.fromEntries(state.categories.map(c=>[c.id,c]));
  state.locationsById = Object.fromEntries(state.locations.map(l=>[l.id,l]));
}

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.add('hidden'), 3200);
}

/* ============================================================
   RENDER: sidebar categories
   ============================================================ */
function renderSidebarCategories(){
  const list = document.getElementById('categoryList');
  list.innerHTML = '';
  state.categories.forEach(cat=>{
    const chip = document.createElement('div');
    chip.className = 'category-chip';
    chip.dataset.categoryId = cat.id;
    chip.innerHTML = `
      <span class="dot" style="background:${cat.color}"></span>
      <span class="label">${escapeHTML(cat.name)}</span>
      <span class="rate">€${cat.defaultRateGross}/h</span>
      <button class="edit-dot" title="Modifica categoria" data-edit-cat="${cat.id}">
        <svg width="13" height="13" viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      </button>`;
    list.appendChild(chip);
    attachCategoryDrag(chip, cat);
    chip.querySelector('[data-edit-cat]').addEventListener('click', (e)=>{
      e.stopPropagation();
      openCategoryModal(cat);
    });
  });
}
function escapeHTML(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ============================================================
   RENDER: week header + time column
   ============================================================ */
function renderWeekChrome(){
  document.getElementById('weekLabel').textContent = weekLabel(state.weekStart);

  const header = document.getElementById('daysHeader');
  header.innerHTML = '';
  const todayISO = toISODate(new Date());
  for (let i=0;i<7;i++){
    const d = addDays(state.weekStart, i);
    const iso = toISODate(d);
    const div = document.createElement('div');
    div.className = 'day-head' + (iso===todayISO ? ' is-today' : '');
    div.innerHTML = `<div class="dow">${IT_DOW[d.getDay()]}</div><div class="dnum">${d.getDate()}</div>`;
    header.appendChild(div);
  }

  const { dayStartHour, dayEndHour } = state.settings;
  const hpx = hourPx();
  const totalMin = (dayEndHour-dayStartHour)*60;
  const timeCol = document.getElementById('timeCol');
  timeCol.style.height = (totalMin/60*hpx)+'px';
  timeCol.innerHTML = '';
  for (let h=dayStartHour; h<=dayEndHour; h++){
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.top = ((h-dayStartHour)*hpx)+'px';
    tick.textContent = `${h}:00`;
    timeCol.appendChild(tick);
  }
}

/* ============================================================
   RENDER: calendar grid + events + travel segments
   ============================================================ */
function layoutOverlaps(events){
  const sorted = [...events].sort((a,b)=> a._startMin - b._startMin || a._endMin - b._endMin);
  const columns = [];
  sorted.forEach(evt=>{
    let placedCol = -1;
    for (let i=0;i<columns.length;i++){
      const lastInCol = columns[i][columns[i].length-1];
      if (evt._startMin >= lastInCol._endMin){ placedCol = i; break; }
    }
    if (placedCol === -1){ columns.push([evt]); placedCol = columns.length-1; }
    else columns[placedCol].push(evt);
    evt._col = placedCol;
  });
  const colCount = Math.max(1, columns.length);
  sorted.forEach(evt => evt._colCount = colCount);
  return sorted;
}

async function renderCalendarGrid(){
  const myToken = ++state.renderToken;
  const grid = document.getElementById('daysGrid');
  grid.innerHTML = '';
  const { dayStartHour, dayEndHour, showHomeTravel, homeLocationId } = state.settings;
  const hpx = hourPx();
  const totalMin = (dayEndHour-dayStartHour)*60;
  const todayISO = toISODate(new Date());
  const weekConflicts = [];
  const dayCols = [];

  for (let i=0;i<7;i++){
    const d = addDays(state.weekStart, i);
    const iso = toISODate(d);
    const col = document.createElement('div');
    col.className = 'day-col' + (iso===todayISO ? ' is-today' : '');
    col.style.height = (totalMin/60*hpx)+'px';
    col.dataset.date = iso;
    grid.appendChild(col);
    dayCols.push(col);

    const dayEvents = state.events
      .filter(e=>e.date===iso)
      .map(e=>({...e, _startMin: timeToMinutes(e.start), _endMin: timeToMinutes(e.end)}));
    layoutOverlaps(dayEvents);

    dayEvents.forEach(evt=>{
      col.appendChild(buildEventEl(evt, dayStartHour, hpx));
    });

    if (iso === todayISO) col.appendChild(buildNowLine(dayStartHour, hpx));
  }

  attachGridDropHandling();

  // async: travel segments + conflicts (progressive enhancement, doesn't block paint)
  for (let i=0;i<7;i++){
    const iso = toISODate(addDays(state.weekStart, i));
    const dayEvents = state.events
      .filter(e=>e.date===iso)
      .map(e=>({...e, _startMin: timeToMinutes(e.start), _endMin: timeToMinutes(e.end)}))
      .sort((a,b)=>a._startMin-b._startMin);
    if (!dayEvents.length) continue;

    for (let k=0;k<dayEvents.length-1;k++){
      const a = dayEvents[k], b = dayEvents[k+1];
      const gap = b._startMin - a._startMin - (a._endMin - a._startMin);
      const gapMin = b._startMin - a._endMin;
      if (gapMin < 0) continue; // overlapping, skip travel visual
      const locA = state.locationsById[a.locationId];
      const locB = state.locationsById[b.locationId];
      if (!locA || !locB || a.locationId === b.locationId) continue;

      const travel = await Geo.getTravel(locA, locB);
      if (myToken !== state.renderToken) return; // a newer render started, discard

      const conflict = !travel.unknown && gapMin < travel.durationMin;
      if (conflict){
        weekConflicts.push({
          dateLabel: `${IT_DOW[parseISODate(iso).getDay()]} ${parseISODate(iso).getDate()}`,
          from: catNameFor(a), to: catNameFor(b),
          have: gapMin, need: travel.durationMin,
        });
      }
      const col = dayCols[i];
      col.appendChild(buildTravelSegment(a, travel, gapMin, conflict, dayStartHour, hpx));
    }

    // home travel hints (informational, shown on first/last event of the day)
    if (showHomeTravel && homeLocationId && state.locationsById[homeLocationId]){
      const home = state.locationsById[homeLocationId];
      const first = dayEvents[0], last = dayEvents[dayEvents.length-1];
      if (first && state.locationsById[first.locationId] && first.locationId !== homeLocationId){
        const t = await Geo.getTravel(home, state.locationsById[first.locationId]);
        if (myToken !== state.renderToken) return;
        if (!t.unknown) addHomeHint(dayCols[i], first, dayStartHour, hpx, `🏠→ ${t.durationMin} min prima`, 'before');
      }
      if (last && state.locationsById[last.locationId] && last.locationId !== homeLocationId){
        const t = await Geo.getTravel(state.locationsById[last.locationId], home);
        if (myToken !== state.renderToken) return;
        if (!t.unknown) addHomeHint(dayCols[i], last, dayStartHour, hpx, `→🏠 ${t.durationMin} min dopo`, 'after');
      }
    }
  }

  renderConflictBanner(weekConflicts);
}

function catNameFor(evt){
  const c = state.categoriesById[evt.categoryId];
  return evt.title || (c ? c.name : 'Impegno');
}

function buildNowLine(dayStartHour, hpx){
  const now = new Date();
  const mins = now.getHours()*60+now.getMinutes() - dayStartHour*60;
  const line = document.createElement('div');
  line.className = 'now-line';
  line.style.top = (mins/60*hpx)+'px';
  return line;
}

function buildEventEl(evt, dayStartHour, hpx){
  const cat = state.categoriesById[evt.categoryId];
  const color = cat ? cat.color : '#888';
  const top = (evt._startMin - dayStartHour*60)/60*hpx;
  const height = Math.max(18, (evt._endMin - evt._startMin)/60*hpx);
  const widthPct = 100/evt._colCount;
  const leftPct = evt._col*widthPct;

  const el = document.createElement('div');
  el.className = 'evt' + (height < 40 ? ' short' : '');
  el.dataset.eventId = evt.id;
  el.style.top = top+'px';
  el.style.height = height+'px';
  el.style.left = `calc(${leftPct}% + 2px)`;
  el.style.width = `calc(${widthPct}% - 4px)`;
  el.style.background = hexToTint(color, .16);
  el.style.borderLeftColor = color;
  el.style.color = shade(color, -35);

  const loc = state.locationsById[evt.locationId];
  el.innerHTML = `
    <div class="evt-title">${escapeHTML(evt.title || (cat?cat.name:'Impegno'))}</div>
    <div class="evt-time">${evt.start}–${evt.end}</div>
    ${loc ? `<div class="evt-loc">${escapeHTML(loc.name)}</div>` : ''}
    <div class="resize-handle"></div>`;

  attachEventDrag(el, evt);
  return el;
}

function addHomeHint(col, evt, dayStartHour, hpx, text, pos){
  const el = col.querySelector(`.evt[data-event-id="${evt.id}"] .evt-loc`);
  const target = col.querySelector(`.evt[data-event-id="${evt.id}"]`);
  if (!target) return;
  const hint = document.createElement('div');
  hint.className = 'evt-loc';
  hint.style.opacity = '0.9';
  hint.textContent = text;
  target.appendChild(hint);
}

function buildTravelSegment(fromEvt, travel, gapMin, conflict, dayStartHour, hpx){
  const top = (fromEvt._endMin - dayStartHour*60)/60*hpx;
  const height = Math.max(10, gapMin/60*hpx);
  const el = document.createElement('div');
  el.className = 'travel-seg' + (conflict ? ' conflict' : '');
  el.style.top = top+'px';
  el.style.height = height+'px';
  const label = height > 16
    ? `🚗 ${travel.durationMin} min${conflict ? ' · manca tempo!' : ''}`
    : '🚗';
  el.innerHTML = `<span class="ico"></span><span>${label}</span>`;
  el.title = conflict
    ? `Servono ~${travel.durationMin} min per spostarsi, ne hai ${gapMin}.`
    : `Spostamento stimato: ~${travel.durationMin} min (${travel.source==='manuale'?'inserito a mano':travel.source==='stima'?'stima approssimativa':'percorso stradale'})`;
  return el;
}

function hexToTint(hex, alpha){
  const {r,g,b} = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
function hexToRgb(hex){
  hex = hex.replace('#','');
  if (hex.length===3) hex = hex.split('').map(c=>c+c).join('');
  const num = parseInt(hex,16);
  return { r:(num>>16)&255, g:(num>>8)&255, b:num&255 };
}
function shade(hex, percent){
  const {r,g,b} = hexToRgb(hex);
  const f = (c)=> Math.max(0, Math.min(255, Math.round(c + (percent/100)*255)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function renderConflictBanner(conflicts){
  const el = document.getElementById('conflictBanner');
  if (!conflicts.length){ el.classList.add('hidden'); el.innerHTML=''; return; }
  el.classList.remove('hidden');
  el.innerHTML = `<strong>${conflicts.length} spostamento${conflicts.length>1?'i':''} troppo stretto${conflicts.length>1?'i':''}</strong>` +
    conflicts.slice(0,4).map(c=>`${c.dateLabel}: da "${escapeHTML(c.from)}" a "${escapeHTML(c.to)}" servono ~${c.need} min, ce ne sono ${c.have}.`).join('<br>') +
    (conflicts.length>4 ? `<br>+ altri ${conflicts.length-4}` : '');
}

/* ============================================================
   RENDER: summary / earnings panel
   ============================================================ */
function eventsInRange(fromISO, toISO){
  return state.events.filter(e=> e.date >= fromISO && e.date <= toISO);
}

function renderSummaryPanel(){
  let fromISO, toISO, rangeLabel;
  if (state.summaryPeriod === 'week'){
    fromISO = toISODate(state.weekStart);
    toISO = toISODate(addDays(state.weekStart,6));
    rangeLabel = weekLabel(state.weekStart);
  } else {
    const first = new Date(state.weekStart.getFullYear(), state.weekStart.getMonth(), 1);
    const last = new Date(state.weekStart.getFullYear(), state.weekStart.getMonth()+1, 0);
    fromISO = toISODate(first); toISO = toISODate(last);
    rangeLabel = `${IT_MONTHS[first.getMonth()]} ${first.getFullYear()}`;
  }
  const evts = eventsInRange(fromISO, toISO);
  const grossTotal = evts.reduce((sum,e)=> sum + eventGross(e, state.categoriesById), 0);
  const calc = computeNetEstimate(grossTotal, state.settings);
  const totalHours = evts.reduce((sum,e)=> sum + eventDurationHours(e), 0);

  const byCat = {};
  evts.forEach(e=>{
    const key = e.categoryId || '—';
    byCat[key] = byCat[key] || { gross:0, hours:0 };
    byCat[key].gross += eventGross(e, state.categoriesById);
    byCat[key].hours += eventDurationHours(e);
  });

  const byStatus = { da_fatturare:0, fatturata:0, incassata:0 };
  evts.forEach(e=>{ byStatus[e.billingStatus||'da_fatturare'] += eventGross(e, state.categoriesById); });

  const body = document.getElementById('summaryBody');
  body.innerHTML = `
    <p class="hint" style="margin:-4px 0 12px;color:var(--ink-faint);font-size:11.5px;">${rangeLabel} · ${totalHours.toFixed(1).replace('.0','')} h lavorate</p>
    <div class="money-row"><span class="lbl">Lordo fatturato</span><span class="val">${fmtEUR(calc.lordo)}</span></div>
    <div class="money-row sub"><span class="lbl">Reddito imponibile (${Math.round(state.settings.coefficienteRedditivita*100)}%)</span><span class="val">${fmtEUR(calc.imponibile)}</span></div>
    <div class="money-row sub"><span class="lbl">Contributi previdenziali</span><span class="val">− ${fmtEUR(calc.contributi)}</span></div>
    <div class="money-row sub"><span class="lbl">Imposta sostitutiva</span><span class="val">− ${fmtEUR(calc.impostaSostitutiva)}</span></div>
    <div class="money-row total"><span class="lbl">Netto stimato<span class="estimate-tag">stima</span></span><span class="val">${fmtEUR(calc.netto)}</span></div>

    <div class="cat-breakdown">
      <h3>Per categoria</h3>
      ${Object.entries(byCat).map(([catId,v])=>{
        const c = state.categoriesById[catId];
        return `<div class="cat-row"><span class="dot" style="background:${c?c.color:'#999'}"></span><span class="nm">${c?escapeHTML(c.name):'Senza categoria'}</span><span class="amt">${fmtEUR(v.gross)}</span></div>`;
      }).join('') || '<p class="hint" style="font-size:11.5px;">Nessun impegno in questo periodo.</p>'}
    </div>

    <div class="billing-status-group">
      <h3 style="font-size:12px;color:var(--ink-soft);margin-bottom:8px;">Da fatturare</h3>
      <span class="status-pill" data-status="da_fatturare">Da fatturare · ${fmtEUR(byStatus.da_fatturare)}</span>
      <span class="status-pill" data-status="fatturata">Fatturata · ${fmtEUR(byStatus.fatturata)}</span>
      <span class="status-pill" data-status="incassata">Incassata · ${fmtEUR(byStatus.incassata)}</span>
    </div>
  `;
}
