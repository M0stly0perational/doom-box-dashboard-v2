/* ============================================================
   DOOM BOX — MESH DATA (LIVE)
   Wired to Node-RED /api/mesh/* endpoints. window.DBMesh.
   Maps the real bridge data shapes onto the object shapes the
   V2 render layer (mesh.js) consumes. No mock generation.
   ============================================================ */
window.DBMesh = window.DBMesh || {};
(function (M) {
  "use strict";

  function pad(n, l) { n = String(n); while (n.length < l) n = '0' + n; return n; }
  M.zulu  = function (d) { return '[' + pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2) + ':' + pad(d.getUTCSeconds(), 2) + 'Z]'; };
  M.zuluS = function (d) { return pad(d.getUTCHours(), 2) + pad(d.getUTCMinutes(), 2) + 'Z'; };

  // ---- per-callsign HSL color — COPIED VERBATIM from V1 dashboard js/mesh.js
  //      callsignColor(). Do NOT rewrite; the exact hash + 70%/65% lightness
  //      is the canonical DOOM BOX chat palette.
  M.csColor = function (cs) {
    var h = 0; var str = String(cs || "?");
    for (var i = 0; i < str.length; i++) h = ((h * 31) + str.charCodeAt(i)) | 0;
    return 'hsl(' + (Math.abs(h) % 360) + ' 70% 65%)';
  };

  // Operating area default (Las Vegas) — used as a fallback when the local
  // node has no GPS fix yet (matches CLAUDE.md operating-area default).
  var OWN = { lat: 36.17, lon: -115.14 };
  M.OWN = OWN;

  // ---- live state ----
  M.nodes       = [];
  M.channels    = [];
  M.chanMsgs    = [];      // primary-channel scrollback (V2 ST.active === 'ch0')
  M.dmThreads   = {};      // keyed by peer hex id
  M.connected   = false;
  M.myNodeId    = null;
  M.myShort     = 'DMBX';
  M.nodeCount   = 0;

  M.messagesSince = 0;
  M.eventsSince   = 0;

  var snrHist  = {};       // hex -> [snr,...] (cap 10)
  var seenMsg  = new Set();// dedup polled messages
  var seenEvt  = new Set();// dedup polled events
  var echoedTx = [];       // optimistic-echo suppression: {text, ts}

  M.self = function () {
    if (M.myNodeId) { var s = M.nodes.find(function (n) { return n.hex === M.myNodeId; }); if (s) return s; }
    return M.nodes[0] || { hex: '!unknown', short: 'DMBX', name: 'DOOM BOX', self: true, lat: OWN.lat, lon: OWN.lon, bat: null, snrHist: [], alertCfg: {} };
  };
  M.heardClass = function (m) { return m <= 5 ? 'dot-5' : m <= 30 ? 'dot-30' : m <= 1440 ? 'dot-24' : 'dot-old'; };
  M.lastText = function (m) {
    if (m == null || m >= 99999) return 'never';
    return m === 0 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago' : Math.floor(m / 1440) + 'd ago';
  };

  // ===== fetch helpers =====
  function getJSON(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }); }
  function postJSON(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false, err: 'bad response' }; });
  }

  // ===== mapping: real node -> V2 render shape =====
  function shortFor(id) {
    var n = M.nodes.find(function (x) { return x.hex === id; });
    if (n) return n.short || n.name || id;
    return id;
  }
  function nameFor(id) {
    var n = M.nodes.find(function (x) { return x.hex === id; });
    return n ? (n.name || n.short || id) : id;
  }

  function mapNode(raw, myId) {
    var u = raw.user || {};
    var dm = raw.deviceMetrics || {};
    var pos = raw.position || null;
    var id = raw.id || u.id || '!unknown';
    var self = (id === myId);
    var lastHeard = raw.lastHeard || null; // epoch seconds
    var lastMin = self ? 0 : (lastHeard ? Math.max(0, Math.floor((Date.now() / 1000 - lastHeard) / 60)) : 99999);
    var hasGps = !!(pos && typeof pos.lat === 'number' && typeof pos.lon === 'number');
    var bl = (dm.batteryLevel == null) ? null : dm.batteryLevel;

    // snr history (rolling, cap 10)
    if (raw.snr != null) {
      var arr = snrHist[id] || []; arr.push(+raw.snr); if (arr.length > 10) arr.splice(0, arr.length - 10); snrHist[id] = arr;
    }

    return {
      uid: raw.num, hex: id,
      name: u.longName || '',
      short: u.shortName || id.slice(0, 5),
      hw: u.hwModel || '—',
      role: u.role || '—',
      self: self,
      fav: !!raw.isFavorite,
      lastMin: lastMin,
      lastHeard: lastHeard,
      hops: (raw.hopsAway != null ? raw.hopsAway : (self ? 0 : null)),
      snr: (raw.snr != null ? raw.snr : null),
      rssi: (raw.rssi != null ? raw.rssi : null),
      bat: bl,
      usb: (bl === 101),
      volt: (dm.voltage != null ? +Number(dm.voltage).toFixed(2) : null),
      charging: (bl === 101),
      gps: hasGps,
      lat: hasGps ? pos.lat : null,
      lon: hasGps ? pos.lon : null,
      alt: (pos && pos.alt != null ? pos.alt : 0),
      prec: 12,
      known: !!u.longName,
      fw: '—',
      pubkey: '',
      chanUtil: (dm.channelUtilization != null ? +Number(dm.channelUtilization).toFixed(1) : 0),
      airTx: (dm.airUtilTx != null ? +Number(dm.airUtilTx).toFixed(2) : 0),
      uptime: (dm.uptimeSeconds != null ? dm.uptimeSeconds : 0),
      viaMqtt: !!raw.viaMqtt,
      firstMin: lastMin,
      msgsRx: 0, msgsTx: 0, dmsSent: 0, dmsRx: 0,
      snrHist: (snrHist[id] || []).slice(),
      alertCfg: { first: true, lost: true }
    };
  }

  function roleLabel(role) {
    var r = String(role);
    if (r === '1' || r === 'PRIMARY') return 'PRIMARY';
    if (r === '2' || r === 'SECONDARY') return 'SECONDARY';
    return 'DISABLED';
  }

  function mapChannels(stateChannels, prev) {
    var prevByIdx = {};
    (prev || []).forEach(function (c) { prevByIdx[c.idx] = c; });
    var heard5m = M.nodes.filter(function (n) { return n.lastMin <= 5; }).length;
    return (stateChannels || []).map(function (c) {
      var configured = String(c.role) !== '0' && String(c.role) !== 'DISABLED';
      var p = prevByIdx[c.index];
      return {
        idx: c.index,
        name: c.name || ('CH ' + c.index),
        role: roleLabel(c.role),
        configured: configured,
        preset: c.modemPreset || 'LongFast',
        psk: (c.psk_status ? String(c.psk_status).toUpperCase() : '—'),
        modem: c.modemPreset || 'LONG_FAST',
        freq: '915 MHz',
        uplink: false, downlink: false,
        nodes: configured ? M.nodeCount : 0,
        active: configured ? heard5m : 0,
        unread: p ? (p.unread || 0) : 0
      };
    });
  }

  // ===== public fetchers (return a small summary for the render layer) =====
  M.fetchState = function () {
    return getJSON('/api/mesh/state').then(function (s) {
      M.connected = !!s.connected;
      if (s.my_node) { M.myNodeId = s.my_node.id; M.myShort = s.my_node.shortName || 'DMBX'; }
      M.nodeCount = (s.node_count != null) ? s.node_count : M.nodes.length;
      M.channels = mapChannels(s.channels, M.channels);
      return { ok: true, connected: M.connected, nodeCount: M.nodeCount, raw: s };
    }).catch(function () { M.connected = false; return { ok: false }; });
  };

  M.fetchNodes = function () {
    return getJSON('/api/mesh/nodes').then(function (d) {
      var myId = M.myNodeId;
      var list = (d.nodes || []).filter(function (n) { return n && (n.id || (n.user && n.user.id)); }).map(function (n) { return mapNode(n, myId); });
      // self first, then favorites, then the rest — render also re-sorts, this is just a stable base
      M.nodes = list;
      if (d.count != null) M.nodeCount = d.count;
      return { ok: true, count: M.nodes.length };
    }).catch(function () { return { ok: false, count: M.nodes.length }; });
  };

  // Push a mapped chat line into the primary-channel buffer (with dedup).
  function ingestChan(line, key) {
    if (key) { if (seenMsg.has(key)) return false; seenMsg.add(key); }
    M.chanMsgs.push(line);
    if (M.chanMsgs.length > 500) M.chanMsgs.shift();
    return true;
  }
  function ingestDm(peerHex, line, key) {
    if (key) { if (seenMsg.has(key)) return false; seenMsg.add(key); }
    var th = M.dmThreads[peerHex];
    if (!th) { th = M.dmThreads[peerHex] = { node: (M.nodes.find(function (n) { return n.hex === peerHex; }) || { hex: peerHex, short: shortFor(peerHex), name: nameFor(peerHex) }), msgs: [] }; }
    th.msgs.push(line);
    if (th.msgs.length > 500) th.msgs.shift();
    return true;
  }

  // initial=true ingests historical ^local tx too (full scrollback); live polls
  // skip ^local tx because the composer already echoes those optimistically.
  M.fetchMessages = function (initial) {
    return getJSON('/api/mesh/messages?since=' + M.messagesSince).then(function (j) {
      var items = j.items || j.messages || [];
      var addedChan = false, addedDm = false;
      items.forEach(function (m) {
        var ts = m.ts_ms || m.ts || Date.now();
        if (ts > M.messagesSince) M.messagesSince = ts;
        var from = m.from || '';
        var to = String(m.to || '');
        var isTx = m.direction === 'tx' || from === '^local';
        var text = m.text || '';
        var key = 'msg|' + (m.id != null ? m.id : (ts + '|' + from + '|' + text + '|' + m.direction));

        // optimistic-echo suppression for our own live sends
        if (isTx && !initial) {
          var now = Date.now();
          echoedTx = echoedTx.filter(function (e) { return now - e.ts < 15000; });
          var hit = echoedTx.findIndex(function (e) { return e.text === text; });
          if (hit >= 0) { echoedTx.splice(hit, 1); return; } // already shown locally
        }

        var isDm = to && to.charAt(0) !== '^';                       // tx DM to a specific node
        var isRxDm = (m.direction === 'rx') && to && to.charAt(0) !== '^'; // rx DM addressed to us / a node

        if (isTx && isDm) {
          if (ingestDm(to, { ts: new Date(ts), me: true, text: text, status: 'ack' }, key)) addedDm = true;
        } else if (isRxDm) {
          var peer = from;
          if (ingestDm(peer, { ts: new Date(ts), cs: shortFor(peer), name: nameFor(peer), text: text }, key)) addedDm = true;
        } else if (isTx) {
          if (ingestChan({ ts: new Date(ts), self: true, cs: M.myShort, name: 'DOOM BOX', text: text }, key)) addedChan = true;
        } else {
          if (ingestChan({ ts: new Date(ts), cs: shortFor(from), name: nameFor(from), text: text, _from: from }, key)) addedChan = true;
        }
      });
      // keep the dedup set from growing unbounded
      if (seenMsg.size > 2000) { var keep = [].slice.call(seenMsg).slice(-1200); seenMsg.clear(); keep.forEach(function (k) { seenMsg.add(k); }); }
      return { ok: true, addedChan: addedChan, addedDm: addedDm };
    }).catch(function () { return { ok: false, addedChan: false, addedDm: false }; });
  };

  function formatEvent(ev) {
    var k = ev.kind || ev.event || ev.type;
    if (!k) return null;
    if (k === 'connection.established') return '*** Mesh CONNECTED';
    if (k === 'connection.lost')        return '*** Mesh DISCONNECTED';
    if (k === 'connection.failed')      return null; // suppress noisy reconnect spam in chat
    if (k === 'node.up') {
      var id = (ev.id || ev.node_id || '').toString();
      var ln = ev.longName || ev.long_name || (ev.user && ev.user.longName);
      var sn = ev.shortName || ev.short_name || (ev.user && ev.user.shortName);
      return '*** ' + (ln || sn || id) + ' (' + id + ') joined';
    }
    return null;
  }

  // Real DM delivery status ("acked" / "failed" / "no_ack_timeout") pushed by
  // bridge.py after a genuine mesh ack/nak or a 20s no-response timeout — see
  // CLAUDE.md Bug B. Correlates by packet id (msg.pid, set when the send
  // resolves) across every open DM thread; broadcast messages never get one
  // of these (no per-destination delivery concept for ^all).
  var DELIVERY_STATUS_MAP = { acked: 'ack', failed: 'failed', no_ack_timeout: 'timeout' };
  function applyDelivery(ev) {
    var cls = DELIVERY_STATUS_MAP[ev.status] || null;
    if (!cls || ev.id == null) return false;
    var hit = false;
    Object.keys(M.dmThreads).forEach(function (peer) {
      M.dmThreads[peer].msgs.forEach(function (m) {
        if (m.pid === ev.id) { m.status = cls; hit = true; }
      });
    });
    return hit;
  }

  M.fetchEvents = function () {
    return getJSON('/api/mesh/events?since=' + M.eventsSince).then(function (j) {
      var items = j.events || j.items || [];
      var added = false, updatedDm = false;
      items.forEach(function (ev) {
        var ts = ev.ts_ms || ev.ts || Date.now();
        var id = 'evt|' + ts + '|' + (ev.kind || ev.event || ev.type) + '|' + (ev.id || ev.node_id || '');
        if (seenEvt.has(id)) return; seenEvt.add(id);
        if (ts > M.eventsSince) M.eventsSince = ts;
        if ((ev.kind || ev.event || ev.type) === 'mesh.delivery') { if (applyDelivery(ev)) updatedDm = true; return; }
        var txt = formatEvent(ev);
        if (txt) { M.chanMsgs.push({ ts: new Date(ts), sys: true, text: txt }); if (M.chanMsgs.length > 500) M.chanMsgs.shift(); added = true; }
      });
      if (seenEvt.size > 1000) { var keep = [].slice.call(seenEvt).slice(-600); seenEvt.clear(); keep.forEach(function (k) { seenEvt.add(k); }); }
      return { ok: true, added: added, updatedDm: updatedDm };
    }).catch(function () { return { ok: false, added: false, updatedDm: false }; });
  };

  // ===== send (real) =====
  // Records the text for optimistic-echo suppression so the next /messages
  // poll (which returns our own ^local tx) doesn't duplicate the line.
  M.send = function (text, channelIndex, destinationId) {
    echoedTx.push({ text: text, ts: Date.now() });
    return postJSON('/api/mesh/send', { text: text, channelIndex: channelIndex, destinationId: destinationId || '^all' });
  };

  // Reset all live state (called by mount before a fresh load).
  M.resetLive = function () {
    M.nodes = []; M.channels = []; M.chanMsgs = []; M.dmThreads = {};
    M.connected = false; M.nodeCount = 0;
    M.messagesSince = 0; M.eventsSince = 0;
    snrHist = {}; seenMsg = new Set(); seenEvt = new Set(); echoedTx = [];
  };

  // legacy no-ops (mount no longer calls these, kept for safety)
  M.build = function () { return M.nodes; };
  M.seedMessages = function () {};
  M.channelsInit = function () {};

  M.CANNED = ['QSL', 'STANDBY', 'RETURNING TO BASE', 'NEED ASSISTANCE', 'ALL CLEAR', 'POSITION UNCHANGED', 'COMMS CHECK'];
  M.POOL = [];
  M.randText = function () { return ''; };

})(window.DBMesh);
