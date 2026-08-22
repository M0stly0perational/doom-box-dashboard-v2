/* ============================================================
   DOOM BOX — ADS-B DATA (LIVE, 2026-06-06)
   Real aircraft from dump1090 via Node-RED:
     GET /api/adsb            {aircraft:[{icao,callsign,altitude,speed,
                               heading,lat,lon,distance,military,
                               last_seen,squawk}], count, now}
     GET /api/gps             {fix, lat, lon, ...}  → GPS reference point (independent USB u-blox via gpsd, since 2026-07-12)
   Distance is computed CLIENT-SIDE from each aircraft's lat/lon against the
   live GPS position (NOT the API's hardcoded-Vegas distance field), falling
   back to the Las Vegas centroid when there is no GPS fix.
   Session log persists across page refreshes via localStorage.
   Lifecycle: aircraft stale at 60 s, removed from the live table at 120 s
   (kept in the session log).
   Attaches to window.DBAdsb.
   ============================================================ */
window.DBAdsb = window.DBAdsb || {};
(function (A) {
  "use strict";
  var D2R = Math.PI / 180;
  var VEGAS = { lat: 36.1699, lon: -115.1398 };   // fallback when no GPS fix
  A.OWN = { lat: VEGAS.lat, lon: VEGAS.lon };
  A.gpsFix = false;

  var STALE_S = 60, REMOVE_S = 120;
  A.POLL_MS = 5000;
  var SESSION_KEY = 'og_adsb_session_v2';

  function pad(n, l) { n = String(Math.floor(n)); while (n.length < l) n = '0' + n; return n; }
  function num(v) { if (v == null || v === '') return null; var n = +v; return isNaN(n) ? null : n; }
  A.zulu = function (d) { return pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2) + 'Z'; };
  A.dist = function (a, b) { if (a == null || b == null || a.lat == null || b.lat == null) return null; var R = 3440.065, dlat = (b.lat - a.lat) * D2R, dlon = (b.lon - a.lon) * D2R, la1 = a.lat * D2R, la2 = b.lat * D2R; var h = Math.sin(dlat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  A.bearing = function (a, b) { if (a == null || b == null || a.lat == null || b.lat == null) return 0; var la1 = a.lat * D2R, la2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R; var y = Math.sin(dl) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl); return (Math.atan2(y, x) / D2R + 360) % 360; };
  var CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  A.card = function (d) { return CARD[Math.round(d / 22.5) % 16]; };

  // US military ICAO allocation = hex starting AE (per V1 dashboard + CLAUDE.md)
  A.isMilHex = function (hex) { return /^AE/i.test(String(hex || '')); };

  A.fleet = [];          // current in-range aircraft objects (render reads this)
  A.session = [];        // persistent session records
  A.sessionStart = new Date();
  A.sessionTotal = 0;
  A.receiver = { count: 0, mil: 0, lastPoll: 0, gpsFix: false };
  A._fleetMap = {};      // hex → { obj, seenWall }
  A._milPushed = {};     // hex → true (ticker dedupe)
  A._onMil = null;       // render hook: called once per new military contact

  /* ---- session localStorage ---- */
  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (raw) { var o = JSON.parse(raw); A.session = o.records || []; A.sessionStart = new Date(o.start || Date.now()); A.sessionTotal = A.session.length; return; }
    } catch (e) {}
    A.session = []; A.sessionStart = new Date(); A.sessionTotal = 0; saveSession();
  }
  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ start: +A.sessionStart, records: A.session.slice(0, 300) })); } catch (e) {}
  }
  A.saveSession = saveSession;
  function findSession(hex) { for (var i = 0; i < A.session.length; i++) if (A.session[i].hex === hex) return A.session[i]; return null; }
  function upsertSession(a, now) {
    var rec = findSession(a.hex);
    if (!rec) { rec = { hex: a.hex, callsign: a.callsign, first: now, last: now, maxAlt: a.alt, maxSpd: a.spd, tracks: 1, dwell: 0, exit: null }; A.session.unshift(rec); }
    else { if (a.callsign) rec.callsign = a.callsign; rec.last = now; rec.maxAlt = Math.max(rec.maxAlt || 0, a.alt); rec.maxSpd = Math.max(rec.maxSpd || 0, a.spd); rec.tracks++; rec.exit = null; }
    rec.dwell = Math.max(0, Math.round((rec.last - rec.first) / 60000));
    A.sessionTotal = A.session.length;
  }

  /* ---- map one real aircraft into the render object shape ---- */
  function upsert(api, now) {
    var hex = String(api.icao || api.hex || '').toUpperCase();
    if (!hex) return null;
    var e = A._fleetMap[hex], a = e && e.obj;
    if (!a) { a = { hex: hex, firstSeen: new Date(now), firstSeenMin: 0, isNew: now, tracks: 0, msgs: 0, maxAlt: 0, maxSpd: 0, hist: [], pinned: false, alertCfg: null }; }
    var cs = (api.callsign || '').trim();
    var mil = !!api.military || A.isMilHex(hex);
    a.callsign = cs; a.mil = mil; a.cat = mil ? 'MILITARY' : (cs ? 'COMMERCIAL' : 'UNKNOWN'); a.interesting = false;
    // fields with no real backing — safe defaults so optional columns/detail don't throw
    a.type = '—'; a.typeName = mil ? 'Military aircraft' : (cs ? 'Aircraft' : 'Unknown'); a.op = null; a.country = ''; a.reg = '—'; a.year = '—'; a.emitterCat = '—'; a.rssi = null; a.vrate = 0; a.origin = ['—', '—']; a.dest = ['—', '—'];
    a.lat = num(api.lat); a.lon = num(api.lon);
    a.alt = num(api.altitude) || 0; a.spd = num(api.speed) || 0; a.hdg = num(api.heading) || 0;
    var sq = (api.squawk != null && api.squawk !== '') ? String(api.squawk) : '—';
    a.squawk = sq; a.emergency = (sq === '7500' || sq === '7600' || sq === '7700');
    a.tracks++; a.msgs++;
    a.maxAlt = Math.max(a.maxAlt, a.alt); a.maxSpd = Math.max(a.maxSpd, a.spd);
    a.firstSeenMin = Math.floor((now - (+a.firstSeen)) / 60000);
    if (a.lat != null && a.lon != null) {
      a.hist.push({ lat: a.lat, lon: a.lon }); if (a.hist.length > 40) a.hist.shift();
      a._dist = A.dist(A.OWN, a); a._brg = A.bearing(A.OWN, a);
    } else { a._dist = num(api.distance); a._brg = 0; }
    a.apiLastSeen = num(api.last_seen) || 0; a.lastSeen = a.apiLastSeen; a.stale = a.lastSeen > STALE_S; a.inRange = true;
    A._fleetMap[hex] = { obj: a, seenWall: now };
    upsertSession(a, now);
    if (mil && !A._milPushed[hex]) { A._milPushed[hex] = true; if (A._onMil) A._onMil(a); }
    return a;
  }

  // age all aircraft, mark stale, remove >120 s (keep in session w/ exit time)
  A.age = function (now) {
    var removed = [];
    Object.keys(A._fleetMap).forEach(function (hex) {
      var e = A._fleetMap[hex], a = e.obj;
      var eff = a.apiLastSeen + (now - e.seenWall) / 1000;
      a.lastSeen = eff; a.stale = eff > STALE_S;
      if (eff > REMOVE_S) {
        delete A._fleetMap[hex];
        var rec = findSession(hex);
        if (rec) { rec.exit = e.seenWall + a.apiLastSeen * 1000; rec.last = Math.max(rec.last, rec.exit); }
        removed.push(hex);
      }
    });
    A.fleet = Object.keys(A._fleetMap).map(function (h) { return A._fleetMap[h].obj; });
    if (removed.length) saveSession();
    return removed;
  };

  // 5 s poll: fetch aircraft + GPS, remap, recompute distances, age out
  A.refresh = function (cb) {
    var now = Date.now();
    Promise.all([
      fetch('/api/adsb', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/api/gps', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var adsb = res[0], pos = res[1];
      if (pos && pos.fix && pos.lat != null && pos.lon != null) { A.OWN = { lat: +pos.lat, lon: +pos.lon }; A.gpsFix = true; }
      else { A.OWN = { lat: VEGAS.lat, lon: VEGAS.lon }; A.gpsFix = false; }
      var list = adsb ? (adsb.aircraft || adsb.items || (Array.isArray(adsb) ? adsb : [])) : [];
      list.forEach(function (api) { upsert(api, now); });
      A.age(now);
      // recompute distance/bearing against the (possibly updated) reference
      A.fleet.forEach(function (a) { if (a.lat != null && a.lon != null) { a._dist = A.dist(A.OWN, a); a._brg = A.bearing(A.OWN, a); } });
      saveSession();
      A.receiver.lastPoll = now; A.receiver.count = A.fleet.length;
      A.receiver.mil = A.fleet.filter(function (a) { return a.mil; }).length;
      A.receiver.gpsFix = A.gpsFix; A.receiver.ok = !!adsb;
      if (cb) cb();
    });
  };

  // 1 s display tick (no fetch): age effective last-seen, remove >120 s
  A.tickAge = function () { return A.age(Date.now()); };

  A.build = function () {
    loadSession();
    A._fleetMap = {}; A.fleet = []; A._milPushed = {};
  };
  A.clearSession = function () { A.session = []; A.sessionTotal = 0; saveSession(); };

})(window.DBAdsb);
