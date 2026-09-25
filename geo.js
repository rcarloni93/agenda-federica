/* ============================================================
   geo.js — address geocoding + driving-time estimation
   ------------------------------------------------------------
   Uses free public services (OpenStreetMap Nominatim for
   geocoding, OSRM demo server for driving routes) since this
   is a static, no-backend app. Both are best-effort / fair-use
   services with no uptime guarantee, so:
     - every result is cached (locations keep lat/lng, travel
       times are cached by from-to pair) to minimise calls
     - if a call fails, we fall back to a straight-line distance
       estimate so the app still works
     - everything can be corrected by hand in Impostazioni →
       Tempi di spostamento, which always wins over the computed
       value once set as override
   For heavier day-to-day use, swapping in a paid geocoder /
   routing API (Google, Mapbox) with an API key is a drop-in
   replacement for the two functions below.
   ============================================================ */

const Geo = (() => {
  let lastNominatimCall = 0;
  const MIN_GAP_MS = 1100; // fair-use: max ~1 request/second

  async function throttle() {
    const wait = MIN_GAP_MS - (Date.now() - lastNominatimCall);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastNominatimCall = Date.now();
  }

  async function geocodeAddress(address) {
    if (!address || !address.trim()) return { status: 'failed', lat: null, lng: null, matched: null };
    try {
      await throttle();
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('nominatim http ' + res.status);
      const data = await res.json();
      if (!data || !data.length) return { status: 'failed', lat: null, lng: null, matched: null };
      return {
        status: 'ok',
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        matched: data[0].display_name,
      };
    } catch (err) {
      console.warn('Geocoding fallito:', err);
      return { status: 'failed', lat: null, lng: null, matched: null };
    }
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // driving time between two coordinate pairs, via OSRM demo server
  async function routeDriving(lat1, lng1, lat2, lng2) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('osrm http ' + res.status);
      const data = await res.json();
      const route = data && data.routes && data.routes[0];
      if (!route) throw new Error('nessun percorso');
      return {
        durationMin: Math.round(route.duration / 60),
        distanceKm: Math.round(route.distance / 100) / 10,
        source: 'osrm',
      };
    } catch (err) {
      // fallback: straight-line distance at an assumed average urban/extraurban speed
      const km = haversineKm(lat1, lng1, lat2, lng2);
      const assumedKmh = km > 15 ? 55 : 32;
      return {
        durationMin: Math.max(5, Math.round((km / assumedKmh) * 60)),
        distanceKm: Math.round(km * 10) / 10,
        source: 'stima',
      };
    }
  }

  function pairKey(fromId, toId) { return `${fromId}::${toId}`; }

  // Returns {durationMin, distanceKm, source: 'osrm'|'stima'|'manuale', unknown:boolean}
  async function getTravel(fromLoc, toLoc) {
    if (!fromLoc || !toLoc || fromLoc.id === toLoc.id) {
      return { durationMin: 0, distanceKm: 0, source: 'stessa-sede', unknown: false };
    }
    const key = pairKey(fromLoc.id, toLoc.id);
    const cached = await DB.get('travelCache', key);
    if (cached) return cached;

    if (fromLoc.lat == null || toLoc.lat == null) {
      const result = { id: key, durationMin: null, distanceKm: null, source: 'sconosciuto', unknown: true, computedAt: Date.now() };
      return result;
    }
    const r = await routeDriving(fromLoc.lat, fromLoc.lng, toLoc.lat, toLoc.lng);
    const result = { id: key, durationMin: r.durationMin, distanceKm: r.distanceKm, source: r.source, unknown: false, computedAt: Date.now() };
    await DB.put('travelCache', result);
    return result;
  }

  async function setManualOverride(fromId, toId, durationMin) {
    const key = pairKey(fromId, toId);
    const result = { id: key, durationMin: Number(durationMin) || 0, distanceKm: null, source: 'manuale', unknown: false, computedAt: Date.now(), manual: true };
    await DB.put('travelCache', result);
    return result;
  }

  async function clearCacheForPair(fromId, toId) {
    await DB.remove('travelCache', pairKey(fromId, toId));
  }

  return { geocodeAddress, routeDriving, getTravel, setManualOverride, clearCacheForPair, pairKey, haversineKm };
})();
