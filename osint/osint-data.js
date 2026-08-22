/* ============================================================
   DOOM BOX — OSINT DATA (LIVE, 2026-06-04)
   Real multi-source feed. Replaces the mock simulator.
   Sources:
     /dashboard/data/crime/cfs-recent.geojson   LVMPD CFS incidents
     /dashboard/data/news/news-recent.json      LV news (tagged news/crime/alert/weather)
     /api/wx/state                              NWS active alerts
     /api/mesh/{messages,events}                Meshtastic chat + link events
     /api/sigint/events                         passive 802.11 capture events
   Freshness (REFRESH STATUS panel):
     /api/crime/status  /api/news/status  /api/wx/status
   Category colors preserve the V1 OSINT palette:
     white=NEWS  orange=CRIME  yellow=WEATHER  red=ALERT  olive=MESH  purple=SIGINT
   Attaches to window.DBOsint.
   ============================================================ */
window.DBOsint = window.DBOsint || {};
(function (O) {
  "use strict";

  /* ---- absolute paths: v2 is served at /dashboard-v2/ but the data dir and
          api live under /dashboard/ and /api/ — relative paths would 404. ---- */
  var DATA = '/dashboard/data/';

  O.CATS = [
    { id: 'all', icon: '⌂', name: 'ALL FEEDS', desc: 'Combined chronological feed from active categories' },
    { id: 'crime', icon: '◉', name: 'CRIME', group: 'LOCAL', desc: 'LVMPD violent crime + calls-for-service', srcLabel: 'LVMPD CFS + crime news', tag: 'CRIME', tagClass: 'tag-crime', updated: null },
    { id: 'news', icon: '◎', name: 'LOCAL NEWS', group: 'LOCAL', desc: 'Las Vegas regional news', srcLabel: 'Review-Journal, LV Sun, KLAS 8', tag: 'NEWS', tagClass: 'tag-news', updated: null },
    { id: 'alert', icon: '⚠', name: 'ALERTS', group: 'PRIORITY', desc: 'Breaking / high-severity items', srcLabel: 'Wire alerts + severe Wx', tag: 'ALERT', tagClass: 'tag-alert', updated: null },
    { id: 'weather', icon: '☁', name: 'WEATHER', group: 'PRIORITY', desc: 'NWS alerts + weather reporting', srcLabel: 'NWS Las Vegas (VEF)', tag: 'WX', tagClass: 'tag-weather', updated: null },
    { id: 'mesh', icon: '⊟', name: 'MESH', group: 'COMMS', desc: 'Meshtastic chat + link events', srcLabel: 'Heltec V4 / LoRa', tag: 'MESH', tagClass: 'tag-mesh', updated: null },
    { id: 'sigint', icon: '⊡', name: 'SIGINT', group: 'COMMS', desc: 'Passive 802.11 capture events', srcLabel: 'wlan1 monitor', tag: 'SIGINT', tagClass: 'tag-sigint', updated: null }
  ];
  O.catById = {}; O.CATS.forEach(function (c) { O.catById[c.id] = c; });

  /* per-source toggles. item.source must match one of these names for the
     toggle to filter it; unknown sources pass through unfiltered (passes()
     only drops on an explicit `=== false`). */
  O.SOURCES = {
    crime: [{ n: 'LVMPD CFS', on: 1 }, { n: 'LV Review-Journal', on: 1 }, { n: 'LV Sun', on: 1 }, { n: 'KLAS 8 News Now', on: 1 }],
    news: [{ n: 'LV Review-Journal', on: 1 }, { n: 'LV Sun', on: 1 }, { n: 'KLAS 8 News Now', on: 1 }],
    alert: [{ n: 'LV Review-Journal', on: 1 }, { n: 'LV Sun', on: 1 }, { n: 'KLAS 8 News Now', on: 1 }, { n: 'NWS Las Vegas', on: 1 }],
    weather: [{ n: 'NWS Las Vegas', on: 1 }, { n: 'LV Review-Journal', on: 1 }, { n: 'LV Sun', on: 1 }, { n: 'KLAS 8 News Now', on: 1 }],
    mesh: [{ n: 'Mesh chat', on: 1 }, { n: 'Link events', on: 1 }],
    sigint: [{ n: 'SIGINT events', on: 1 }]
  };

  /* CRED kept for render-layer compatibility (war items used it; none now). */
  O.CRED = [['#5DD87A', 'primary / official'], ['#E8B54A', 'established outlet'], ['#8898AA', 'unverified / single source']];

  /* ---- helpers ---- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  O.zulu = function (d) { function p(n) { return (n < 10 ? '0' : '') + n; } return '[' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + 'Z]'; };
  O.sinceText = function (d) { var m = Math.floor((Date.now() - d) / 60000); if (m < 0) m = 0; if (m < 60) return m + ' min ago'; var h = Math.floor(m / 60); if (h < 24) return h + 'h ' + (m % 60) + 'm ago'; return Math.floor(h / 24) + 'd ago'; };

  var UNREAD_WINDOW_MS = 6 * 3600 * 1000;   // unread = arrived in last 6 h
  function unreadFor(ts) { return (Date.now() - ts) < UNREAD_WINDOW_MS; }

  /* news source-code → friendly outlet name (matches O.SOURCES keys) */
  function newsOutlet(code) {
    code = String(code || '');
    if (code.indexOf('lvrj') === 0) return 'LV Review-Journal';
    if (code.indexOf('lvsun') === 0) return 'LV Sun';
    if (code.indexOf('klas') === 0) return 'KLAS 8 News Now';
    return code || 'Local feed';
  }

  /* CFS category → offense chip label (maps to .off-* CSS) */
  function cfsOffense(cat) {
    switch (cat) {
      case 'shoot': return 'SHOOTING';
      case 'weapon': return 'WEAPONS';
      case 'robbery': return 'ROBBERY';
      case 'assault': return 'ASSAULT';
      default: return 'INCIDENT';
    }
  }
  function cfsSeverity(cat) { return (cat === 'shoot' || cat === 'weapon') ? 2 : (cat === 'robbery' || cat === 'assault') ? 1 : 0; }

  /* dedup memory across poll cycles */
  O._seen = O._seen || new Set();
  var meshMsgSince = 0, meshEvtSince = 0, sigintSince = 0;

  /* ---- per-source loaders (each resolves to an item[] and never rejects) ---- */

  function loadCrime() {
    return fetch(DATA + 'crime/cfs-recent.geojson', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { features: [] }; })
      .then(function (fc) {
        var feats = (fc.features || []).slice();
        feats.sort(function (a, b) { return ((b.properties || {}).IncidentDate || 0) - ((a.properties || {}).IncidentDate || 0); });
        feats = feats.slice(0, 220);   // cap DOM weight; time filter trims further
        return feats.map(function (f) {
          var p = f.properties || {}, g = f.geometry || {};
          var c = (g.coordinates) || [], lon = c[0], lat = c[1];
          var ts = p.IncidentDate || Date.now();
          var cls = (p.Classification || p.IncidentTypeDescription || 'Incident').trim();
          var addr = (p.Address || '').trim();
          var open = !p.Disposition;   // no disposition yet → treat as open
          return {
            id: 'cfs:' + (p.IncidentNumber || (lat + ',' + lon + ',' + ts)),
            cat: 'crime', isCfs: true, source: 'LVMPD CFS',
            ts: new Date(ts), headline: cls + (addr ? ' — ' + addr : ''),
            excerpt: 'CFS dispatch · ' + (p.IncidentTypeDescription || cls) + (p.ZipCode ? ' · ZIP ' + p.ZipCode : ''),
            body: '<p>' + esc(p.IncidentTypeDescription || cls) + '</p>' +
                  '<p>Incident #' + esc(p.IncidentNumber || '—') + ' · disposition ' + esc(p.Disposition || '—') + ' · ZIP ' + esc(p.ZipCode || '—') + '</p>',
            offense: cfsOffense(p.category), intersection: addr || '—',
            cfs: open ? 'OPEN' : 'CLOSED', sinceMin: Math.floor((Date.now() - ts) / 60000),
            loc: (lat != null && lon != null) ? { lat: lat, lon: lon } : null,
            unread: unreadFor(ts), pinned: false, severity: cfsSeverity(p.category)
          };
        });
      })
      .catch(function () { return []; });
  }

  function loadNews() {
    return fetch(DATA + 'news/news-recent.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (j) {
        var items = (j.items || []).slice(0, 280);
        return items.map(function (it) {
          var tag = it.tag || 'news';
          var cat = tag === 'alert' ? 'alert' : tag === 'weather' ? 'weather' : tag === 'crime' ? 'crime' : 'news';
          var sev = tag === 'alert' ? 2 : (tag === 'weather' || tag === 'crime') ? 1 : 0;
          var ts = it.ts || Date.now();
          return {
            id: 'news:' + (it.id || ts), cat: cat, source: newsOutlet(it.source),
            ts: new Date(ts), headline: (it.title || it.headline || '(untitled)').trim(),
            excerpt: (it.summary || it.title || '').trim() || 'Source reporting; tap to expand.',
            body: '<p>' + esc(it.summary || it.title || '') + '</p>',
            url: it.url || null, unread: unreadFor(ts), pinned: false, severity: sev
          };
        });
      })
      .catch(function () { return []; });
  }

  function loadWx() {
    return fetch('/api/wx/state', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var active = (j && j.alerts && j.alerts.active) || [];
        return active.map(function (a) {
          var when = a.effective || a.onset || a.sent || a.expires || null;
          var ts = when ? Date.parse(when) : Date.now();
          var severe = (a.severity === 'Extreme' || a.severity === 'Severe');
          var cat = severe ? 'alert' : 'weather';   // severe Wx → red ALERT (matches V1)
          var hl = (a.headline || '').split(' by ')[0];
          var body = esc((a.description || a.headline || a.event || '').slice(0, 1400)).replace(/\n\n+/g, '</p><p>').replace(/\n/g, ' ');
          return {
            id: 'wx:' + (a.id || a.event + ts), cat: cat, source: 'NWS Las Vegas',
            ts: new Date(ts), headline: (a.event || 'Weather alert') + (hl ? ' — ' + hl : ''),
            excerpt: (a.headline || a.event || 'NWS alert').trim(),
            body: '<p>' + body + '</p>',
            region: a.severity ? a.severity.toUpperCase() : null,
            unread: true, pinned: false, severity: severe ? 2 : 1
          };
        });
      })
      .catch(function () { return []; });
  }

  function loadMesh() {
    var p1 = fetch('/api/mesh/messages?since=0', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        return ((j && j.items) || []).slice(-40).map(function (m) {
          var who = m.direction === 'tx' ? '→ ' + (m.to || '^all') : (m.fromName || m.from || '?');
          var txt = (m.text || '').trim();
          var ts = m.ts_ms || Date.now();
          return {
            id: 'mesh-msg:' + (m.id || ts), cat: 'mesh', source: 'Mesh chat',
            ts: new Date(ts), headline: who + ': ' + (txt.length > 90 ? txt.slice(0, 87) + '…' : txt),
            excerpt: 'Meshtastic TEXT_MESSAGE_APP', body: '<p>' + esc(txt) + '</p>',
            unread: unreadFor(ts), pinned: false, severity: 0
          };
        });
      }).catch(function () { return []; });
    var p2 = fetch('/api/mesh/events?since=0', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        return ((j && j.items) || []).slice(-20).map(function (ev) {
          // connection.failed is transient serial-reconnect noise (can spam the
          // ring buffer); the MESH/SYS tabs surface link health. Drop it here.
          var msg = ev.kind === 'connection.established' ? 'mesh connected'
            : ev.kind === 'connection.lost' ? 'mesh DISCONNECTED'
            : ev.kind === 'node.up' ? ('node up: ' + (ev.label || ev.node_id || '')) : null;
          if (!msg) return null;
          var ts = ev.ts_ms || Date.now();
          var down = ev.kind === 'connection.lost';
          return {
            id: 'mesh-evt:' + ev.kind + ':' + ts, cat: 'mesh', source: 'Link events',
            ts: new Date(ts), headline: msg, excerpt: 'Mesh link event',
            body: '<p>' + esc(msg) + '</p>', unread: unreadFor(ts), pinned: false, severity: down ? 1 : 0
          };
        }).filter(Boolean);
      }).catch(function () { return []; });
    return Promise.all([p1, p2]).then(function (a) { return a[0].concat(a[1]); });
  }

  function loadSigint() {
    return fetch('/api/sigint/events?since=0', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var evs = (j && (j.events || j.items)) || [];
        return evs.slice(-40).map(function (ev) {
          var msg, sev = 0;
          if (ev.kind === 'sigint.unknown') {
            var oui = ev.oui_short ? ' (' + ev.oui_short + ')' : '';
            var ssid = ev.ssid ? " probing '" + (ev.ssid.length > 30 ? ev.ssid.slice(0, 27) + '…' : ev.ssid) + "'" : ' (wildcard probe)';
            msg = 'Unknown device ' + ev.mac + oui + ssid + (ev.rssi != null ? ' · ' + ev.rssi + ' dBm' : ''); sev = 1;
          } else if (ev.kind === 'mode.transition_start') { msg = 'wlan1 → ' + ev.to; }
          else if (ev.kind === 'session.start') { msg = 'session ' + ev.session_id + ' start · "' + (ev.location_label || 'default') + '"'; }
          else if (ev.kind === 'session.end') { msg = 'session ' + ev.session_id + ' end · ' + (ev.unique_macs || 0) + ' unique'; }
          else if (ev.kind === 'auto_revert.fire') { msg = 'auto-revert fired after ' + ev.after_s + 's'; sev = 1; }
          else if (ev.kind === 'mode.error') { msg = 'MODE ERROR (' + ev.phase + '): ' + (ev.error || ''); sev = 2; }
          else return null;
          var ts = ev.ts_ms || Date.now();
          return {
            id: 'sigint-evt:' + ev.kind + ':' + (ev.mac || ev.session_id || ts), cat: 'sigint', source: 'SIGINT events',
            ts: new Date(ts), headline: msg, excerpt: 'Passive 802.11 capture',
            body: '<p>' + esc(msg) + '</p>', unread: unreadFor(ts), pinned: false, severity: sev
          };
        }).filter(Boolean);
      })
      .catch(function () { return []; });
  }

  function fetchSnapshot() {
    return Promise.all([loadCrime(), loadNews(), loadWx(), loadMesh(), loadSigint()])
      .then(function (parts) {
        var all = [];
        parts.forEach(function (p) { all = all.concat(p); });
        all.sort(function (a, b) { return b.ts - a.ts; });   // newest first
        return all;
      });
  }

  /* ---- public API consumed by osint.js ---- */

  // synchronous initial value (render shows a loading/empty state until loadAll resolves)
  O.build = function () { return []; };

  // full snapshot; seeds the dedup set
  O.loadAll = function () {
    return fetchSnapshot().then(function (list) {
      O._seen = new Set();
      list.forEach(function (i) { O._seen.add(i.id); });
      return list;
    });
  };

  // only items not seen before (for the "N new items" banner)
  O.poll = function () {
    return fetchSnapshot().then(function (list) {
      var fresh = list.filter(function (i) { return !O._seen.has(i.id); });
      fresh.forEach(function (i) { O._seen.add(i.id); });
      // bound memory
      if (O._seen.size > 4000) { O._seen = new Set(list.map(function (i) { return i.id; })); }
      return fresh;
    });
  };

  // update each category's "updated N min ago" from the fetcher status endpoints
  O.refreshStatus = function (done) {
    function setAge(catId, sec) { if (sec != null && O.catById[catId]) O.catById[catId].updated = Math.max(0, Math.floor(sec / 60)); }
    var jobs = [
      fetch('/api/crime/status', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var ds = j && j.datasets; if (ds && ds.cfs) setAge('crime', ds.cfs.age_seconds);
      }).catch(function () {}),
      fetch('/api/news/status', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var ds = (j && j.datasets) || {}; var ages = Object.keys(ds).map(function (k) { return ds[k].age_seconds; }).filter(function (x) { return x != null; });
        var m = ages.length ? Math.min.apply(null, ages) : null; setAge('news', m); setAge('alert', m);
      }).catch(function () {}),
      fetch('/api/wx/status', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        // wx/status may carry per-category fetch info; fall back to "fresh" (0) if present at all
        if (j) { var a = null; try { var vals = Object.keys(j).map(function (k) { return j[k] && j[k].age_seconds; }).filter(function (x) { return x != null; }); a = vals.length ? Math.min.apply(null, vals) : 0; } catch (_) { a = 0; } setAge('weather', a); }
      }).catch(function () {})
    ];
    Promise.all(jobs).then(function () { if (done) done(); });
  };

})(window.DBOsint);
