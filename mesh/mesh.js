/* ============================================================
   DOOM BOX — MESH UI
   Channels, node roster, mIRC chat + DMs, node detail panel,
   settings slide-down, SITREP broadcast. DBMesh.mount().
   ============================================================ */
window.DBMesh = window.DBMesh || {};
(function (M) {
  "use strict";
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  var ST, wrap, refs;
  M._iv = M._iv || [];

  function hopN(n) { return n.hops == null ? 99 : n.hops; }
  function hopTxt(n) { return n.hops == null ? '?' : n.hops; }
  function alive() { return wrap && wrap.isConnected; }
  function stopIv() { M._iv.forEach(clearInterval); M._iv = []; }

  M.mount = function (container) {
    stopIv();
    // remove any body-level singletons from a prior mount (avoid leaks on re-navigation)
    ['.mesh-modal', '.mesh-toast', '.mesh-pop'].forEach(function (s) { [].forEach.call(document.querySelectorAll(s), function (e) { e.remove(); }); });
    M.resetLive();
    ST = { conn: false, activeCh: 0, tabs: [{ id: 'ch0', label: 'CHANNEL #0' }], active: 'ch0', sel: null, settings: false, scrolledUp: false, uptime: 0, groupsOpen: true, _pending: 0 };
    container.style.padding = '0'; container.style.position = 'relative'; container.style.overflow = 'hidden';
    container.innerHTML = ''; wrap = el('div', 'mesh'); container.appendChild(wrap); refs = {};
    buildC1(); wrap.appendChild(el('div', 'mesh-div')); buildC2(); wrap.appendChild(el('div', 'mesh-div')); buildC3();
    buildC4(); buildSettings(); buildModals(); buildToast(); buildPop();
    renderConn(); renderChannels(); renderHealth(); renderRoster(); renderTabs(); renderChat();

    // ---- initial live load, then start pollers ----
    M.fetchState().then(function () {
      ST.conn = M.connected;
      return M.fetchNodes();
    }).then(function () {
      return M.fetchMessages(true);      // historical scrollback (includes our own tx)
    }).then(function () {
      M.eventsSince = Date.now();        // skip the event backlog; only show new join/conn events
      if (!alive()) return;
      ST.uptime = M.self().uptime || 0;
      renderConn(); renderChannels(); renderHealth(); renderRoster(); renderTabs(); renderChat();
    });

    M._iv.push(setInterval(function () { if (!alive()) { stopIv(); return; } pollState(); }, 2000));
    M._iv.push(setInterval(function () { if (!alive()) { stopIv(); return; } pollNodes(); }, 2000));
    M._iv.push(setInterval(function () { if (!alive()) { stopIv(); return; } pollMessages(); }, 2000));
    M._iv.push(setInterval(function () { if (!alive()) { stopIv(); return; } pollEvents(); }, 3000));
  };

  /* ============================================================ LIVE POLLERS */
  function pollState() {
    M.fetchState().then(function () {
      if (!alive()) return;
      ST.conn = M.connected;
      ST.uptime = M.self().uptime || ST.uptime;
      renderConn(); renderChannels(); renderHealth();
    });
  }
  function pollNodes() {
    M.fetchNodes().then(function () {
      if (!alive()) return;
      renderConn();   // refresh NODES KNOWN / HEARD 5M qstats
      renderRoster();
      syncDmTabs();
    });
  }
  function pollMessages() {
    var before = M.chanMsgs.length;
    M.fetchMessages(false).then(function (mr) {
      if (!alive()) return;
      var delta = M.chanMsgs.length - before; if (delta < 0) delta = 1;
      if (mr.addedChan || delta > 0) chanActivity(delta || 1);
      if (mr.addedDm) { syncDmTabs(); renderTabs(); if (ST.active.indexOf('dm:') === 0) renderChat(); }
    });
  }
  function pollEvents() {
    M.fetchEvents().then(function (er) {
      if (!alive()) return;
      if (er.added) chanActivity(1);
      if (er.updatedDm && ST.active.indexOf('dm:') === 0) renderChat();
    });
  }
  // mirror the mock incoming() UX: flash + jump-to-bottom pill, or unread badge
  function chanActivity(n) {
    if (ST.active === 'ch0') {
      ST._pending += n;
      var logEl = refs.c3 && refs.c3.querySelector('.mesh-chatlog');
      if (logEl) { logEl.classList.add('flash'); setTimeout(function () { var l = refs.c3 && refs.c3.querySelector('.mesh-chatlog'); if (l) l.classList.remove('flash'); }, 150); }
      renderChat();
      if (ST.scrolledUp) { refs.jump.textContent = '↓ ' + ST._pending + ' new messages — click to jump'; refs.jump.classList.add('show'); }
    } else {
      var ch = M.channels[0]; if (ch) ch.unread = (ch.unread || 0) + n;
      var tab = ST.tabs[0]; if (tab) tab.unread = (tab.unread || 0) + n;
      renderChannels(); renderTabs();
    }
  }
  // ensure every received DM thread has a visible tab
  function syncDmTabs() {
    Object.keys(M.dmThreads).forEach(function (hex) {
      var id = 'dm:' + hex;
      if (!ST.tabs.some(function (t) { return t.id === id; })) {
        var node = M.dmThreads[hex].node || {};
        ST.tabs.push({ id: id, label: 'DM: ' + (node.short || hex), unread: (M.dmThreads[hex].msgs || []).length });
      }
    });
  }

  /* ============================================================ C1 */
  function buildC1() {
    var c = el('div', 'mesh-c1'); wrap.appendChild(c); refs.c1 = c;
    refs.conn = el('div'); c.appendChild(refs.conn);
    refs.qstats = el('div', 'mesh-qstats'); c.appendChild(refs.qstats);
    var chs = el('div', 'mesh-chsec'); chs.innerHTML = '<div class="mesh-sec-h" style="margin-bottom:8px">CHANNELS</div>'; refs.chWrap = el('div'); chs.appendChild(refs.chWrap); c.appendChild(chs);
    var addch = el('button', 'mesh-addch', '+ ADD CHANNEL'); addch.addEventListener('click', function () { openSettings('channels'); }); c.appendChild(addch);
    var h = el('div', 'mesh-health'); h.innerHTML = '<div class="mesh-sec-h" style="margin-bottom:9px">MESH HEALTH</div>'; refs.health = el('div'); h.appendChild(refs.health); c.appendChild(h);
  }
  function renderConn() {
    var s = M.self();
    refs.conn.innerHTML = ST.conn ?
      '<div class="mesh-conn"><div class="st"><span class="dot"></span>CONNECTED</div><div class="ln">' + esc(s.hw || 'HELTEC_V4') + ' · /dev/ttyACM0<br>Node ID: <b>' + esc(s.hex) + '</b><br>Long name: <b>' + esc(s.name || 'DOOM BOX') + '</b><br>Short name: <b>' + esc(s.short || 'DMBX') + '</b><br>Role: <b>' + esc(s.role || '—') + '</b></div></div>' :
      '<div class="mesh-conn off"><div class="st"><span class="dot"></span>DISCONNECTED</div><div class="ln">Bridge offline — meshtastic-bridge.service</div></div>';
    var qs = [['NODES KNOWN', M.nodeCount || M.nodes.length], ['HEARD 5M', M.nodes.filter(function (n) { return n.lastMin <= 5; }).length], ['DIRECT', M.nodes.filter(function (n) { return n.hops === 0 && !n.self; }).length], ['VIA MQTT', M.nodes.filter(function (n) { return n.viaMqtt; }).length]];
    refs.qstats.innerHTML = qs.map(function (q) { return '<div class="mesh-qstat"><div class="k">' + q[0] + '</div><div class="v">' + q[1] + '</div></div>'; }).join('');
  }
  function renderChannels() {
    refs.chWrap.innerHTML = '';
    M.channels.forEach(function (ch) {
      var row = el('div', 'mesh-ch' + (ch.idx === ST.activeCh && ch.configured ? ' active' : ''));
      if (ch.configured) {
        row.innerHTML = '<div class="ct"><span class="dot on"></span>#' + ch.idx + ' ' + ch.name + (ch.unread ? '<span class="ub">' + ch.unread + '</span>' : '') + '</div>' +
          '<div class="cl">' + ch.preset + ' · PSK ' + ch.psk + '<br>' + ch.modem + ' · ' + ch.freq + '</div>' +
          '<div class="cn"><span>UpLink ○</span><span>DownLink ○</span></div>' +
          '<div class="cn"><span>[' + ch.nodes + ' nodes]</span><span>[' + ch.active + ' active]</span></div>';
        row.addEventListener('click', function () { ST.activeCh = ch.idx; ch.unread = 0; setActiveTab('ch0'); renderChannels(); });
      } else {
        row.innerHTML = '<div class="ct"><span class="dot off"></span>#' + ch.idx + ' ' + ch.name + '</div><div class="cl">[not configured]</div><span class="cfg">+ CONFIGURE</span>';
        row.querySelector('.cfg').addEventListener('click', function () { openSettings('channels'); });
      }
      refs.chWrap.appendChild(row);
    });
  }
  function renderHealth() {
    var s = M.self();
    var util = s.chanUtil || 0, air = s.airTx || 0;
    var utilCls = util > 75 ? 'crit' : util > 50 ? 'warn' : '';
    var up = s.uptime || ST.uptime || 0;
    var upTxt = up >= 3600 ? Math.floor(up / 3600) + 'h ' + Math.floor((up % 3600) / 60) + 'm' : up >= 60 ? Math.floor(up / 60) + 'm ' + (up % 60) + 's' : up + ' seconds';
    refs.health.innerHTML =
      bar('CHANNEL UTILIZATION', util + '% · ' + (util > 50 ? 'HIGH' : 'MODERATE'), util, utilCls) +
      bar('AIR TIME TX', air + '% · NORMAL', Math.min(100, air * 10), 'blue') +
      '<div class="mesh-hbar"><div class="hh">LOCAL UPTIME <b>' + upTxt + '</b></div></div>' +
      '<div class="mesh-hbar"><div class="hh">VIA MQTT <b style="color:var(--text-2)">' + M.nodes.filter(function (n) { return n.viaMqtt; }).length + ' nodes</b></div></div>';
    function bar(lbl, val, pct, cls) { return '<div class="mesh-hbar"><div class="hh">' + lbl + ' <b>' + val + '</b></div><div class="track"><i class="' + cls + '" style="width:' + Math.min(100, pct) + '%"></i></div></div>'; }
  }

  /* ============================================================ C2 */
  function buildC2() {
    var c = el('div', 'mesh-c2'); wrap.appendChild(c); refs.c2 = c;
    var head = el('div', 'mesh-rhead');
    head.innerHTML = '<div class="mesh-sec-h">NODE ROSTER</div><div class="sub"></div>' +
      '<div class="mesh-rfilters"></div><div class="row2"><select class="mesh-rsort"><option>LAST HEARD</option><option>NAME</option><option>SNR</option><option>HOPS</option></select><input class="mesh-rsearch" placeholder="🔍 Search nodes…"></div>' +
      '<button class="alertbtn">⚙ GLOBAL NODE ALERTS</button>';
    c.appendChild(head); refs.rsub = head.querySelector('.sub');
    var filt = head.querySelector('.mesh-rfilters');
    ['ALL', 'NEARBY', 'FAVORITES', 'DIRECT'].forEach(function (f) { var b = el('button', 'mesh-rf' + (f === 'ALL' ? ' on' : ''), f); b.addEventListener('click', function () { ST.filter = f; [].forEach.call(filt.children, function (n) { n.classList.remove('on'); }); b.classList.add('on'); renderRoster(); }); filt.appendChild(b); });
    ST.filter = 'ALL'; ST.sort = 'LAST HEARD'; ST.search = '';
    head.querySelector('.mesh-rsort').addEventListener('change', function () { ST.sort = this.value; renderRoster(); });
    head.querySelector('.mesh-rsearch').addEventListener('input', function () { ST.search = this.value.toUpperCase(); renderRoster(); });
    head.querySelector('.alertbtn').addEventListener('click', openAlertsModal);
    var roster = el('div', 'roster'); c.appendChild(roster); refs.roster = roster;
    var groups = el('div', 'mesh-groups'); groups.innerHTML = '<div class="mesh-grp-h">GROUPS <span>+ CREATE GROUP</span></div>' +
      '<div class="mesh-grp"><span class="lbl" style="background:#5EB8E8"></span>TEAM ALPHA (3)</div>' +
      '<div class="mesh-grp"><span class="lbl" style="background:#5DD87A"></span>RELAY NODES (8)</div>' +
      '<div class="mesh-grp"><span class="lbl" style="background:#8898AA"></span>UNKNOWN (143)</div>';
    c.appendChild(groups);
  }
  function rosterList() {
    var list = M.nodes.filter(function (n) {
      if (ST.filter === 'NEARBY' && hopN(n) > 1) return false;
      if (ST.filter === 'FAVORITES' && !n.fav && !n.self) return false;
      if (ST.filter === 'DIRECT' && n.hops !== 0) return false;
      if (ST.search) { var s = ((n.name || '') + ' ' + n.short + ' ' + n.hex).toUpperCase(); if (s.indexOf(ST.search) < 0) return false; }
      return true;
    });
    list.sort(function (a, b) { return ST.sort === 'NAME' ? (a.name || a.hex).localeCompare(b.name || b.hex) : ST.sort === 'SNR' ? ((b.snr == null ? -99 : b.snr)) - ((a.snr == null ? -99 : a.snr)) : ST.sort === 'HOPS' ? hopN(a) - hopN(b) : a.lastMin - b.lastMin; });
    list.sort(function (a, b) { return (b.self ? 2 : b.fav ? 1 : 0) - (a.self ? 2 : a.fav ? 1 : 0); });
    return list;
  }
  function renderRoster() {
    refs.rsub.innerHTML = '<b>' + M.nodes.length + '</b> known · <b>' + M.nodes.filter(function (n) { return n.lastMin <= 5; }).length + '</b> heard 5m · <b>' + M.nodes.filter(function (n) { return n.hops === 0; }).length + '</b> direct';
    var w = refs.roster; w.innerHTML = '';
    rosterList().slice(0, 80).forEach(function (n) {
      var row = el('div', 'mesh-node' + (ST.sel === n.hex ? ' sel' : '') + (n.hops === 0 ? ' direct' : ''));
      var badge = n.self ? '<span class="badge">SELF</span>' : n.fav ? '<span class="star">★</span>' : '';
      var snrTxt = n.snr == null ? '--' : n.snr, rssiTxt = n.rssi == null ? '--' : n.rssi;
      var sig = n.self ? 'SNR: --  RSSI: --  Hops: 0 (direct)' : 'SNR: ' + snrTxt + '  RSSI: ' + rssiTxt + '  Hops: ' + hopTxt(n) + (n.hops === 0 ? ' (direct)' : '') + (n.viaMqtt ? ' · MQTT' : '');
      var bat = (n.usb ? 'Bat: USB' : n.bat != null ? 'Bat: ' + n.bat + '%' : 'Bat: --') + ' · ' + (n.gps ? '📍 GPS FIX' : '📍 NO GPS');
      var acts = n.self ? '' : '<div class="acts"><button data-a="dm">💬 DM</button><button data-a="map">📍 MAP</button><button data-a="info">ℹ INFO</button></div>';
      row.innerHTML = '<div class="n1"><span class="dot ' + M.heardClass(n.lastMin) + '"></span><span class="nm">' + (n.name || '[unknown node]') + '</span><span class="sh">' + n.short + '</span>' + badge + '</div>' +
        '<div class="id">' + n.hex + ' · ' + n.role + '</div><div class="nsig">' + sig + '</div><div class="last">' + bat + ' · Last: ' + M.lastText(n.lastMin) + '</div>' + acts;
      row.addEventListener('click', function (e) { var b = e.target.closest('[data-a]'); if (b) { e.stopPropagation(); var a = b.getAttribute('data-a'); if (a === 'dm') openDM(n); else if (a === 'map') flyNode(n); else selectNode(n); return; } selectNode(n); });
      w.appendChild(row);
    });
  }

  /* ============================================================ C3 — CHAT */
  function buildC3() {
    var c = el('div', 'mesh-c3'); wrap.appendChild(c); refs.c3 = c;
    var head = el('div', 'mesh-chat-head');
    refs.tabs = el('div', 'mesh-tabs'); head.appendChild(refs.tabs);
    var hb = el('div', 'hbtns');
    var sit = el('button', 'mesh-hbtn amber', '⚑ BROADCAST SITREP'); sit.addEventListener('click', openSitrep);
    var setb = el('button', 'mesh-hbtn', '⚙ SETTINGS'); setb.addEventListener('click', function () { openSettings(); });
    hb.appendChild(sit); hb.appendChild(setb); head.appendChild(hb); c.appendChild(head);
    var log = el('div', 'mesh-chatlog'); c.appendChild(log); refs.log = log;
    log.addEventListener('scroll', function () { ST.scrolledUp = log.scrollHeight - log.scrollTop - log.clientHeight > 60; refs.jump.classList.toggle('show', ST.scrolledUp && ST._pending > 0); });
    var jump = el('div', 'mesh-jump'); jump.addEventListener('click', function () { scrollBottom(); }); log.appendChild(jump); refs.jump = jump;
    // input
    var iw = el('div', 'mesh-input-wrap'); refs.iw = iw;
    iw.innerHTML = '<div class="mesh-quick">' +
      '<button data-q="pos" data-tip="Send my position">📍<span class="ql">POS</span></button><button data-q="wp" data-tip="Send waypoint">⚑<span class="ql">WPT</span></button><button data-q="canned" data-tip="Canned message">📋<span class="ql">MSG</span></button>' +
      '<button data-q="tele" data-tip="Request telemetry">⚡<span class="ql">TELE</span></button><button data-q="reqpos" data-tip="Request position">📡<span class="ql">RPOS</span></button><button data-q="info" data-tip="Request node info">↻<span class="ql">INFO</span></button></div>' +
      '<div class="mesh-dmto" style="display:none"></div>' +
      '<div class="mesh-input-row"><select class="mesh-chsel"><option>#0 LongFast</option></select><input class="mesh-msg" placeholder="message…" maxlength="228"><button class="mesh-send">SEND</button></div>' +
      '<div class="mesh-counter">0/228 chars</div>';
    c.appendChild(iw);
    refs.msg = iw.querySelector('.mesh-msg'); refs.send = iw.querySelector('.mesh-send'); refs.counter = iw.querySelector('.mesh-counter'); refs.dmto = iw.querySelector('.mesh-dmto'); refs.chsel = iw.querySelector('.mesh-chsel');
    refs.msg.addEventListener('input', updateCounter);
    refs.msg.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendMsg(); });
    refs.send.addEventListener('click', sendMsg);
    [].forEach.call(iw.querySelectorAll('.mesh-quick button'), function (b) { b.addEventListener('click', function () { quick(b.getAttribute('data-q')); }); });
  }
  function updateCounter() { var n = refs.msg.value.length; refs.counter.textContent = n + '/228 chars'; refs.counter.className = 'mesh-counter' + (n > 210 ? ' crit' : n > 180 ? ' warn' : ''); }
  function renderTabs() {
    refs.tabs.innerHTML = '';
    ST.tabs.forEach(function (t) {
      var b = el('button', 'mesh-tab' + (t.id === ST.active ? ' on' : ''), t.label + (t.unread ? ' <span class="ub">' + t.unread + '</span>' : ''));
      b.addEventListener('click', function () { setActiveTab(t.id); }); refs.tabs.appendChild(b);
    });
    var add = el('button', 'mesh-tab add', '+'); add.addEventListener('click', function () { toast('warn', 'Select a node in the roster, then 💬 DM to open a thread'); }); refs.tabs.appendChild(add);
  }
  function setActiveTab(id) { ST.active = id; var t = ST.tabs.filter(function (x) { return x.id === id; })[0]; if (t) t.unread = 0; renderTabs(); renderChat(); updateInputMode(); }
  function updateInputMode() {
    var dm = ST.active.indexOf('dm:') === 0;
    refs.iw.classList.toggle('dm', dm);
    refs.dmto.style.display = dm ? '' : 'none';
    refs.chsel.style.display = dm ? 'none' : '';
    refs.send.textContent = dm ? 'SEND DM' : 'SEND';
    if (dm) { var node = M.dmThreads[ST.active.slice(3)].node; refs.dmto.textContent = 'DM to: ' + (node.name || node.hex) + ' (' + node.hex + ')'; }
    [].forEach.call(refs.iw.querySelectorAll('[data-q="tele"],[data-q="reqpos"]'), function (b) { b.style.opacity = dm ? '1' : '0.4'; });
  }
  function renderChat() {
    var log = refs.log, jump = refs.jump; log.innerHTML = ''; log.appendChild(jump);
    var msgs = ST.active === 'ch0' ? M.chanMsgs : (M.dmThreads[ST.active.slice(3)] || { msgs: [] }).msgs;
    var dm = ST.active.indexOf('dm:') === 0;
    msgs.forEach(function (m) { log.appendChild(lineEl(m, dm)); });
    ST._pending = 0; scrollBottom();
  }
  function lineEl(m, dm) {
    var z = '<span class="z">' + M.zulu(m.ts) + '</span> ';
    var line = el('div', 'mline' + (m.sys ? ' sys' : ''));
    if (m.sys) { line.innerHTML = z + esc(m.text); return line; }
    var pre = dm ? '<span class="dm">[DM]</span> ' : '';
    if (m.me || m.self) {
      var st = m.status ? ' <span class="' + m.status + '">[' + m.status + ']</span>' : '';
      line.innerHTML = z + pre + '<span class="cs me">&lt;' + (m.self ? 'DOOM BOX' : 'me') + '&gt;</span> ' + esc(m.text) + st;
    } else {
      var col = M.csColor(m.cs);
      line.innerHTML = z + pre + '<span class="cs" style="color:' + col + '" data-cs="' + m.cs + '">&lt;' + esc(m.cs) + '&gt;</span> ' + esc(m.text);
      var csEl = line.querySelector('.cs'); if (csEl) csEl.addEventListener('click', function (e) { openPop(m, e); });
    }
    return line;
  }
  function scrollBottom() { if (!ST.scrolledUp) { refs.log.scrollTop = refs.log.scrollHeight; refs.jump.classList.remove('show'); ST._pending = 0; } }

  function sendMsg() {
    var txt = refs.msg.value.trim(); if (!txt) return;
    if (!ST.conn) { toast('err', 'Bridge offline — cannot transmit'); return; }
    refs.msg.value = ''; updateCounter();
    if (ST.active === 'ch0') {
      M.chanMsgs.push({ ts: new Date(), cs: M.myShort, self: true, name: 'DOOM BOX', text: txt }); renderChat();
      M.send(txt, ST.activeCh, '^all').then(function (r) { if (!r || !r.ok) toast('err', 'Send failed: ' + ((r && r.err) || 'unknown')); });
    } else {
      var peer = ST.active.slice(3);
      var th = M.dmThreads[peer]; if (!th) { th = M.dmThreads[peer] = { node: (M.nodes.filter(function (n) { return n.hex === peer; })[0] || { hex: peer, short: peer }), msgs: [] }; }
      var msg = { ts: new Date(), me: true, text: txt, status: 'sent' }; th.msgs.push(msg); renderChat();
      M.send(txt, ST.activeCh, peer).then(function (r) {
        // 'sent' here just means the local radio accepted the packet — it is
        // NOT delivery confirmation. Real ack/failed/timeout status arrives
        // later via a mesh.delivery event (see pollEvents -> applyDelivery),
        // matched back to this line by packet id. See CLAUDE.md Bug B.
        if (r && r.ok) { msg.pid = r.id; }
        else { msg.status = 'failed'; }
        if (alive() && ST.active === 'dm:' + peer) renderChat();
        if (!r || !r.ok) toast('err', 'DM send failed: ' + ((r && r.err) || 'unknown'));
      });
    }
  }
  function quick(q) {
    var s = M.self();
    var slat = (s.lat != null ? s.lat : M.OWN.lat), slon = (s.lon != null ? s.lon : M.OWN.lon);
    if (q === 'pos') inject('📍 POS ' + slat.toFixed(4) + 'N ' + Math.abs(slon).toFixed(4) + 'W');
    else if (q === 'wp') inject('⚑ WAYPOINT dropped at cursor grid');
    else if (q === 'canned') openCanned();
    else if (q === 'info') { toast('ok', 'Node info requested'); }
    else if (ST.active.indexOf('dm:') === 0) { toast('ok', q === 'tele' ? 'Telemetry requested from node' : 'Position requested from node'); }
    else toast('warn', 'Telemetry/position requests are DM-only');
  }
  function inject(text) {
    if (!ST.conn) { toast('err', 'Bridge offline — cannot transmit'); return; }
    if (ST.active === 'ch0') {
      M.chanMsgs.push({ ts: new Date(), cs: M.myShort, self: true, text: text }); renderChat();
      M.send(text, ST.activeCh, '^all').then(function (r) { if (!r || !r.ok) toast('err', 'Send failed'); });
    } else {
      var peer = ST.active.slice(3);
      var th = M.dmThreads[peer]; if (!th) { th = M.dmThreads[peer] = { node: { hex: peer, short: peer }, msgs: [] }; }
      var msg = { ts: new Date(), me: true, text: text, status: 'sent' }; th.msgs.push(msg); renderChat();
      // See sendMsg() above — 'sent' is not delivery confirmation; real status
      // arrives later via a mesh.delivery event matched by packet id (msg.pid).
      M.send(text, ST.activeCh, peer).then(function (r) { if (r && r.ok) { msg.pid = r.id; } else { msg.status = 'failed'; } if (alive()) renderChat(); });
    }
  }

  function incoming() {
    if (!wrap.isConnected) { M._iv.forEach(clearInterval); return; }
    if (!ST.conn) return;
    var talkers = M.nodes.filter(function (n) { return n.known && !n.self; });
    var n = talkers[Math.floor(Math.random() * talkers.length)]; if (!n) return;
    n.lastMin = 0;
    M.chanMsgs.push({ ts: new Date(), cs: n.short, name: n.name, text: M.randText() });
    if (M.chanMsgs.length > 300) M.chanMsgs.shift();
    var ch = M.channels[0]; if (ST.active !== 'ch0') { ch.unread = (ch.unread || 0) + 1; var tab = ST.tabs[0]; tab.unread = (tab.unread || 0) + 1; renderChannels(); renderTabs(); }
    else { ST._pending++; refs.c3.querySelector('.mesh-chatlog').classList.add('flash'); setTimeout(function () { var l = refs.c3 && refs.c3.querySelector('.mesh-chatlog'); if (l) l.classList.remove('flash'); }, 150); if (ST.scrolledUp) { refs.jump.textContent = '↓ ' + ST._pending + ' new messages — click to jump'; refs.jump.classList.add('show'); } renderChat(); }
    renderRoster();
  }

  function openDM(n) { var id = 'dm:' + n.hex; if (!M.dmThreads[n.hex]) M.dmThreads[n.hex] = { node: n, msgs: [] }; if (!ST.tabs.some(function (t) { return t.id === id; })) ST.tabs.push({ id: id, label: 'DM: ' + n.short }); setActiveTab(id); }

  /* ---- callsign popover ---- */
  function buildPop() { refs.pop = el('div', 'mesh-pop'); document.body.appendChild(refs.pop); document.addEventListener('click', function (e) { if (!e.target.closest('.mesh-pop') && !e.target.closest('.cs')) refs.pop.classList.remove('show'); }); }
  function openPop(m, e) {
    var n = M.nodes.filter(function (x) { return x.short === m.cs; })[0] || { name: m.name || m.cs, hex: '!unknown', lastMin: 0 };
    refs.pop.innerHTML = '<div class="ph"><b>' + (n.name || m.cs) + '</b><br>' + n.hex + '<br>Last heard: ' + M.lastText(n.lastMin) + '</div>' +
      '<div class="pa"><button data-p="dm">💬 DM THIS NODE</button><button data-p="map">📍 SHOW ON MAP</button><button data-p="info">ℹ INFO</button><button data-p="copy">📋 COPY NODE ID</button></div>';
    refs.pop.querySelector('[data-p="dm"]').addEventListener('click', function () { openDM(n); refs.pop.classList.remove('show'); });
    refs.pop.querySelector('[data-p="map"]').addEventListener('click', function () { flyNode(n); refs.pop.classList.remove('show'); });
    refs.pop.querySelector('[data-p="info"]').addEventListener('click', function () { selectNode(n); refs.pop.classList.remove('show'); });
    refs.pop.querySelector('[data-p="copy"]').addEventListener('click', function () { if (navigator.clipboard) navigator.clipboard.writeText(n.hex).catch(function () {}); toast('ok', 'Copied ' + n.hex); refs.pop.classList.remove('show'); });
    var x = Math.min(e.clientX, window.innerWidth - 220), y = Math.min(e.clientY + 6, window.innerHeight - 180);
    refs.pop.style.left = x + 'px'; refs.pop.style.top = y + 'px'; refs.pop.classList.add('show');
  }

  /* ============================================================ C4 — DETAIL */
  function buildC4() { refs.c4 = el('div', 'mesh-c4'); wrap.appendChild(refs.c4); }
  function selectNode(n) { ST.sel = n.hex; renderRoster(); renderDetail(n); refs.c4.classList.add('open'); }
  function flyNode(n) { if (!n.gps) { toast('warn', 'Node has no GPS fix'); return; } if (window.DBShell) DBShell.go('MAP'); setTimeout(function () { if (window.DBMap) { DBMap.state.active['mesh_pos'] = true; if (DBMap.ui) DBMap.ui.updateLayerCount(); DBMap.tools.setMarker(n.lat, n.lon); DBMap.flyTo(n.lat, n.lon, 12); } }, 160); }
  function symSVG() { return '<svg viewBox="0 0 24 24" fill="rgba(232,181,74,0.15)" stroke="#E8B54A" stroke-width="1.6"><rect x="4" y="7" width="16" height="10"/><path d="M9 9 L12 12 L15 9"/></svg>'; }
  function renderDetail(n) {
    function card(title, rows, exp, body2) {
      return '<div class="mesh-card' + (exp ? ' exp closed' : '') + '"><div class="ch">' + title + (exp ? '<span>▾</span>' : '') + '</div>' +
        (rows ? '<div class="cb">' + rows.map(function (r) { return '<span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span>'; }).join('') + '</div>' : '') +
        (body2 ? '<div class="collapse">' + body2 + '</div>' : '') + '</div>';
    }
    var mgrs = (n.gps && window.DBMap && DBMap.toMGRS) ? DBMap.toMGRS(n.lat, n.lon) : '—';
    var html = '<div class="mesh-d-head"><button class="mesh-d-close">✕</button><div class="mesh-d-sym">' + symSVG() + '</div>' +
      '<div class="mesh-d-nm">' + (n.name || '[unknown node]') + '</div><div class="mesh-d-sh">' + n.short + '</div><div class="mesh-d-id">' + n.hex + '</div></div>' +
      '<div class="mesh-d-acts"><button class="mesh-d-act primary" data-a="dm">💬 SEND DM</button><button class="mesh-d-act" data-a="map">📍 SHOW ON MAP</button>' +
      '<button class="mesh-d-act" data-a="fav">⭐ ' + (n.fav ? 'REMOVE FAVORITE' : 'ADD TO FAVORITES') + '</button><button class="mesh-d-act" data-a="alert">🔔 SET ALERT</button></div>' +
      card('IDENTITY', [['Long name', n.name || '—'], ['Short name', n.short], ['Node ID', n.hex], ['Hardware', n.hw], ['Firmware', n.fw], ['Role', n.role], ['Public key', n.pubkey + '…']]) +
      card('SIGNAL', n.self ? [['SNR', '--'], ['RSSI', '--'], ['Hop count', '0 (self)']] : [['SNR', (n.snr == null ? '--' : n.snr + ' dB')], ['RSSI', (n.rssi == null ? '--' : n.rssi + ' dBm')], ['Hop count', hopTxt(n) + (n.hops === 0 ? ' (direct link)' : '')], ['Via MQTT', n.viaMqtt ? 'Yes' : 'No']]) +
      '<div class="mesh-snr"><canvas></canvas></div>' +
      (n.gps ? card('POSITION', [['GPS Fix', 'YES'], ['Latitude', n.lat.toFixed(4) + '°N'], ['Longitude', Math.abs(n.lon).toFixed(4) + '°W'], ['MGRS', mgrs], ['Altitude', n.alt.toLocaleString() + ' m MSL'], ['Last update', M.lastText(n.lastMin)]]) : card('POSITION', [['GPS Fix', 'NO'], ['Last heard', M.lastText(n.lastMin)]])) +
      (n.gps ? '<button class="mesh-d-act" data-a="map" style="margin:0 14px 12px;width:calc(100% - 28px)">📍 FLY TO ON MAP</button>' : '') +
      card('TELEMETRY', [['Battery', (n.usb ? 'USB powered' : n.bat != null ? n.bat + '%' + (n.volt != null ? ' · ' + n.volt + 'V' : '') : '--')], ['Voltage', (n.volt != null ? n.volt + 'V' : '--')], ['Channel util', n.chanUtil + '%'], ['Air time TX', n.airTx + '%'], ['Uptime', (n.self ? (M.self().uptime || ST.uptime) : n.uptime) + ' seconds'], ['Temp', '-- (no sensor)'], ['Humidity', '-- (no sensor)']]) +
      card('THIS SESSION', [['First heard', M.zuluS(new Date(Date.now() - n.firstMin * 60000)) + ' (' + n.firstMin + 'm ago)'], ['Last heard', M.lastText(n.lastMin)], ['Messages RX', n.msgsRx], ['Messages TX', n.msgsTx], ['DMs sent', n.dmsSent], ['DMs received', n.dmsRx]]) +
      card('TRACEROUTE', null, true, '<button class="mesh-d-act runbtn" data-a="trace" style="margin:8px 11px;width:calc(100% - 22px)">▶ RUN TRACEROUTE</button><div class="cb traceout" style="display:none"></div>') +
      card('ALERTS', null, true, '<div class="mesh-acfg">' + acfg('first', 'Notify when first heard', n.alertCfg.first) + acfg('lost', 'Notify when lost (>30 min)', n.alertCfg.lost) + acfg('every', 'Notify on every message', false) + acfg('pos', 'Notify on position update', false) + acfg('bcast', 'Mesh broadcast on lost contact', false) + '</div>');
    refs.c4.innerHTML = html;
    refs.c4.querySelector('.mesh-d-close').addEventListener('click', function () { refs.c4.classList.remove('open'); ST.sel = null; renderRoster(); });
    [].forEach.call(refs.c4.querySelectorAll('.mesh-d-act[data-a]'), function (b) { b.addEventListener('click', function () { var a = b.getAttribute('data-a'); if (a === 'dm') openDM(n); else if (a === 'map') flyNode(n); else if (a === 'fav') { n.fav = !n.fav; renderDetail(n); renderRoster(); } else if (a === 'alert') { toast('ok', 'Alert set for ' + n.short); } else if (a === 'trace') runTrace(n); }); });
    [].forEach.call(refs.c4.querySelectorAll('.mesh-card.exp .ch'), function (ch) { ch.addEventListener('click', function () { var card = ch.parentNode; card.classList.toggle('closed'); card.classList.toggle('open'); }); });
    [].forEach.call(refs.c4.querySelectorAll('.mesh-acfg label'), function (l) { l.addEventListener('click', function () { l.classList.toggle('on'); }); });
    drawSnr(n);
  }
  function acfg(k, label, on) { return '<label class="' + (on ? 'on' : '') + '"><span class="bx"></span>' + label + '</label>'; }
  function runTrace(n) {
    var out = refs.c4.querySelector('.traceout'); if (!out) return; out.style.display = ''; out.innerHTML = '<span class="k" style="grid-column:1/-1;color:var(--accent)">running…</span>';
    setTimeout(function () { if (!refs.c4.isConnected) return; var hops = n.hops; var path = 'DOOM BOX' + (hops > 1 ? ' → !relay' + Math.floor(Math.random() * 9) : '') + ' → ' + n.short; out.innerHTML = '<span class="k">Path</span><span class="v" style="text-align:left;grid-column:2">' + path + '</span><span class="k">Result</span><span class="v" style="text-align:left;grid-column:2">' + (hops + 1) + ' hops · ' + (1 + Math.random() * 3).toFixed(1) + ' sec RTT</span>'; }, 1400);
  }
  function drawSnr(n) {
    var cv = refs.c4.querySelector('.mesh-snr canvas'); if (!cv) return; var box = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; if (!box.width) { setTimeout(function () { drawSnr(n); }, 60); return; }
    cv.width = box.width * dpr; cv.height = box.height * dpr; var x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); var w = box.width, h = box.height;
    x.clearRect(0, 0, w, h); var arr = n.snrHist, mn = -6, mx = 12;
    x.strokeStyle = '#E8B54A'; x.lineWidth = 1.4; x.beginPath(); arr.forEach(function (v, i) { var px = i / (arr.length - 1) * w, py = h - (v - mn) / (mx - mn) * h; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke();
  }

  /* ============================================================ SETTINGS */
  function buildSettings() {
    var s = el('div', 'mesh-settings'); refs.settings = s;
    s.innerHTML = '<div class="mesh-set-head"><span class="t">MESH SETTINGS</span><button class="x">✕</button></div><div class="mesh-set-body"></div>' +
      '<div class="mesh-set-foot"><span class="note">⚠ Settings marked require device reboot. Writes via meshtastic-bridge.</span><button class="amber" data-s="reboot">APPLY &amp; REBOOT</button><button data-s="save">SAVE WITHOUT REBOOT</button></div>';
    wrap.appendChild(s);
    s.querySelector('.x').addEventListener('click', function () { closeSettings(); });
    s.querySelector('[data-s="reboot"]').addEventListener('click', function () { toast('warn', 'Reboot required — device restarting…'); closeSettings(); });
    s.querySelector('[data-s="save"]').addEventListener('click', function () { toast('ok', 'Settings saved: lora.hop_limit = 7'); closeSettings(); });
    refs.setBody = s.querySelector('.mesh-set-body');
  }
  function fld(label, ctrl, warn) { return '<div class="mesh-fld"><span class="lbl">' + (warn ? '<span class="w">⚠</span> ' : '') + label + '</span>' + ctrl + '</div>'; }
  function sel(opts) { return '<select>' + opts.map(function (o) { return '<option>' + o + '</option>'; }).join('') + '</select>'; }
  function num(v) { return '<input type="number" value="' + v + '">'; }
  function tgl(on) { return '<span class="mesh-tgl' + (on ? ' on' : '') + '"></span>'; }
  function setcard(title, body) { return '<div class="mesh-setcard"><div class="sh">' + title + '</div><div class="sb">' + body + '</div></div>'; }
  function openSettings(focus) {
    refs.setBody.innerHTML =
      setcard('DEVICE CONFIG', fld('Role', sel(['ROUTER_CLIENT', 'CLIENT', 'ROUTER', 'TRACKER']), 1) + fld('Node info broadcast', num(900)) + fld('Serial output', tgl(false)) + '<button class="mesh-setbtn">↻ REBOOT</button><button class="mesh-setbtn danger">⚠ FACTORY RESET</button>') +
      setcard('POSITION CONFIG', fld('GPS mode', sel(['ENABLED', 'DISABLED'])) + fld('GPS update', num(30)) + fld('Broadcast interval', num(300)) + fld('Smart broadcast', tgl(true)) + fld('Min distance (m)', num(50)) + fld('Fixed position', tgl(false))) +
      setcard('LORA RADIO CONFIG', fld('Region', sel(['US', 'EU_868', 'ANZ', 'JP']), 1) + fld('Modem preset', sel(['LONG_FAST', 'LONG_SLOW', 'MEDIUM_FAST', 'SHORT_FAST']), 1) + fld('Hop limit', sel(['7', '6', '5', '4', '3', '2', '1']), 1) + fld('TX enabled', tgl(true)) + fld('TX power (dBm)', num(30))) +
      setcard('POWER CONFIG', fld('Is powered (mains)', tgl(true)) + fld('Power saving', tgl(false))) +
      setcard('BLUETOOTH CONFIG', fld('Bluetooth', tgl(false)) + fld('Pairing mode', sel(['RANDOM_PIN', 'FIXED_PIN', 'NO_PIN']))) +
      setcard('DISPLAY CONFIG', fld('Screen timeout', num(0)) + fld('GPS format', sel(['MGRS', 'DEC', 'DMS', 'UTM'])) + fld('Units', sel(['IMPERIAL', 'METRIC']))) +
      '<div class="mesh-setcard" style="grid-column:1/-1"><div class="sh">CHANNEL MANAGEMENT</div><div class="sb">' +
      '<div style="border:1px solid var(--line-soft);padding:9px;margin-bottom:8px"><div style="font-family:var(--font-mono);font-size:.6rem;color:var(--accent);margin-bottom:6px">CHANNEL 0 — PRIMARY</div>' +
      fld('Name', '<input type="text" value="LongFast">') + fld('Role', sel(['PRIMARY', 'SECONDARY', 'DISABLED'])) + fld('PSK', sel(['DEFAULT', 'RANDOM', 'NONE'])) + fld('Uplink', tgl(false)) + fld('Downlink', tgl(false)) +
      '<button class="mesh-setbtn">QR CODE</button><button class="mesh-setbtn">SHARE URL</button><button class="mesh-setbtn">SAVE</button></div>' +
      '<button class="mesh-setbtn">+ ADD CHANNEL (slot 1)</button></div></div>';
    [].forEach.call(refs.setBody.querySelectorAll('.mesh-tgl'), function (t) { t.addEventListener('click', function () { t.classList.toggle('on'); }); });
    [].forEach.call(refs.setBody.querySelectorAll('.mesh-setbtn'), function (b) { b.addEventListener('click', function () { var x = b.textContent; if (/SHARE URL/.test(x)) toast('ok', 'Channel URL copied: https://meshtastic.org/e/#…'); else if (/FACTORY/.test(x)) toast('err', 'Factory reset requires confirmation hold'); else if (/REBOOT/.test(x)) toast('warn', 'Rebooting device…'); else toast('ok', x.trim() + ' — done'); }); });
    ST.settings = true; refs.settings.classList.add('open');
  }
  function closeSettings() { ST.settings = false; refs.settings.classList.remove('open'); }

  /* ============================================================ MODALS */
  function buildModals() {
    var m = el('div', 'mesh-modal'); refs.modal = m; document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('show'); });
  }
  function openAlertsModal() {
    var opts = [['newnode', 'Alert when any NEW node is heard for first time', 1], ['lost', 'Alert when a KNOWN node is lost (>30 min silence)', 1], ['util', 'Alert when channel utilization exceeds 75%', 0], ['emerg', 'Alert on any EMERGENCY message received', 1], ['every', 'Alert on every message (noisy)', 0]];
    refs.modal.innerHTML = '<div class="mesh-modal-p"><div class="mesh-modal-h">GLOBAL NODE ALERTS</div><div class="mesh-modal-b">' +
      opts.map(function (o) { return '<div class="arow' + (o[2] ? ' on' : '') + '"><span class="bx"></span>' + o[1] + '</div>'; }).join('') +
      '<div class="mesh-sec-h" style="margin:14px 0 6px">WATCHLIST</div><div class="mesh-watch"><input placeholder="Node name / ID"><button>+ ADD</button></div>' +
      '<div class="wl"></div></div><div class="mesh-modal-f"><button class="mesh-mb" data-x="cancel">CANCEL</button><button class="mesh-mb amber" data-x="save">SAVE ALERTS</button></div></div>';
    [].forEach.call(refs.modal.querySelectorAll('.arow'), function (r) { r.addEventListener('click', function () { r.classList.toggle('on'); }); });
    refs.modal.querySelector('.mesh-watch button').addEventListener('click', function () { var i = refs.modal.querySelector('.mesh-watch input'); if (i.value.trim()) { var w = refs.modal.querySelector('.wl'); var row = el('div', 'mesh-fld', '<span class="lbl">' + esc(i.value) + '</span><button class="mesh-setbtn">✕</button>'); row.querySelector('button').addEventListener('click', function () { row.remove(); }); w.appendChild(row); i.value = ''; } });
    refs.modal.querySelector('[data-x="cancel"]').addEventListener('click', function () { refs.modal.classList.remove('show'); });
    refs.modal.querySelector('[data-x="save"]').addEventListener('click', function () { refs.modal.classList.remove('show'); toast('ok', 'Node alerts saved'); });
    refs.modal.classList.add('show');
  }
  function openCanned() {
    refs.modal.innerHTML = '<div class="mesh-modal-p"><div class="mesh-modal-h">CANNED MESSAGES</div><div class="mesh-modal-b">' +
      M.CANNED.map(function (c) { return '<div class="arow" data-c="' + esc(c) + '"><span class="bx"></span>' + c + '</div>'; }).join('') +
      '</div><div class="mesh-modal-f"><button class="mesh-mb" data-x="cancel">CANCEL</button></div></div>';
    [].forEach.call(refs.modal.querySelectorAll('.arow'), function (r) { r.addEventListener('click', function () { inject(r.getAttribute('data-c')); refs.modal.classList.remove('show'); }); });
    refs.modal.querySelector('[data-x="cancel"]').addEventListener('click', function () { refs.modal.classList.remove('show'); });
    refs.modal.classList.add('show');
  }
  function openSitrep() {
    var s = M.self();
    var bat = s.usb ? 'USB' : (s.bat != null ? s.bat + '%' : '--');
    var nodes = M.nodeCount || M.nodes.length;
    var gps = s.gps ? 'GPS FIX' : 'NO GPS';
    var temp = (window.DBWx && DBWx.current) ? DBWx.current.tempF + 'F' : '94F';
    var ac = (window.DBAdsb && DBAdsb.fleet) ? DBAdsb.fleet.length : 47;
    var mil = (window.DBAdsb && DBAdsb.fleet) ? DBAdsb.fleet.filter(function (a) { return a.mil; }).length : 2;
    var txt = 'DOOM BOX SITREP [' + M.zuluS(new Date()) + ']:\n ' + gps + ' · BAT ' + bat + ' · ' + nodes + ' NODES ·\n CRIME: 3 CFS LAST 1HR ·\n WX: CLR ' + temp + ' ·\n ADS-B: ' + ac + ' ACFT (' + mil + ' MIL) ·\n ALL SYS NOMINAL';
    refs.modal.innerHTML = '<div class="mesh-modal-p"><div class="mesh-modal-h">⚑ BROADCAST SITREP — PREVIEW</div><div class="mesh-modal-b"><div class="sitrep">' + esc(txt) + '</div><div style="font-family:var(--font-mono);font-size:.56rem;color:var(--text-2);margin-top:10px">Broadcast to #0 PRIMARY · ' + txt.length + ' chars</div></div>' +
      '<div class="mesh-modal-f"><button class="mesh-mb" data-x="cancel">CANCEL</button><button class="mesh-mb amber" data-x="send">SEND</button></div></div>';
    refs.modal.querySelector('[data-x="cancel"]').addEventListener('click', function () { refs.modal.classList.remove('show'); });
    refs.modal.querySelector('[data-x="send"]').addEventListener('click', function () {
      if (!ST.conn) { toast('err', 'Bridge offline — cannot transmit'); return; }
      var flat = txt.replace(/\n/g, ' ');
      M.chanMsgs.push({ ts: new Date(), cs: M.myShort, self: true, text: flat }); ST.activeCh = 0; setActiveTab('ch0');
      M.send(flat, 0, '^all').then(function (r) { toast(r && r.ok ? 'ok' : 'err', r && r.ok ? 'SITREP broadcast to #0 PRIMARY' : 'SITREP send failed'); });
      refs.modal.classList.remove('show');
    });
    refs.modal.classList.add('show');
  }

  function buildToast() { refs.toast = el('div', 'mesh-toast'); document.body.appendChild(refs.toast); }
  function toast(kind, msg) { var t = refs.toast; t.className = 'mesh-toast ' + kind + ' show'; t.textContent = (kind === 'ok' ? '✓ ' : kind === 'err' ? '✗ ' : '⚠ ') + msg; clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, kind === 'err' ? 4000 : 2600); }
  M._toast = toast;

  window.addEventListener('resize', function () { if (refs && refs.c4 && refs.c4.classList.contains('open') && ST.sel) { var n = M.nodes.filter(function (x) { return x.hex === ST.sel; })[0]; if (n) drawSnr(n); } });

})(window.DBMesh);
