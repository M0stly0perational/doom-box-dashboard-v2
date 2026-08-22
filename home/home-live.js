/* ============================================================
   DOOM BOX — HOME LIVE  (REAL INTEGRATION, 2026-06-03)
   Drives the inline HOME view (intel cards + status row),
   the top-bar chips, and the ticker with real data, via the
   window.DBHome hook surface exposed by the shell bootstrap.

   Sources (all same-origin on :1880):
     /api/system          services, uptime, mesh, hotspot, net
     /api/battery         SW2106 fuel gauge
     /api/mesh/state      node_count, connected, self GPS
     /api/mesh/messages   mesh chat (RECEIVED MESSAGES card)
     /api/adsb            tracked aircraft count
     /api/sigint/status   RF chip
     /api/ai/health       AI chip
     /api/wx/state        ticker weather alerts
     /dashboard/data/news/news-recent.json     INTEL FEED card + ticker
     /dashboard/data/crime/cfs-recent.geojson  VIOLENT CRIME card (LVMPD CFS)

   The news + crime data files live under V1's static tree
   (/dashboard/data/...) and are read-only here.
   ============================================================ */
(function () {
  "use strict";
  if (!window.DBHome) { console.warn('[home-live] DBHome hook missing'); return; }
  var H = window.DBHome;

  function getJSON(url) {
    return fetch(url, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }

  /* ---- Node-RED offline full-card state (spec 4) ---- */
  var offFails = 0, offShown = false;
  function offEl() { return document.getElementById('dbOffline'); }
  function showOffline() { var e = offEl(); if (e && !offShown) { e.classList.add('show'); e.setAttribute('aria-hidden', 'false'); offShown = true; } }
  function hideOffline() { var e = offEl(); if (e && offShown) { e.classList.remove('show'); e.setAttribute('aria-hidden', 'true'); offShown = false; } }
  function tms(v) { var n = +v; return isFinite(n) ? (n < 1e12 ? n * 1000 : n) : Date.now(); } // sec or ms -> ms
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmmZ(ms) { var d = new Date(ms); return pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + 'Z'; }

  /* ---- last-known feed state (cards) ---- */
  var newsRows = [], crimeRows = [], meshRows = [];
  var newsRaw = [];        // full tagged item list, also feeds ticker
  var wxAlerts = [];       // active wx alerts for ticker

  function pushFeeds() { H.feeds(newsRows.slice(), crimeRows.slice(), meshRows.length ? meshRows.slice() : [{ d: new Date(), cs: '·', msg: 'no recent mesh messages' }]); }

  /* ================= INTEL FEED (news) ================= */
  function titleKey(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }
  function fetchNews() {
    getJSON('/dashboard/data/news/news-recent.json').then(function (d) {
      var items = (d && d.items) || [];
      newsRaw = items;
      var seen = {};
      newsRows = items.filter(function (i) { return (i.tag || 'news') === 'news'; })
        .sort(function (a, b) { return (+b.ts) - (+a.ts); })
        .filter(function (i) {
          var k = titleKey(i.title || i.summary || '');
          if (!k || seen[k]) return false;
          seen[k] = true;
          return true;
        })
        .slice(0, 40)
        .map(function (i) { return { d: new Date(tms(i.ts)), x: i.title || i.summary || '' }; });
      pushFeeds();
    }).catch(function () {});
  }

  /* ================= VIOLENT CRIME (LVMPD CFS) ================= */
  function fetchCrime() {
    getJSON('/dashboard/data/crime/cfs-recent.geojson').then(function (d) {
      var f = (d && d.features) || [];
      crimeRows = f.map(function (x) { return x.properties || {}; })
        .filter(function (p) { return p.IncidentDate; })
        .sort(function (a, b) { return (+b.IncidentDate) - (+a.IncidentDate); })
        .slice(0, 40)
        .map(function (p) {
          var t = p.Classification || p.IncidentTypeDescription || 'INCIDENT';
          return { d: new Date(tms(p.IncidentDate)), type: String(t).toUpperCase(), loc: p.Address || '—' };
        });
      pushFeeds();
    }).catch(function () {});
  }

  /* ================= MESH MESSAGES ================= */
  function fetchMesh() {
    getJSON('/api/mesh/messages').then(function (d) {
      var items = (d && d.items) || [];
      meshRows = items.map(function (m) {
        return { d: new Date(m.ts_ms ? +m.ts_ms : tms(m.ts)), cs: m.fromName || m.from || '?', msg: m.text || '' };
      }).reverse().slice(0, 40);   // newest first
      pushFeeds();
    }).catch(function () {});
  }

  /* ================= STATUS ROW + CHIPS ================= */
  function adsbCount(d) {
    if (!d) return 0;
    if (Array.isArray(d)) return d.length;
    if (Array.isArray(d.aircraft)) return d.aircraft.length;
    return Object.keys(d).filter(function (k) { return k !== 'ok' && k !== 'now' && k !== 'count'; }).length;
  }
  function fmtUptime(s) {
    s = +s || 0; var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d > 0 ? (d + 'd ' + pad(h) + 'h') : (pad(h) + ':' + pad(m));
  }

  function fetchStatus() {
    Promise.all([
      getJSON('/api/system').catch(function () { return null; }),
      getJSON('/api/battery').catch(function () { return null; }),
      getJSON('/api/mesh/state').catch(function () { return null; }),
      getJSON('/api/adsb').catch(function () { return null; }),
      getJSON('/api/sigint/status').catch(function () { return null; }),
      getJSON('/api/ai/health').catch(function () { return null; })
    ]).then(function (res) {
      var sys = res[0], bat = res[1], mesh = res[2], adsb = res[3], sig = res[4], ai = res[5];

      /* Offline detection: when the core Node-RED /api/* endpoints ALL fail
         for 3 consecutive polls, the data source is down → show the styled
         offline card. Any success clears it immediately. */
      if (sys === null && bat === null && mesh === null) { if (++offFails >= 3) showOffline(); }
      else { offFails = 0; hideOffline(); }

      var st = {};

      if (sys) {
        if (sys.services) {
          var names = Object.keys(sys.services);
          st.servicesTotal = names.length;
          st.servicesActive = names.filter(function (n) { return sys.services[n] && sys.services[n].state === 'active'; }).length;
        }
        if (sys.uptime_s != null) st.uptimeStr = fmtUptime(sys.uptime_s);
        if (sys.mesh) { st.meshNodes = +sys.mesh.node_count || 0; st.meshConnected = !!sys.mesh.connected; }
      }
      if (mesh) { st.meshNodes = +mesh.node_count || st.meshNodes || 0; st.meshConnected = !!mesh.connected; st.gpsFix = !!mesh.self_gps_fix; }
      if (bat) { st.batteryPct = (typeof bat.percent === 'number' ? bat.percent : null); st.batteryState = bat.state || ''; st.batteryTrend = (bat.current_ma > 0 ? '▲' : (bat.current_ma < 0 ? '▼' : '')); }
      st.adsbTracked = adsbCount(adsb);

      H.status(st);

      /* chips */
      var c2 = 'var(--text-2)';
      var chips = [
        { k: 'GPS', v: st.gpsFix ? 'LOCK' : 'NO FIX', c: st.gpsFix ? 'var(--green)' : 'var(--red)' },
        { k: 'NET', v: (sys && sys.net && sys.net.wlan0 && (sys.net.wlan0.rx_total_b != null || sys.net.wlan0.tx_total_b != null)) ? 'LAN' : 'AP', c: 'var(--blue)' },
        { k: 'RF', v: (sig && sig.ok && sig.mode && sig.mode !== 'offline') ? String(sig.mode).toUpperCase() : 'OFF', c: (sig && sig.ok && sig.mode === 'monitor') ? 'var(--red)' : (sig && sig.ok && sig.mode && sig.mode !== 'offline') ? 'var(--orange)' : c2 },
        { k: 'AI', v: (ai && ai.ok) ? ((ai.loaded_models && ai.loaded_models.length) ? 'LOAD' : 'RDY') : 'OFF', c: (ai && ai.ok) ? 'var(--purple)' : c2 },
        { k: 'BATT', v: (bat && typeof bat.percent === 'number') ? (bat.percent + '%') : '—', c: (bat && typeof bat.percent === 'number') ? (bat.percent >= 30 ? 'var(--green)' : bat.percent >= 15 ? 'var(--orange)' : 'var(--red)') : c2 }
      ];
      H.chips(chips);
    });
  }

  /* ================= TICKER ================= */
  var TAGMAP = {
    news:    { tg: 'NEWS',   c: 'var(--text-1)' },
    crime:   { tg: 'CRIME',  c: 'var(--orange)' },
    weather: { tg: 'WX',     c: 'var(--accent)' },
    alert:   { tg: 'ALERT',  c: 'var(--red)' }
  };
  function fetchWxAlerts() {
    getJSON('/api/wx/state').then(function (d) {
      wxAlerts = ((d && d.alerts && d.alerts.active) || []).map(function (a) {
        return { ts: Date.now(), tg: 'ALERT', c: 'var(--red)', x: (a.event || a.headline || 'WEATHER ALERT') };
      });
    }).catch(function () {});
  }
  function buildTicker() {
    var rows = [];
    newsRaw.forEach(function (i) {
      var m = TAGMAP[i.tag] || TAGMAP.news;
      rows.push({ ts: +i.ts || Date.now(), tg: m.tg, c: m.c, x: i.title || i.summary || '' });
    });
    meshRows.forEach(function (m) {
      rows.push({ ts: m.d.getTime(), tg: 'MESH', c: '#9aa520', x: m.cs + ': ' + m.msg });
    });
    wxAlerts.forEach(function (a) { rows.push(a); });
    rows.sort(function (a, b) { return b.ts - a.ts; });
    var out = rows.slice(0, 18).map(function (r) { return { tg: r.tg, c: r.c, t: hhmmZ(r.ts), x: r.x }; });
    if (out.length) H.ticker(out);
  }

  /* ================= schedule (visibility-aware, spec 7) ================= */
  function safe(fn) { try { fn(); } catch (e) {} }
  // When the HOME window is occluded (an app opened above the desktop) the
  // document goes hidden → stretch every poll interval ×6 to cut idle CPU.
  // Restores to 1× the moment HOME is visible again.
  var pollMult = (typeof document.visibilityState === 'string' && document.visibilityState === 'hidden') ? 6 : 1;
  function schedule(fn, baseMs) {
    (function tick() { safe(fn); setTimeout(tick, baseMs * pollMult); })();
  }
  document.addEventListener('visibilitychange', function () {
    var hidden = document.visibilityState === 'hidden';
    pollMult = hidden ? 6 : 1;
    if (!hidden) { safe(fetchStatus); safe(fetchMesh); }   // snap-refresh on re-show
  });

  schedule(fetchStatus, 5000);
  schedule(fetchMesh, 10000);
  schedule(fetchNews, 60000);
  schedule(fetchWxAlerts, 60000);
  schedule(fetchCrime, 180000);
  setTimeout(function () { schedule(buildTicker, 30000); }, 1500);

  window.DBHomeLive = { fetchStatus: fetchStatus, fetchMesh: fetchMesh, fetchNews: fetchNews, fetchCrime: fetchCrime, buildTicker: buildTicker, showOffline: showOffline, hideOffline: hideOffline };
})();
