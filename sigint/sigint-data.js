/* ============================================================
   DOOM BOX — SIGINT DATA (LIVE)
   Real sigint-controller integration. Replaces the mock simulator.
   Wires: /api/sigint/{status,devices,beacons,probes,events,sparkline,
                       whitelist,mode}
   Graceful-offline aware (CLAUDE.md §10 2026-05-14): every endpoint
   returns HTTP 200 + {ok:false, mode:"offline", status:"inactive"}
   when the controller service is stopped.

   SAFETY: mode POST to "monitor" takes wlan1 DOWN as an AP and drops
   every wlan1 client. The render layer gates that behind a confirm
   dialog. This data layer never auto-switches mode.

   Keeps the S.* surface the render (sigint.js) consumes:
     S.devices, S.beacons, S.HOP_PLAN, S.OUI_COUNT, S.MAX_MODE_MS,
     S.clsLabel, S.statusLabel, S.lastText, S.zulu, S.zuluFromMin
   ============================================================ */
window.DBSigint = window.DBSigint || {};
(function (S) {
  "use strict";

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  S.zulu = function (d) { return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + 'Z'; };
  S.zuluFromMin = function (m) { return S.zulu(new Date(Date.now() - m * 60000)); };

  /* ---- constants ---- */
  S.MAX_MODE_MS = 30 * 60 * 1000;            // 30-min auto-revert (controller-enforced)
  // Live OUI cache loaded by the controller at start: Wireshark `manuf`
  // (~39.3k 24-bit + 6.4k 28-bit + ~11.4k 36-bit). Static — no live endpoint
  // exposes the count, so this mirrors the controller's loaded set size.
  S.OUI_COUNT = 57087;
  // Reconstructed from /api/sigint/status channels_24 + channels_5 on first
  // poll (see S.buildHopPlan). Default = the documented interleaved 18-plan.
  S.HOP_PLAN = [1, 36, 6, 40, 11, 44, 1, 48, 6, 149, 11, 153, 1, 157, 6, 161, 11, 165];

  S.clsLabel = { known: 'KNOWN', random: 'RANDOMIZED', unknown: 'UNKNOWN' };
  S.statusLabel = { active: 'ACTIVE', stale: 'STALE', gone: 'GONE' };
  S.lastText = function (m) {
    if (m <= 0) return 'now';
    if (m < 60) return m + 'm';
    if (m < 1440) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    var dd = Math.floor(m / 1440); return dd + 'd ' + Math.floor((m % 1440) / 60) + 'h';
  };

  /* live containers (consumed by render) */
  S.devices = [];
  S.beacons = [];
  S.status = null;          // last /api/sigint/status
  S.session = { devices: 0, packets: 0, started: 0 };

  /* ============================================================ FETCH */
  S.api = {
    getJSON: function (url) {
      return fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error(url + ' -> ' + r.status);
        return r.json();
      });
    },
    postJSON: function (url, body) {
      return fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      }).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'bad response' }; }); });
    }
  };

  // Graceful-offline: controller stopped -> {ok:false, mode:"offline", status:"inactive"}
  S.isOffline = function (s) { return !s || s.ok === false || s.status === 'inactive' || s.mode === 'offline'; };

  /* ============================================================ HOP PLAN
     The controller hops an interleaved 2.4+5 GHz plan: for each 5 GHz
     channel, pair it with a cycling 2.4 GHz channel (1,6,11,1,6,11,...).
     channels_24=[1,6,11] x channels_5(9) -> 18 positions. */
  S.buildHopPlan = function (c24, c5) {
    if (!c24 || !c24.length || !c5 || !c5.length) return S.HOP_PLAN;
    var plan = [];
    for (var i = 0; i < c5.length; i++) { plan.push(c24[i % c24.length]); plan.push(c5[i]); }
    return plan;
  };

  /* ============================================================ MAPPERS */
  // real classification cascade pi/whitelist/random/unknown -> render cls.
  S.mapCls = function (c) {
    if (c === 'pi' || c === 'whitelist') return 'known';
    if (c === 'random') return 'random';
    return 'unknown';
  };

  // stable numeric uid per MAC (render parses data-uid with +, and tracks
  // the expanded row by uid across re-polls).
  S._uidMap = S._uidMap || {}; S._uidSeq = S._uidSeq || 0;
  function uidFor(mac) { if (!S._uidMap[mac]) S._uidMap[mac] = ++S._uidSeq; return S._uidMap[mac]; }

  // honest "seen" string: today -> HH:MM:SSZ, older -> "MMM DD HH:MMZ".
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  S.seenStr = function (tsSec) {
    if (!tsSec) return '—';
    var d = new Date(tsSec * 1000), now = new Date();
    var hms = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + 'Z';
    if (d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth() && d.getUTCDate() === now.getUTCDate()) return hms;
    return MON[d.getUTCMonth()] + ' ' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + 'Z';
  };

  function mapDevice(rd) {
    var cls = S.mapCls(rd.classification);
    var nowS = Date.now() / 1000;
    var firstMin = Math.max(0, Math.round((nowS - (rd.first_seen_ts || nowS)) / 60));
    var lastMin = Math.max(0, Math.round((nowS - (rd.last_seen_ts || nowS)) / 60));
    var status = lastMin <= 2 ? 'active' : lastMin <= 12 ? 'stale' : 'gone';
    var mfr = (cls === 'random') ? 'Randomized (LAA)' : (rd.oui_org || rd.oui_short || 'Unknown vendor');
    var best = (rd.best_rssi == null ? -99 : rd.best_rssi);
    var hist = []; for (var i = 0; i < 60; i++) hist.push(best);   // flat seed until sparkline loads
    return {
      uid: uidFor(rd.mac),
      mac: rd.mac.toUpperCase(),
      rawMac: rd.mac,
      mfr: mfr,
      cls: cls,
      classificationRaw: rd.classification,
      firstMin: firstMin, lastMin: lastMin,
      firstSeen: S.seenStr(rd.first_seen_ts), lastSeen: S.seenStr(rd.last_seen_ts),
      status: status,
      rssi: best,
      worstRssi: (rd.worst_rssi == null ? best : rd.worst_rssi),
      hist: hist, _sparkLoaded: false,
      packets: rd.probe_count || 0,
      sessionCount: rd.session_count || 0,
      distinctLocations: rd.distinct_locations || 0,
      positionOverlap: !!rd.position_overlap,
      seenMultiple: !!rd.seen_multiple_sessions,
      recentPersistent: !!rd.recent_persistent,
      probes: [],
      pol: !!(rd.recent_persistent || rd.seen_multiple_sessions) && cls !== 'known',
      whitelisted: (cls === 'known'),
      alerted: false,
      channel: null
    };
  }

  function encLabel(e) {
    e = (e || '').toLowerCase();
    return e === 'wpa3' ? 'WPA3' : e === 'wpa2' ? 'WPA2' : e === 'wpa' ? 'WPA' :
      e === 'open' ? 'OPEN' : e === 'wep' ? 'WEP' : (e ? e.toUpperCase() : '?');
  }
  function mapBeacon(rb) {
    var ch = rb.channel || 0;
    return {
      ssid: rb.ssid || '(hidden)',
      bssid: (rb.bssid || '').toUpperCase(),
      channel: ch,
      rssi: (rb.best_rssi == null ? -99 : rb.best_rssi),
      enc: encLabel(rb.encryption),
      band: (ch && ch <= 14) ? '2.4' : '5'
    };
  }

  /* ============================================================ LOADERS */
  S.loadStatus = function () {
    return S.api.getJSON('/api/sigint/status').then(function (s) {
      S.status = s;
      if (!S.isOffline(s)) S.HOP_PLAN = S.buildHopPlan(s.channels_24, s.channels_5);
      return s;
    }).catch(function () { S.status = null; return null; });
  };

  // session: 'all' (default, historical + current) or 'current'
  S.loadDevices = function (session) {
    return S.api.getJSON('/api/sigint/devices?session=' + (session || 'all')).then(function (j) {
      if (S.isOffline(j) || !j.devices) { S.devices = []; return S.devices; }
      // preserve client-only flags (alerted) + loaded sparklines across polls
      var prev = {}; S.devices.forEach(function (d) { prev[d.rawMac] = d; });
      S.devices = j.devices.map(function (rd) {
        var d = mapDevice(rd), old = prev[rd.mac];
        if (old) { d.alerted = old.alerted; if (old._sparkLoaded) { d.hist = old.hist; d._sparkLoaded = true; d.channel = old.channel; } if (old.probes && old.probes.length) d.probes = old.probes; }
        return d;
      });
      S.session.devices = S.devices.length;
      S.session.packets = S.devices.reduce(function (a, d) { return a + d.packets; }, 0);
      return S.devices;
    }).catch(function () { return S.devices; });
  };

  S.loadBeacons = function () {
    return S.api.getJSON('/api/sigint/beacons').then(function (j) {
      if (S.isOffline(j) || !j.beacons) { S.beacons = []; return S.beacons; }
      S.beacons = j.beacons.map(mapBeacon).sort(function (a, b) { return b.rssi - a.rssi; });
      return S.beacons;
    }).catch(function () { return S.beacons; });
  };

  // one device's RSSI history (60 samples). caches into the device object.
  S.loadSparkline = function (dev, session) {
    return S.api.getJSON('/api/sigint/sparkline?mac=' + encodeURIComponent(dev.rawMac) + '&session=' + (session || 'all'))
      .then(function (j) {
        var samples = (j && j.samples) ? j.samples : [];
        if (samples.length) {
          dev.hist = samples.map(function (s) { return (s.rssi == null ? dev.rssi : s.rssi); });
          var lastCh = samples[samples.length - 1].channel;
          if (lastCh != null) dev.channel = lastCh;
        }
        dev._sparkLoaded = true;
        return dev.hist;
      }).catch(function () { dev._sparkLoaded = true; return dev.hist; });
  };

  // aggregate probe-request SSIDs per MAC (only populated during live monitor
  // capture; the probes ring is empty in hotspot mode).
  S.loadProbes = function () {
    return S.api.getJSON('/api/sigint/probes?since=0&limit=2000').then(function (j) {
      var probes = (j && j.probes) ? j.probes : [];
      if (!probes.length) return;
      var byMac = {};
      probes.forEach(function (p) {
        var mac = (p.mac || p.ta || '').toUpperCase(); if (!mac) return;
        var ssid = p.ssid; if (!ssid) return;
        (byMac[mac] = byMac[mac] || {})[ssid] = 1;
      });
      S.devices.forEach(function (d) { if (byMac[d.mac]) d.probes = Object.keys(byMac[d.mac]); });
    }).catch(function () {});
  };

  S.loadEventsSince = function (sinceMs) {
    return S.api.getJSON('/api/sigint/events?since=' + (sinceMs || 0)).then(function (j) {
      if (S.isOffline(j)) return [];
      return (j && (j.events || j.items)) ? (j.events || j.items) : [];
    }).catch(function () { return []; });
  };

  /* ============================================================ ACTIONS */
  // SAFETY: monitor drops every wlan1 AP client. Caller must confirm first.
  S.setMonitor = function (label) { return S.api.postJSON('/api/sigint/mode', { mode: 'monitor', location_label: label || 'field' }); };
  S.setHotspot = function () { return S.api.postJSON('/api/sigint/mode', { mode: 'hotspot' }); };

})(window.DBSigint);
