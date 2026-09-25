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

// Minutes of otherwise-idle time (free time minus the direct A->B travel)
// beyond which it's worth suggesting a trip home instead of just waiting.
const HOME_SUGGESTION_MIN_IDLE = 90;

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

function weekLabel(weekStart, viewDays=7){
  const end = addDays(weekStart, viewDays-1);
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
  const viewDays = state.settings.viewDays || 7;
  document.getElementById('weekLabel').textContent = weekLabel(state.weekStart, viewDays);

  const header = document.getElementById('daysHeader');
  header.innerHTML = '';
  const todayISO = toISODate(new Date());
  for (let i=0;i<viewDays;i++){
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
  const viewDays = state.settings.viewDays || 7;
  const hpx = hourPx();
  const totalMin = (dayEndHour-dayStartHour)*60;
  const todayISO = toISODate(new Date());
  const weekConflicts = [];
  const dayCols = [];

  for (let i=0;i<viewDays;i++){
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
  for (let i=0;i<viewDays;i++){
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

      // If the free time is much bigger than what's needed to go straight from A
      // to B, check whether there's actually enough of it to pop home and back —
      // more useful than just idling somewhere between two appointments.
      let homeSuggestion = null;
      if (!conflict && !travel.unknown && showHomeTravel && homeLocationId && state.locationsById[homeLocationId]
          && locA.id !== homeLocationId && locB.id !== homeLocationId){
        const home = state.locationsById[homeLocationId];
        const [toHome, fromHome] = await Promise.all([Geo.getTravel(locA, home), Geo.getTravel(home, locB)]);
        if (myToken !== state.renderToken) return;
        if (!toHome.unknown && !fromHome.unknown){
          const roundTrip = toHome.durationMin + fromHome.durationMin;
          const idle = gapMin - travel.durationMin;
          if (roundTrip <= gapMin && idle >= HOME_SUGGESTION_MIN_IDLE){
            homeSuggestion = { roundTrip };
          }
        }
      }

      const col = dayCols[i];
      if (homeSuggestion){
        col.appendChild(buildTravelBlock(a._endMin, gapMin, dayStartHour, hpx, {
          label: Math.max(15, gapMin/60*hpx) > 22 ? '🏠 tempo per tornare a casa' : '🏠?',
          tooltip: `Hai ${gapMin} min liberi tra questi due impegni: bastano per tornare a casa e ripartire (~${homeSuggestion.roundTrip} min tra andata e ritorno), invece di aspettare in giro.`,
          suggestHome: true,
        }));
      } else {
        const label = Math.max(15, gapMin/60*hpx) > 16
          ? `🚗 ${travel.durationMin} min${conflict ? ' · manca tempo!' : ''}`
          : '🚗';
        col.appendChild(buildTravelBlock(a._endMin, gapMin, dayStartHour, hpx, {
          label,
          tooltip: conflict
            ? `Servono ~${travel.durationMin} min per spostarsi, ne hai ${gapMin}.`
            : `Spostamento stimato: ~${travel.durationMin} min (${travel.source==='manuale'?'inserito a mano':travel.source==='stima'?'stima approssimativa':'percorso stradale'})`,
          conflict,
        }));
      }
    }

    // home <-> first/last appointment of the day, drawn as their own blocks
    // exactly like the between-appointments travel above: the first block
    // ends right when the first appointment starts (leave-home time), the
    // last one starts right when the last appointment ends (arrive-home time).
    const gridStartAbsMin = dayStartHour*60, gridEndAbsMin = dayEndHour*60;
    if (showHomeTravel && homeLocationId && state.locationsById[homeLocationId]){
      const home = state.locationsById[homeLocationId];
      const first = dayEvents[0], last = dayEvents[dayEvents.length-1];
      if (first && state.locationsById[first.locationId] && first.locationId !== homeLocationId){
        const t = await Geo.getTravel(home, state.locationsById[first.locationId]);
        if (myToken !== state.renderToken) return;
        if (!t.unknown && t.durationMin > 0){
          const span = clampSpanToGrid(first._startMin - t.durationMin, t.durationMin, gridStartAbsMin, gridEndAbsMin);
          if (span){
            dayCols[i].appendChild(buildTravelBlock(span.start, span.dur, dayStartHour, hpx, {
              label: span.dur/60*hpx > 16 ? `🏠→ ${t.durationMin} min` : '🏠',
              tooltip: `Tempo stimato da casa: ~${t.durationMin} min`,
            }));
          }
        }
      }
      if (last && state.locationsById[last.locationId] && last.locationId !== homeLocationId){
        const t = await Geo.getTravel(state.locationsById[last.locationId], home);
        if (myToken !== state.renderToken) return;
        if (!t.unknown && t.durationMin > 0){
          const span = clampSpanToGrid(last._endMin, t.durationMin, gridStartAbsMin, gridEndAbsMin);
          if (span){
            dayCols[i].appendChild(buildTravelBlock(span.start, span.dur, dayStartHour, hpx, {
              label: span.dur/60*hpx > 16 ? `→🏠 ${t.durationMin} min` : '🏠',
              tooltip: `Tempo stimato per tornare a casa: ~${t.durationMin} min`,
            }));
          }
        }
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

// Renders a travel period as its own block in the day column — a "fake
// event" the same way a real appointment is drawn, so it's as visible as
// the appointments around it. topAbsMin/durMin are in absolute minutes
// since midnight (same convention as event._startMin/_endMin).
function buildTravelBlock(topAbsMin, durMin, dayStartHour, hpx, { label, tooltip, conflict = false, suggestHome = false }){
  const top = (topAbsMin - dayStartHour*60)/60*hpx;
  const height = Math.max(15, durMin/60*hpx);
  const el = document.createElement('div');
  el.className = 'travel-seg' + (conflict ? ' conflict' : '') + (suggestHome ? ' suggest-home' : '');
  el.style.top = top+'px';
  el.style.height = height+'px';
  el.innerHTML = `<span class="lbl">${label}</span>`;
  el.title = tooltip;
  return el;
}

// Clamps a [startAbsMin, startAbsMin+durMin] span to the visible grid
// range [gridStartAbsMin, gridEndAbsMin], shrinking the duration instead
// of letting the block run off the top/bottom edge. Returns null if
// nothing of it remains visible.
function clampSpanToGrid(startAbsMin, durMin, gridStartAbsMin, gridEndAbsMin){
  let start = startAbsMin, dur = durMin;
  if (start < gridStartAbsMin){ dur -= (gridStartAbsMin - start); start = gridStartAbsMin; }
  const end = start + dur;
  if (end > gridEndAbsMin){ dur -= (end - gridEndAbsMin); }
  if (dur <= 0) return null;
  return { start, dur };
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

/* ============================================================
   DRAG & DROP — pointer-based (works with touch on iPad, unlike
   HTML5 drag-and-drop which iOS Safari does not support well)
   ============================================================ */
const DRAG_THRESHOLD = 5;
const LONG_PRESS_MS = 480; // hold roughly half a second before moving to arm "duplicate"

function attachCategoryDrag(chipEl, category){
  chipEl.addEventListener('pointerdown', (e)=>{
    if (e.target.closest('[data-edit-cat]')) return;
    startDrag(e, {
      mode: 'create',
      category,
      onDrop: async (dateISO, startMin)=>{
        const dur = state.settings.defaultEventMinutes;
        const snapped = snap(startMin, state.settings.slotMinutes);
        const evt = {
          id: uid(),
          categoryId: category.id,
          locationId: category.defaultLocationId || null,
          title: '',
          date: dateISO,
          start: minutesToTime(snapped + state.settings.dayStartHour*60),
          end: minutesToTime(snapped + dur + state.settings.dayStartHour*60),
          rateGross: null,
          notes: '',
          billingStatus: 'da_fatturare',
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        await DB.put('events', evt);
        state.events.push(evt);
        await renderCalendarGrid();
        renderSummaryPanel();
        openEventModal(evt, { justCreated: true });
      },
    });
  });
}

function attachEventDrag(el, evt){
  el.addEventListener('pointerdown', (e)=>{
    if (e.target.classList.contains('resize-handle')){
      startResize(e, evt);
      return;
    }
    startDrag(e, {
      mode: 'move',
      evt,
      allowDuplicate: true,
      onTap: ()=> openEventModal(state.events.find(x=>x.id===evt.id)),
      onDrop: async (dateISO, startMin)=>{
        const durMin = evt._endMin - evt._startMin;
        const snapped = snap(startMin, state.settings.slotMinutes);
        const newStart = minutesToTime(snapped + state.settings.dayStartHour*60);
        const newEnd = minutesToTime(snapped + durMin + state.settings.dayStartHour*60);
        const fresh = state.events.find(x=>x.id===evt.id);
        fresh.date = dateISO; fresh.start = newStart; fresh.end = newEnd; fresh.updatedAt = Date.now();
        await DB.put('events', fresh);
        await renderCalendarGrid();
        renderSummaryPanel();
      },
      onDropDuplicate: async (dateISO, startMin)=>{
        const durMin = evt._endMin - evt._startMin;
        const snapped = snap(startMin, state.settings.slotMinutes);
        const newStart = minutesToTime(snapped + state.settings.dayStartHour*60);
        const newEnd = minutesToTime(snapped + durMin + state.settings.dayStartHour*60);
        const source = state.events.find(x=>x.id===evt.id) || evt;
        const copy = {
          ...source,
          id: uid(),
          date: dateISO,
          start: newStart,
          end: newEnd,
          billingStatus: 'da_fatturare',
          recurrenceId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await DB.put('events', copy);
        state.events.push(copy);
        await renderCalendarGrid();
        renderSummaryPanel();
        toast('Impegno duplicato.');
      },
    });
  });
}

function snap(min, slot){ return Math.round(min/slot)*slot; }

function startDrag(e, opts){
  e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  let moved = false;
  let duplicateArmed = false;
  let duplicateMode = false;
  const ghost = document.getElementById('dragGhost');
  const hpx = hourPx();
  const scrollEl = document.getElementById('calendarScroll');
  const gridEl = document.getElementById('daysGrid');
  let hint = null;

  const color = opts.mode==='create' ? opts.category.color : (state.categoriesById[opts.evt.categoryId]||{}).color || '#888';
  const label = opts.mode==='create' ? opts.category.name : (opts.evt.title || (state.categoriesById[opts.evt.categoryId]||{}).name || 'Impegno');
  const srcEvtEl = opts.mode==='move' ? document.querySelector(`.evt[data-event-id="${opts.evt.id}"]`) : null;

  if (opts.mode==='move'){
    if (srcEvtEl) srcEvtEl.classList.add('dragging');
  } else {
    const srcChip = document.querySelector(`.category-chip[data-category-id="${opts.category.id}"]`);
    if (srcChip) srcChip.classList.add('dragging-source');
  }

  // Holding still on an existing event for a beat "arms" duplicate mode:
  // if the person then drags, the ORIGINAL stays put and a copy moves.
  // Moving right away (before the timer fires) just moves the event as usual.
  let longPressTimer = null;
  if (opts.mode==='move' && opts.allowDuplicate){
    longPressTimer = setTimeout(()=>{
      if (moved) return;
      duplicateArmed = true;
      if (srcEvtEl) srcEvtEl.classList.add('duplicate-armed');
      if (navigator.vibrate) navigator.vibrate(12);
    }, LONG_PRESS_MS);
  }

  function onMove(ev){
    const dx = ev.clientX-startX, dy = ev.clientY-startY;
    if (!moved && Math.hypot(dx,dy) > DRAG_THRESHOLD){
      moved = true;
      if (longPressTimer){ clearTimeout(longPressTimer); longPressTimer = null; }
      if (duplicateArmed){
        duplicateMode = true;
      } else if (srcEvtEl){
        srcEvtEl.classList.remove('duplicate-armed');
      }
    }
    if (!moved) return;

    ghost.classList.remove('hidden');
    ghost.style.left = (ev.clientX+12)+'px';
    ghost.style.top = (ev.clientY+12)+'px';
    ghost.style.background = color;
    ghost.textContent = label + (duplicateMode ? ' (copia)' : '');

    const gridRect = gridEl.getBoundingClientRect();
    const x = ev.clientX - gridRect.left, y = ev.clientY - gridRect.top;
    if (x<0 || x>gridRect.width || y<0){ if(hint){hint.remove(); hint=null;} return; }

    const viewDays = state.settings.viewDays || 7;
    const dayW = gridRect.width/viewDays;
    let dayIdx = Math.floor(x/dayW);
    dayIdx = Math.max(0, Math.min(viewDays-1, dayIdx));
    let startMin = Math.round(y/hpx*60);
    startMin = Math.max(0, snap(startMin, state.settings.slotMinutes));

    const durMin = opts.mode==='create' ? state.settings.defaultEventMinutes : (opts.evt._endMin - opts.evt._startMin);
    if (!hint){ hint = document.createElement('div'); hint.className='dropzone-hint'; }
    const col = gridEl.children[dayIdx];
    if (col && !col.contains(hint)) col.appendChild(hint);
    hint.style.top = (startMin/60*hpx)+'px';
    hint.style.height = Math.max(16, durMin/60*hpx)+'px';

    hint.dataset.dateISO = toISODate(addDays(state.weekStart, dayIdx));
    hint.dataset.startMin = startMin;

    // autoscroll near edges
    const scrollRect = scrollEl.getBoundingClientRect();
    const edge = 34;
    if (ev.clientY < scrollRect.top+edge) scrollEl.scrollTop -= 12;
    else if (ev.clientY > scrollRect.bottom-edge) scrollEl.scrollTop += 12;
  }

  function onUp(ev){
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (longPressTimer) clearTimeout(longPressTimer);
    ghost.classList.add('hidden');
    if (srcEvtEl) srcEvtEl.classList.remove('dragging', 'duplicate-armed');
    const srcChip = document.querySelector(`.category-chip.dragging-source`);
    if (srcChip) srcChip.classList.remove('dragging-source');

    if (!moved){
      // A held-but-not-dragged press (duplicate armed then released in place)
      // is treated as an aborted gesture, not a tap, so it never surprises
      // the person with the editor popping open.
      if (!duplicateArmed && opts.onTap) opts.onTap();
      if (hint) hint.remove();
      return;
    }
    if (hint && hint.dataset.dateISO){
      if (duplicateMode && opts.onDropDuplicate) opts.onDropDuplicate(hint.dataset.dateISO, Number(hint.dataset.startMin));
      else opts.onDrop(hint.dataset.dateISO, Number(hint.dataset.startMin));
      hint.remove();
    } else if (hint){
      hint.remove();
    }
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function startResize(e, evt){
  e.preventDefault();
  e.stopPropagation();
  const hpx = hourPx();
  const startY = e.clientY;
  const el = document.querySelector(`.evt[data-event-id="${evt.id}"]`);
  const startHeight = el.getBoundingClientRect().height;
  const startMinTotal = timeToMinutes(evt.start);

  function onMove(ev){
    const dy = ev.clientY-startY;
    const newHeight = Math.max(16, startHeight+dy);
    el.style.height = newHeight+'px';
    const durMin = Math.max(state.settings.slotMinutes, snap(newHeight/hpx*60, state.settings.slotMinutes));
    el.querySelector('.evt-time').textContent = `${evt.start}–${minutesToTime(startMinTotal+durMin)}`;
  }
  async function onUp(ev){
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const dy = ev.clientY-startY;
    const newHeightMin = Math.max(state.settings.slotMinutes, snap((startHeight+dy)/hpx*60, state.settings.slotMinutes));
    const fresh = state.events.find(x=>x.id===evt.id);
    fresh.end = minutesToTime(startMinTotal+newHeightMin);
    fresh.updatedAt = Date.now();
    await DB.put('events', fresh);
    await renderCalendarGrid();
    renderSummaryPanel();
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function attachGridDropHandling(){ /* drop targets are handled generically inside startDrag via daysGrid geometry */ }

/* ============================================================
   MODALS — generic overlay helpers
   ------------------------------------------------------------
   Modals can nest (e.g. "+ Nuovo indirizzo" opened from inside
   "Gestisci indirizzi"). We keep a stack of open modal ids and
   always show only the top one, so a nested modal appears in
   front instead of underneath its parent. Closing pops the
   stack and reveals whatever was open before it, if anything.
   ============================================================ */
const MODAL_IDS = ['eventModal','categoryModal','locationModal','locationsManagerModal','settingsModal'];
let modalStack = [];

function applyModalStack(){
  MODAL_IDS.forEach(id => document.getElementById(id).classList.add('hidden'));
  if (modalStack.length){
    document.getElementById(modalStack[modalStack.length-1]).classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  } else {
    document.getElementById('overlay').classList.add('hidden');
  }
}
function showModal(id){
  modalStack.push(id);
  applyModalStack();
}
// Closes the topmost modal and reveals the one beneath it, if any.
// (Kept the old name so every existing call site — "Annulla", "Salva",
// "Elimina", the overlay click — keeps working without changes.)
function closeAllModals(){
  modalStack.pop();
  applyModalStack();
}
document.getElementById('overlay').addEventListener('click', closeAllModals);

/* ---------------- Event modal ---------------- */
const RECURRENCE_OPTIONS = [
  ['no', 'Non si ripete'],
  ['4w', 'Ogni settimana per 4 settimane'],
  ['2m', 'Ogni settimana per 2 mesi'],
  ['3m', 'Ogni settimana per 3 mesi'],
  ['6m', 'Ogni settimana per 6 mesi'],
  ['1y', 'Ogni settimana per 1 anno'],
  ['custom', 'Ogni settimana fino al…'],
];

function computeRecurrenceEndDate(baseDateStr, preset, customDateStr){
  const base = parseISODate(baseDateStr);
  switch(preset){
    case '4w': return addDays(base, 28);
    case '2m': return new Date(base.getFullYear(), base.getMonth()+2, base.getDate());
    case '3m': return new Date(base.getFullYear(), base.getMonth()+3, base.getDate());
    case '6m': return new Date(base.getFullYear(), base.getMonth()+6, base.getDate());
    case '1y': return new Date(base.getFullYear()+1, base.getMonth(), base.getDate());
    case 'custom': return customDateStr ? parseISODate(customDateStr) : base;
    default: return base;
  }
}

// Creates weekly copies of baseEvent (same weekday/time/category/location/
// rate/notes, billing reset to "da fatturare") from its own date up to
// endDate, all sharing one recurrenceId so they can later be recognised
// and deleted together. Capped at 104 weeks (~2 years) as a safety valve.
async function generateRecurrences(baseEvent, endDate){
  const recurrenceId = uid();
  baseEvent.recurrenceId = recurrenceId;
  await DB.put('events', baseEvent);
  const created = [baseEvent];
  let d = addDays(parseISODate(baseEvent.date), 7);
  const endTime = endDate.getTime();
  let guard = 0;
  while (d.getTime() <= endTime && guard < 104){
    const copy = {
      ...baseEvent,
      id: uid(),
      date: toISODate(d),
      billingStatus: 'da_fatturare',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await DB.put('events', copy);
    created.push(copy);
    d = addDays(d, 7);
    guard++;
  }
  return created;
}

function openEventModal(evt, opts={}){
  const justCreated = !!opts.justCreated;
  const modal = document.getElementById('eventModal');
  const cat = state.categoriesById[evt.categoryId];
  modal.innerHTML = `
    <h2>${justCreated ? 'Nuovo impegno' : 'Modifica impegno'}</h2>
    <div class="field">
      <label>Titolo (facoltativo)</label>
      <input type="text" id="f-title" value="${escapeHTML(evt.title||'')}" placeholder="${cat?escapeHTML(cat.name):'Impegno'}" />
    </div>
    <div class="field">
      <label>Categoria</label>
      <select id="f-category">
        ${state.categories.map(c=>`<option value="${c.id}" ${c.id===evt.categoryId?'selected':''}>${escapeHTML(c.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Sede / indirizzo</label>
      <select id="f-location">
        <option value="">— nessuna —</option>
        ${state.locations.map(l=>`<option value="${l.id}" ${l.id===evt.locationId?'selected':''}>${escapeHTML(l.name)}</option>`).join('')}
        <option value="__new__">+ Nuovo indirizzo…</option>
      </select>
    </div>
    <div class="row2 field">
      <div><label>Data</label><input type="date" id="f-date" value="${evt.date}" /></div>
    </div>
    <div class="row2 field">
      <div><label>Inizio</label><input type="time" id="f-start" value="${evt.start}" step="300" /></div>
      <div><label>Fine</label><input type="time" id="f-end" value="${evt.end}" step="300" /></div>
    </div>
    <div class="row2 field">
      <div><label>Tariffa oraria lorda (€)</label><input type="number" id="f-rate" min="0" step="1" value="${evt.rateGross!=null?evt.rateGross:''}" placeholder="${cat?cat.defaultRateGross:0}" /></div>
      <div><label>Stato fatturazione</label>
        <select id="f-status">
          <option value="da_fatturare" ${evt.billingStatus==='da_fatturare'?'selected':''}>Da fatturare</option>
          <option value="fatturata" ${evt.billingStatus==='fatturata'?'selected':''}>Fatturata</option>
          <option value="incassata" ${evt.billingStatus==='incassata'?'selected':''}>Incassata</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label>Note</label>
      <textarea id="f-notes" placeholder="Es. materiale da portare, riferimento paziente…">${escapeHTML(evt.notes||'')}</textarea>
    </div>
    ${justCreated ? `
    <div class="field">
      <label>Ripeti questo impegno</label>
      <select id="f-recur">
        ${RECURRENCE_OPTIONS.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
      </select>
      <input type="date" id="f-recur-until" class="hidden" style="margin-top:6px;" min="${evt.date}" />
    </div>` : (evt.recurrenceId ? `
    <p class="helper-text">Fa parte di una serie di impegni ricorrenti. Le modifiche qui sotto riguardano solo questa occorrenza.</p>` : '')}
    <div class="modal-actions">
      <button class="btn-danger-link" id="f-delete">Elimina impegno</button>
      <div style="display:flex;gap:8px;">
        <button class="btn-secondary" id="f-cancel">Annulla</button>
        <button class="btn-primary" id="f-save">Salva</button>
      </div>
    </div>
  `;

  if (justCreated){
    modal.querySelector('#f-recur').addEventListener('change', (e)=>{
      modal.querySelector('#f-recur-until').classList.toggle('hidden', e.target.value !== 'custom');
    });
  }

  modal.querySelector('#f-location').addEventListener('change', (e)=>{
    if (e.target.value === '__new__'){
      e.target.value = evt.locationId || '';
      openLocationModal(null, (newLoc)=>{
        const sel = modal.querySelector('#f-location');
        const opt = document.createElement('option');
        opt.value = newLoc.id; opt.textContent = newLoc.name; opt.selected = true;
        sel.insertBefore(opt, sel.lastElementChild);
      });
    }
  });

  modal.querySelector('#f-cancel').addEventListener('click', closeAllModals);
  modal.querySelector('#f-delete').addEventListener('click', async ()=>{
    if (!confirm('Eliminare questo impegno?')) return;
    let deleteFuture = false;
    if (evt.recurrenceId){
      deleteFuture = confirm('Fa parte di una serie ricorrente. Eliminare anche le occorrenze future della stessa serie?');
    }
    if (deleteFuture){
      const toDelete = state.events.filter(e => e.recurrenceId===evt.recurrenceId && e.date>=evt.date);
      for (const e of toDelete) await DB.remove('events', e.id);
      const idsToDelete = new Set(toDelete.map(e=>e.id));
      state.events = state.events.filter(e=>!idsToDelete.has(e.id));
    } else {
      await DB.remove('events', evt.id);
      state.events = state.events.filter(x=>x.id!==evt.id);
    }
    closeAllModals();
    await renderCalendarGrid();
    renderSummaryPanel();
  });
  modal.querySelector('#f-save').addEventListener('click', async ()=>{
    const start = modal.querySelector('#f-start').value;
    const end = modal.querySelector('#f-end').value;
    if (!start || !end || timeToMinutes(end) <= timeToMinutes(start)){
      toast('Controlla gli orari: la fine deve essere dopo l\u2019inizio.');
      return;
    }
    const rateVal = modal.querySelector('#f-rate').value;
    const fresh = {
      ...evt,
      title: modal.querySelector('#f-title').value.trim(),
      categoryId: modal.querySelector('#f-category').value,
      locationId: modal.querySelector('#f-location').value || null,
      date: modal.querySelector('#f-date').value,
      start, end,
      rateGross: rateVal === '' ? null : Number(rateVal),
      billingStatus: modal.querySelector('#f-status').value,
      notes: modal.querySelector('#f-notes').value,
      updatedAt: Date.now(),
    };
    if (!fresh.createdAt) fresh.createdAt = Date.now();
    await DB.put('events', fresh);
    const idx = state.events.findIndex(x=>x.id===fresh.id);
    if (idx>=0) state.events[idx] = fresh; else state.events.push(fresh);

    if (justCreated){
      const recurSel = modal.querySelector('#f-recur');
      if (recurSel.value !== 'no'){
        const customDateEl = modal.querySelector('#f-recur-until');
        const endDate = computeRecurrenceEndDate(fresh.date, recurSel.value, customDateEl.value);
        const allCreated = await generateRecurrences(fresh, endDate);
        allCreated.slice(1).forEach(c => state.events.push(c));
        toast(`Serie ricorrente creata: ${allCreated.length} occorrenze.`);
      }
    }

    closeAllModals();
    await renderCalendarGrid();
    renderSummaryPanel();
  });

  showModal('eventModal');
}

/* ---------------- Category modal ---------------- */
function openCategoryModal(cat){
  const isNew = !cat;
  const c = cat || { id: uid(), name:'', color: PALETTE[state.categories.length % PALETTE.length], defaultRateGross: 30, defaultLocationId: null };
  const modal = document.getElementById('categoryModal');
  modal.innerHTML = `
    <h2>${isNew?'Nuova categoria':'Modifica categoria'}</h2>
    <div class="field"><label>Nome (es. nome del centro, o "Tutoraggio")</label>
      <input type="text" id="c-name" value="${escapeHTML(c.name)}" placeholder="Es. Centro Sereno" /></div>
    <div class="field"><label>Colore</label>
      <div class="color-swatches" id="c-swatches">
        ${PALETTE.map(col=>`<span class="swatch ${col===c.color?'selected':''}" data-color="${col}" style="background:${col}"></span>`).join('')}
      </div>
    </div>
    <div class="field"><label>Tariffa oraria lorda predefinita (€)</label>
      <input type="number" id="c-rate" min="0" step="1" value="${c.defaultRateGross}" /></div>
    <div class="field"><label>Sede predefinita (facoltativa)</label>
      <select id="c-location">
        <option value="">— nessuna —</option>
        ${state.locations.map(l=>`<option value="${l.id}" ${l.id===c.defaultLocationId?'selected':''}>${escapeHTML(l.name)}</option>`).join('')}
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn-danger-link" id="c-delete" style="${isNew?'display:none':''}">Elimina categoria</button>
      <div style="display:flex;gap:8px;">
        <button class="btn-secondary" id="c-cancel">Annulla</button>
        <button class="btn-primary" id="c-save">Salva</button>
      </div>
    </div>`;

  let selectedColor = c.color;
  modal.querySelectorAll('.swatch').forEach(sw=>{
    sw.addEventListener('click', ()=>{
      modal.querySelectorAll('.swatch').forEach(s=>s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.dataset.color;
    });
  });
  modal.querySelector('#c-cancel').addEventListener('click', closeAllModals);
  modal.querySelector('#c-delete').addEventListener('click', async ()=>{
    const inUse = state.events.some(e=>e.categoryId===c.id);
    if (inUse && !confirm('Ci sono impegni con questa categoria: eliminarla comunque? (gli impegni resteranno ma senza categoria)')) return;
    await DB.remove('categories', c.id);
    state.categories = state.categories.filter(x=>x.id!==c.id);
    rebuildIndexes();
    closeAllModals();
    renderSidebarCategories();
    await renderCalendarGrid();
    renderSummaryPanel();
  });
  modal.querySelector('#c-save').addEventListener('click', async ()=>{
    const name = modal.querySelector('#c-name').value.trim();
    if (!name){ toast('Dai un nome alla categoria.'); return; }
    const fresh = {
      ...c,
      name,
      color: selectedColor,
      defaultRateGross: Number(modal.querySelector('#c-rate').value)||0,
      defaultLocationId: modal.querySelector('#c-location').value || null,
    };
    await DB.put('categories', fresh);
    const idx = state.categories.findIndex(x=>x.id===fresh.id);
    if (idx>=0) state.categories[idx]=fresh; else state.categories.push(fresh);
    rebuildIndexes();
    closeAllModals();
    renderSidebarCategories();
    await renderCalendarGrid();
    renderSummaryPanel();
  });

  showModal('categoryModal');
}

/* ---------------- Location modal ---------------- */
function openLocationModal(loc, onSaved){
  const isNew = !loc;
  const l = loc || { id: uid(), name:'', address:'', type:'sede', lat:null, lng:null, geocodeStatus:'pending' };
  const modal = document.getElementById('locationModal');
  modal.innerHTML = `
    <h2>${isNew?'Nuovo indirizzo':'Modifica indirizzo'}</h2>
    <div class="field"><label>Nome (come vuoi riconoscerlo)</label>
      <input type="text" id="l-name" value="${escapeHTML(l.name)}" placeholder="Es. Centro Sereno, Casa Rossi…" /></div>
    <div class="field"><label>Tipo</label>
      <select id="l-type">
        ${Object.entries(LOCATION_TYPES).map(([k,v])=>`<option value="${k}" ${k===l.type?'selected':''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Indirizzo completo</label>
      <input type="text" id="l-address" value="${escapeHTML(l.address)}" placeholder="Via, civico, città" />
      <div class="geo-status" id="l-geostatus"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-danger-link" id="l-delete" style="${isNew?'display:none':''}">Elimina indirizzo</button>
      <div style="display:flex;gap:8px;">
        <button class="btn-secondary" id="l-cancel">Annulla</button>
        <button class="btn-primary" id="l-save">Salva &amp; verifica</button>
      </div>
    </div>`;

  modal.querySelector('#l-cancel').addEventListener('click', closeAllModals);
  modal.querySelector('#l-delete').addEventListener('click', async ()=>{
    const inUse = state.events.some(e=>e.locationId===l.id) || state.categories.some(c=>c.defaultLocationId===l.id);
    if (inUse && !confirm('Questo indirizzo è usato da impegni o categorie: eliminarlo comunque?')) return;
    await DB.remove('locations', l.id);
    state.locations = state.locations.filter(x=>x.id!==l.id);
    rebuildIndexes();
    closeAllModals();
    await renderCalendarGrid();
  });
  modal.querySelector('#l-save').addEventListener('click', async ()=>{
    const name = modal.querySelector('#l-name').value.trim();
    const address = modal.querySelector('#l-address').value.trim();
    if (!name || !address){ toast('Inserisci nome e indirizzo.'); return; }
    const statusEl = modal.querySelector('#l-geostatus');
    statusEl.textContent = 'Verifico l\u2019indirizzo…';
    statusEl.className = 'geo-status pending';
    const geo = await Geo.geocodeAddress(address);
    const fresh = { ...l, name, address, type: modal.querySelector('#l-type').value, lat: geo.lat, lng: geo.lng, geocodeStatus: geo.status };
    await DB.put('locations', fresh);
    const idx = state.locations.findIndex(x=>x.id===fresh.id);
    if (idx>=0) state.locations[idx]=fresh; else state.locations.push(fresh);
    rebuildIndexes();
    if (geo.status==='ok'){
      toast('Indirizzo salvato e trovato sulla mappa.');
    } else {
      toast('Indirizzo salvato, ma non trovato automaticamente: i tempi di spostamento da/verso qui non saranno calcolati finché non lo correggi.');
    }
    if (onSaved) onSaved(fresh);
    closeAllModals();
    await renderCalendarGrid();
  });

  showModal('locationModal');
}

/* ---------------- Locations manager modal ---------------- */
function openLocationsManager(){
  const modal = document.getElementById('locationsManagerModal');
  function draw(){
    modal.innerHTML = `
      <h2>Indirizzi &amp; sedi</h2>
      <div id="lm-list">
        ${state.locations.length ? state.locations.map(l=>`
          <div class="list-row">
            <span class="dot" style="width:8px;height:8px;border-radius:50%;background:${l.geocodeStatus==='ok'?'#3c6b2c':'#B5573F'}"></span>
            <span class="nm">${escapeHTML(l.name)}<span class="addr">${escapeHTML(l.address)}${l.geocodeStatus!=='ok'?' · non trovato sulla mappa':''}</span></span>
            <button data-edit-loc="${l.id}">Modifica</button>
          </div>`).join('') : '<p class="hint">Nessun indirizzo salvato ancora.</p>'}
      </div>
      <button class="btn-outline btn-block" id="lm-add">+ Nuovo indirizzo</button>
      <div class="modal-actions" style="justify-content:flex-end;">
        <button class="btn-secondary" id="lm-close">Chiudi</button>
      </div>`;
    modal.querySelectorAll('[data-edit-loc]').forEach(btn=>{
      btn.addEventListener('click', ()=> openLocationModal(state.locationsById[btn.dataset.editLoc], ()=>draw()));
    });
    modal.querySelector('#lm-add').addEventListener('click', ()=> openLocationModal(null, ()=>draw()));
    modal.querySelector('#lm-close').addEventListener('click', closeAllModals);
  }
  draw();
  showModal('locationsManagerModal');
}

/* ---------------- Settings modal ---------------- */
let settingsTab = 'tasse';
function openSettingsModal(){
  const modal = document.getElementById('settingsModal');
  const s = state.settings;

  function draw(){
    modal.innerHTML = `
      <h2>Impostazioni</h2>
      <div class="settings-tabs">
        <button class="settings-tab ${settingsTab==='tasse'?'active':''}" data-tab="tasse">Tariffe &amp; tasse</button>
        <button class="settings-tab ${settingsTab==='spostamenti'?'active':''}" data-tab="spostamenti">Spostamenti</button>
        <button class="settings-tab ${settingsTab==='preferenze'?'active':''}" data-tab="preferenze">Preferenze</button>
        <button class="settings-tab ${settingsTab==='account'?'active':''}" data-tab="account">Account</button>
      </div>
      <div id="settings-body"></div>
      <div class="modal-actions" style="justify-content:flex-end;">
        <button class="btn-secondary" id="s-close">Chiudi</button>
      </div>`;
    modal.querySelectorAll('.settings-tab').forEach(btn=>{
      btn.addEventListener('click', ()=>{ settingsTab = btn.dataset.tab; draw(); });
    });
    modal.querySelector('#s-close').addEventListener('click', closeAllModals);
    drawBody();
  }

  function drawBody(){
    const body = modal.querySelector('#settings-body');
    if (settingsTab === 'tasse'){
      body.innerHTML = `
        <div class="field"><label>Coefficiente di redditività (% del fatturato tassata come reddito)</label>
          <input type="number" id="s-coeff" min="0" max="100" step="1" value="${Math.round(s.coefficienteRedditivita*100)}" /></div>
        <div class="field"><label>Contributi previdenziali (% sul reddito imponibile — es. Gestione Separata INPS o ENPAP)</label>
          <input type="number" id="s-contrib" min="0" max="100" step="0.01" value="${(s.aliquotaContributi*100).toFixed(2)}" /></div>
        <div class="field"><label>Imposta sostitutiva</label>
          <select id="s-imposta-preset">
            <option value="0.05" ${s.aliquotaImpostaSostitutiva===0.05?'selected':''}>5% — primi 5 anni di attività</option>
            <option value="0.15" ${s.aliquotaImpostaSostitutiva===0.15?'selected':''}>15% — regime forfettario ordinario</option>
            <option value="custom" ${![0.05,0.15].includes(s.aliquotaImpostaSostitutiva)?'selected':''}>Personalizzata</option>
          </select>
          <input type="number" id="s-imposta-custom" min="0" max="100" step="0.1" style="margin-top:6px;${[0.05,0.15].includes(s.aliquotaImpostaSostitutiva)?'display:none':''}" value="${(s.aliquotaImpostaSostitutiva*100).toFixed(1)}" placeholder="%" />
        </div>
        <div class="tax-formula">
          <code>imponibile</code> = lordo × coefficiente<br>
          <code>contributi</code> = imponibile × aliquota contributi<br>
          <code>imposta sostitutiva</code> = (imponibile − contributi) × aliquota imposta<br>
          <code>netto</code> = lordo − contributi − imposta sostitutiva
        </div>
        <p class="helper-text">Stima orientativa basata sul regime forfettario. Se sei iscritta a una cassa specifica come l'ENPAP invece della Gestione Separata INPS, i contributi funzionano diversamente (quota minima fissa + integrativo): verifica le cifre esatte con un commercialista o con l'ente di previdenza.</p>
        <div class="modal-actions" style="justify-content:flex-end;"><button class="btn-primary" id="s-save-tasse">Salva</button></div>
      `;
      body.querySelector('#s-imposta-preset').addEventListener('change', (e)=>{
        const custom = body.querySelector('#s-imposta-custom');
        custom.style.display = e.target.value==='custom' ? '' : 'none';
      });
      body.querySelector('#s-save-tasse').addEventListener('click', async ()=>{
        const preset = body.querySelector('#s-imposta-preset').value;
        const impostaPct = preset==='custom' ? Number(body.querySelector('#s-imposta-custom').value) : Number(preset)*100;
        const fresh = {
          ...s,
          coefficienteRedditivita: Number(body.querySelector('#s-coeff').value)/100,
          aliquotaContributi: Number(body.querySelector('#s-contrib').value)/100,
          aliquotaImpostaSostitutiva: impostaPct/100,
        };
        await DB.put('settings', fresh);
        state.settings = fresh;
        toast('Parametri fiscali aggiornati.');
        renderSummaryPanel();
      });
    }

    if (settingsTab === 'spostamenti'){
      body.innerHTML = `
        <div class="field">
          <label><input type="checkbox" id="s-showhome" ${s.showHomeTravel?'checked':''} style="width:auto;margin-right:6px;" />Mostra il tempo da/verso casa a inizio e fine giornata</label>
        </div>
        <div class="field"><label>La tua residenza</label>
          <select id="s-home">
            <option value="">— non impostata —</option>
            ${state.locations.map(l=>`<option value="${l.id}" ${l.id===s.homeLocationId?'selected':''}>${escapeHTML(l.name)}</option>`).join('')}
          </select>
          <div class="helper-text">Se la tua residenza non è ancora tra gli indirizzi, aggiungila da "Gestisci indirizzi" con tipo "Mia residenza".</div>
        </div>
        <div class="modal-actions" style="justify-content:flex-end;"><button class="btn-primary" id="s-save-home">Salva</button></div>
        <hr style="border:none;border-top:1px solid var(--line);margin:16px 0;">
        <h3 style="font-size:12.5px;color:var(--ink-soft);margin-bottom:6px;">Correggi manualmente un tempo di spostamento</h3>
        <p class="helper-text">I tempi vengono calcolati in automatico (percorso stradale). Se un tempo non ti sembra giusto, puoi correggerlo qui: la correzione avrà sempre la precedenza.</p>
        <div class="row2 field" style="margin-top:8px;">
          <div><label>Da</label><select id="s-tm-from">${state.locations.map(l=>`<option value="${l.id}">${escapeHTML(l.name)}</option>`).join('')}</select></div>
          <div><label>A</label><select id="s-tm-to">${state.locations.map(l=>`<option value="${l.id}">${escapeHTML(l.name)}</option>`).join('')}</select></div>
        </div>
        <div class="row2 field">
          <div><label>Minuti in auto</label><input type="number" id="s-tm-min" min="0" step="1" /></div>
          <div style="display:flex;align-items:flex-end;"><button class="btn-primary" id="s-tm-save" style="width:100%;">Salva correzione</button></div>
        </div>
        <div id="s-tm-list"></div>
      `;
      body.querySelector('#s-save-home').addEventListener('click', async ()=>{
        const fresh = { ...s, showHomeTravel: body.querySelector('#s-showhome').checked, homeLocationId: body.querySelector('#s-home').value || null };
        await DB.put('settings', fresh);
        state.settings = fresh;
        toast('Preferenze spostamenti aggiornate.');
        await renderCalendarGrid();
      });
      body.querySelector('#s-tm-save').addEventListener('click', async ()=>{
        const fromId = body.querySelector('#s-tm-from').value;
        const toId = body.querySelector('#s-tm-to').value;
        const min = body.querySelector('#s-tm-min').value;
        if (fromId===toId){ toast('Scegli due indirizzi diversi.'); return; }
        if (min===''){ toast('Inserisci i minuti.'); return; }
        await Geo.setManualOverride(fromId, toId, min);
        toast('Correzione salvata.');
        drawTravelList();
        await renderCalendarGrid();
      });
      drawTravelList();

      async function drawTravelList(){
        const listEl = body.querySelector('#s-tm-list');
        const all = await DB.getAll('travelCache');
        if (!all.length){ listEl.innerHTML=''; return; }
        listEl.innerHTML = '<h3 style="font-size:12px;color:var(--ink-soft);margin:14px 0 6px;">Tempi noti</h3>' + all.map(t=>{
          const [fromId,toId] = t.id.split('::');
          const fromName = state.locationsById[fromId] ? state.locationsById[fromId].name : '?';
          const toName = state.locationsById[toId] ? state.locationsById[toId].name : '?';
          return `<div class="list-row"><span class="nm">${escapeHTML(fromName)} → ${escapeHTML(toName)}<span class="addr">${t.durationMin!=null?t.durationMin+' min · '+({osrm:'percorso stradale',stima:'stima approssimativa',manuale:'inserito a mano'}[t.source]||t.source):'sconosciuto'}</span></span><button data-clear-pair="${t.id}">Ricalcola</button></div>`;
        }).join('');
        listEl.querySelectorAll('[data-clear-pair]').forEach(btn=>{
          btn.addEventListener('click', async ()=>{
            await DB.remove('travelCache', btn.dataset.clearPair);
            toast('Verrà ricalcolato al prossimo utilizzo.');
            drawTravelList();
            await renderCalendarGrid();
          });
        });
      }
    }

    if (settingsTab === 'preferenze'){
      body.innerHTML = `
        <div class="row2 field">
          <div><label>Inizio giornata</label><input type="number" id="s-start" min="0" max="23" value="${s.dayStartHour}" /></div>
          <div><label>Fine giornata</label><input type="number" id="s-end" min="1" max="24" value="${s.dayEndHour}" /></div>
        </div>
        <div class="row2 field">
          <div><label>Durata predefinita nuovo impegno</label>
            <select id="s-defdur">
              ${[30,45,60,90,120].map(m=>`<option value="${m}" ${s.defaultEventMinutes===m?'selected':''}>${m} min</option>`).join('')}
            </select></div>
          <div><label>Precisione trascinamento</label>
            <select id="s-slot">
              ${[5,10,15,30].map(m=>`<option value="${m}" ${s.slotMinutes===m?'selected':''}>${m} min</option>`).join('')}
            </select></div>
        </div>
        <div class="field"><label>Primo giorno della settimana</label>
          <select id="s-weekstart">
            <option value="1" ${s.weekStartsOn===1?'selected':''}>Lunedì</option>
            <option value="0" ${s.weekStartsOn===0?'selected':''}>Domenica</option>
          </select>
        </div>
        <div class="field"><label>Giorni visualizzati</label>
          <select id="s-viewdays">
            <option value="5" ${s.viewDays===5?'selected':''}>5 giorni (lun–ven)</option>
            <option value="7" ${s.viewDays===7?'selected':''}>7 giorni (lun–dom)</option>
          </select>
          <div class="helper-text">Nasconde solo le colonne del weekend: se hai già impegni di sabato o domenica restano salvati e contano comunque nei totali e nell'export.</div>
        </div>
        <div class="modal-actions" style="justify-content:flex-end;"><button class="btn-primary" id="s-save-pref">Salva</button></div>
      `;
      body.querySelector('#s-save-pref').addEventListener('click', async ()=>{
        const fresh = {
          ...s,
          dayStartHour: Number(body.querySelector('#s-start').value),
          dayEndHour: Number(body.querySelector('#s-end').value),
          defaultEventMinutes: Number(body.querySelector('#s-defdur').value),
          slotMinutes: Number(body.querySelector('#s-slot').value),
          weekStartsOn: Number(body.querySelector('#s-weekstart').value),
          viewDays: Number(body.querySelector('#s-viewdays').value),
        };
        await DB.put('settings', fresh);
        state.settings = fresh;
        state.weekStart = startOfWeek(state.weekStart, fresh.weekStartsOn);
        toast('Preferenze salvate.');
        renderWeekChrome();
        await renderCalendarGrid();
      });
    }

    if (settingsTab === 'account'){
      body.innerHTML = `
        <p class="helper-text" style="margin-bottom:14px;">Accesso come <strong>${escapeHTML(window.CURRENT_USER_EMAIL||'')}</strong>. I dati sono sincronizzati automaticamente su ogni dispositivo dove effettui l'accesso con lo stesso account Google.</p>
        <button class="btn-secondary" id="s-signout">Esci</button>
      `;
      body.querySelector('#s-signout').addEventListener('click', async ()=>{
        closeAllModals();
        if (typeof signOutOfApp === 'function') await signOutOfApp();
      });
    }
  }

  draw();
  showModal('settingsModal');
}

/* ============================================================
   Export
   ============================================================ */
async function exportAllData(){
  const data = {
    exportedAt: new Date().toISOString(),
    categories: state.categories,
    locations: state.locations,
    events: state.events,
    settings: state.settings,
  };
  const filename = `agenda-federica-${toISODate(new Date())}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  try {
    const file = new File([blob], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })){
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (err) { /* fall through to plain download */ }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

/* ============================================================
   Export to phone/iPad calendar (.ics) — real appointments only,
   travel "fake events" are never exported.
   ============================================================ */
function icsEscape(s){
  return String(s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
}
function toICSDateTime(dateStr, timeStr){
  return dateStr.replace(/-/g,'') + 'T' + timeStr.replace(':','') + '00';
}
function buildICSForWeek(){
  const fromISO = toISODate(state.weekStart);
  const toISO = toISODate(addDays(state.weekStart,6));
  const evts = state.events
    .filter(e=> e.date>=fromISO && e.date<=toISO)
    .sort((a,b)=> a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const dtstamp = new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Agenda Federica//IT','CALSCALE:GREGORIAN'];
  evts.forEach(evt=>{
    const cat = state.categoriesById[evt.categoryId];
    const loc = state.locationsById[evt.locationId];
    const summary = evt.title || (cat ? cat.name : 'Impegno');
    lines.push('BEGIN:VEVENT');
    lines.push('UID:'+evt.id+'@agenda-federica.local');
    lines.push('DTSTAMP:'+dtstamp);
    lines.push('DTSTART:'+toICSDateTime(evt.date, evt.start));
    lines.push('DTEND:'+toICSDateTime(evt.date, evt.end));
    lines.push('SUMMARY:'+icsEscape(summary));
    if (loc) lines.push('LOCATION:'+icsEscape(loc.address || loc.name));
    if (evt.notes) lines.push('DESCRIPTION:'+icsEscape(evt.notes));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return { ics: lines.join('\r\n'), count: evts.length };
}
async function exportWeekToCalendar(){
  const { ics, count } = buildICSForWeek();
  if (!count){ toast('Nessun impegno da esportare in questa settimana.'); return; }
  const filename = `agenda-settimana-${toISODate(state.weekStart)}.ics`;
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  try {
    const file = new File([blob], filename, { type: 'text/calendar' });
    if (navigator.canShare && navigator.canShare({ files: [file] })){
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (err) { /* fall through to plain download */ }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

/* ============================================================
   Copy previous week into the one currently displayed
   ============================================================ */
async function copyPreviousWeek(){
  const prevWeekStart = addDays(state.weekStart, -7);
  const prevFromISO = toISODate(prevWeekStart);
  const prevToISO = toISODate(addDays(prevWeekStart,6));
  const prevEvents = state.events.filter(e=> e.date>=prevFromISO && e.date<=prevToISO);
  if (!prevEvents.length){ toast('La settimana precedente non ha impegni da copiare.'); return; }

  const curFromISO = toISODate(state.weekStart);
  const curToISO = toISODate(addDays(state.weekStart,6));
  const alreadyHas = state.events.some(e=> e.date>=curFromISO && e.date<=curToISO);
  const msg = alreadyHas
    ? `Questa settimana ha già degli impegni. Copiare comunque ${prevEvents.length} impegni dalla settimana scorsa (si aggiungeranno a quelli presenti)?`
    : `Copiare ${prevEvents.length} impegni dalla settimana scorsa in questa settimana?`;
  if (!confirm(msg)) return;

  for (const e of prevEvents){
    const copy = {
      ...e,
      id: uid(),
      date: toISODate(addDays(parseISODate(e.date), 7)),
      billingStatus: 'da_fatturare',
      recurrenceId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await DB.put('events', copy);
    state.events.push(copy);
  }
  toast(`${prevEvents.length} impegni copiati in questa settimana.`);
  await renderCalendarGrid();
  renderSummaryPanel();
}

/* ============================================================
   Init & top-level wiring
   ============================================================ */
async function refreshAll(){
  renderSidebarCategories();
  renderWeekChrome();
  await renderCalendarGrid();
  renderSummaryPanel();
}

function wireTopLevel(){
  document.getElementById('prevWeek').addEventListener('click', async ()=>{
    state.weekStart = addDays(state.weekStart, -7);
    renderWeekChrome(); await renderCalendarGrid(); renderSummaryPanel();
  });
  document.getElementById('nextWeek').addEventListener('click', async ()=>{
    state.weekStart = addDays(state.weekStart, 7);
    renderWeekChrome(); await renderCalendarGrid(); renderSummaryPanel();
  });
  document.getElementById('todayBtn').addEventListener('click', async ()=>{
    state.weekStart = startOfWeek(new Date(), state.settings.weekStartsOn);
    renderWeekChrome(); await renderCalendarGrid(); renderSummaryPanel();
  });
  document.getElementById('addCategoryBtn').addEventListener('click', ()=> openCategoryModal(null));
  document.getElementById('manageLocationsBtn').addEventListener('click', openLocationsManager);
  document.getElementById('copyPrevWeekBtn').addEventListener('click', copyPreviousWeek);
  document.getElementById('exportICSBtn').addEventListener('click', exportWeekToCalendar);
  document.getElementById('exportBtn').addEventListener('click', exportAllData);
  document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);

  document.getElementById('toggleSidebar').addEventListener('click', ()=>{
    document.getElementById('sidebar').classList.toggle('open');
  });
  document.getElementById('summaryToggle').addEventListener('click', ()=>{
    document.getElementById('summaryPanel').classList.toggle('open');
  });

  document.getElementById('periodToggle').addEventListener('click', (e)=>{
    const btn = e.target.closest('.period-btn');
    if (!btn) return;
    document.querySelectorAll('.period-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    state.summaryPeriod = btn.dataset.period;
    renderSummaryPanel();
  });

  window.addEventListener('resize', debounce(async ()=>{
    renderWeekChrome();
    await renderCalendarGrid();
  }, 150));

  setInterval(()=>{
    const line = document.querySelector('.now-line');
    if (line){
      const now = new Date();
      const mins = now.getHours()*60+now.getMinutes() - state.settings.dayStartHour*60;
      line.style.top = (mins/60*hourPx())+'px';
    }
  }, 60000);
}

function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

async function init(){
  await ensureSeedData();
  await loadAllData();
  wireTopLevel();
  await refreshAll();

  if ('serviceWorker' in navigator){
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch (err) { console.warn('Service worker non registrato:', err); }
  }
}

// init() is now called from auth.js's startApp(), once Google sign-in
// succeeds — not automatically here, since data access needs a signed-in
// user (see db.js).
