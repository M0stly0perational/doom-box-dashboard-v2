/* ============================================================
   DOOM BOX — SIGINT UI (LIVE)
   Mode toggle + confirm dialog, channel hop, sortable/filterable
   device table, expand detail, AP side panel, ticker push.
   Driven entirely by /api/sigint/* — no client-side simulation.
   DBSigint.mount().

   SAFETY: the mode toggle's monitor path is gated behind an explicit
   confirm dialog (wlan1 AP drops every client). Mode shown ALWAYS
   reflects /api/sigint/status, never local UI guesses.
   ============================================================ */
window.DBSigint = window.DBSigint || {};
(function (S) {
  "use strict";
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var ST, wrap, refs;
  S._iv = S._iv || [];
  S._seenUnknown = S._seenUnknown || {};   // mac -> 1 (ticker dedup across polls)
  var primedTicker = false;

  S.mount = function (container) {
    S._iv.forEach(clearInterval); S._iv = [];
    ['.sig-dialog', '.sig-toast'].forEach(function (s) { [].forEach.call(document.querySelectorAll(s), function (e) { e.remove(); }); });
    S.devices = []; S.beacons = []; S.status = null; primedTicker = false;
    ST = { mode: 'hotspot', online: false, transitioning: false, hopIdx: -1, curChannel: null,
           revertEndMs: 0, sort: 'lastMin', dir: 1, filter: 'all', search: '', expanded: null, apOpen: true };
    container.style.padding = '0'; container.style.position = 'relative'; container.style.overflow = 'hidden';
    container.innerHTML = ''; wrap = el('div', 'sig'); container.appendChild(wrap); refs = {};
    buildCtrl(); buildBody(); buildStatus(); buildDialog(); buildToast();
    renderHop(); renderTable(); renderAPs(); renderStatus();

    // initial live loads
    S.loadStatus().then(applyStatus);
    S.loadDevices('all').then(function () { primedTicker = true; renderTable(); renderStatus(); loadVisibleSparklines(); });
    S.loadBeacons().then(renderAPs);
    S.loadProbes();

    // pollers — all self-terminate when the tab unmounts (wrap.isConnected)
    S._iv.push(setInterval(function () {
      if (gone()) return;
      S.loadStatus().then(applyStatus);
    }, 1500));
    S._iv.push(setInterval(function () {
      if (gone()) return;
      S.loadDevices('all').then(function () { tickerCheck(); renderTable(); renderStatus(); loadVisibleSparklines(); refreshExpandedSparkline(); });
    }, 5000));
    S._iv.push(setInterval(function () {
      if (gone() || !ST.apOpen) return;
      S.loadBeacons().then(renderAPs);
    }, 15000));
    S._iv.push(setInterval(function () { if (gone()) return; tickRevert(); }, 1000));
    S._iv.push(setInterval(function () { if (gone()) return; S.loadProbes(); }, 12000));
  };

  function gone() { if (!wrap || !wrap.isConnected) { S._iv.forEach(clearInterval); S._iv = []; return true; } return false; }

  /* ============================================================ CONTROL BAR */
  function buildCtrl() {
    var c = el('div', 'sig-ctrl'); wrap.appendChild(c);
    c.innerHTML =
      '<div class="sig-mode-wrap"><div class="sig-mode" id="sigMode"><span class="ind"></span><span class="txt"><span class="big"></span><span class="sub"></span></span><span class="swap">⇄</span></div></div>' +
      '<div class="sig-hop"><span class="lbl">CHANNEL HOP</span><span class="ch" id="sigCh">ch —</span><span class="band" id="sigBand">—</span><div class="plan" id="sigPlan"></div></div>' +
      '<div class="sig-revert hidden" id="sigRevert"><span class="lbl">⚠ AP AUTO-REVERT IN</span><span class="time" id="sigRevertTime">30:00</span><span class="note">hotspot restores at T-0</span></div>' +
      '<div class="sig-oui"><span class="v">' + S.OUI_COUNT.toLocaleString() + ' entries</span><span class="l">OUI DATABASE LOADED</span><span class="ctl" id="sigCtl">● SIGINT CONTROLLER —</span></div>';
    refs.mode = c.querySelector('#sigMode');
    refs.modeBig = c.querySelector('.big'); refs.modeSub = c.querySelector('.sub');
    refs.ch = c.querySelector('#sigCh'); refs.band = c.querySelector('#sigBand'); refs.plan = c.querySelector('#sigPlan');
    refs.revert = c.querySelector('#sigRevert'); refs.revertTime = c.querySelector('#sigRevertTime');
    refs.ctl = c.querySelector('#sigCtl');
    refs.mode.addEventListener('click', toggleMode);
    renderMode();
  }
  function renderMode() {
    var mon = ST.mode === 'monitor', off = !ST.online;
    refs.mode.classList.toggle('monitor', mon && !off);
    refs.mode.classList.toggle('offline', off);
    if (off) { refs.modeBig.textContent = 'CONTROLLER OFFLINE'; refs.modeSub.textContent = 'service stopped — start sigint-controller to capture'; }
    else if (ST.transitioning) { refs.modeBig.textContent = 'SWITCHING…'; refs.modeSub.textContent = 'mode transition in progress'; }
    else if (mon) { refs.modeBig.textContent = 'MONITOR MODE'; refs.modeSub.textContent = 'AP DOWN · passive 802.11 capture · wlan1'; }
    else { refs.modeBig.textContent = 'HOTSPOT MODE'; refs.modeSub.textContent = 'AP up · clients served · wlan1'; }
    if (refs.ctl) {
      refs.ctl.textContent = (off ? '○ SIGINT CONTROLLER STOPPED' : '● SIGINT CONTROLLER RUNNING');
      refs.ctl.classList.toggle('off', off);
    }
  }
  function renderHop() {
    var len = S.HOP_PLAN.length;
    if (refs.plan.children.length !== len) { refs.plan.innerHTML = ''; S.HOP_PLAN.forEach(function () { refs.plan.appendChild(el('i')); }); }
    var active = ST.hopIdx >= 0;
    var ch = active ? S.HOP_PLAN[ST.hopIdx] : (ST.curChannel || null);
    refs.ch.textContent = ch ? ('ch ' + ch) : 'ch —';
    refs.band.textContent = ch ? (ch <= 14 ? '2.4 GHz' : '5 GHz') : (ST.online ? 'idle' : 'offline');
    [].forEach.call(refs.plan.children, function (n, i) { n.classList.toggle('on', i === ST.hopIdx); });
    if (refs.statChan) refs.statChan.innerHTML = 'CH <b>' + (ch || '—') + '</b> · ' + (ch ? (ch <= 14 ? '2.4G' : '5G') : 'idle') + ' · hop <b>2s</b>';
  }

  /* ---- apply real /api/sigint/status ---- */
  function applyStatus(s) {
    if (gone()) return;
    var off = S.isOffline(s);
    ST.online = !off;
    if (off) {
      ST.mode = 'offline'; ST.transitioning = false; ST.hopIdx = -1; ST.curChannel = null; ST.revertEndMs = 0;
      refs.revert.classList.add('hidden');
      renderMode(); renderHop(); renderStatus();
      return;
    }
    ST.mode = s.mode || 'hotspot';
    ST.transitioning = !!(s.transition_target && s.transition_target !== '' && s.transition_target !== s.mode);
    ST.curChannel = (s.current_channel != null ? s.current_channel : null);
    ST.hopIdx = (s.mode === 'monitor' && s.current_channel != null && S.HOP_PLAN.length)
      ? (((s.hop_count || 0) % S.HOP_PLAN.length) + S.HOP_PLAN.length) % S.HOP_PLAN.length : -1;
    if (s.auto_revert_in_s != null) { ST.revertEndMs = Date.now() + s.auto_revert_in_s * 1000; refs.revert.classList.remove('hidden'); }
    else { ST.revertEndMs = 0; refs.revert.classList.add('hidden'); }
    renderMode(); renderHop(); renderStatus(); tickRevert();
  }

  function toggleMode() {
    if (!ST.online) { toast('warn', 'Controller offline — start sigint-controller first'); return; }
    if (ST.transitioning) { toast('warn', 'Mode transition already in progress'); return; }
    if (ST.mode === 'hotspot') openDialog();
    else doRestore();
  }
  function doMonitor() {
    ST.transitioning = true; renderMode();
    toast('warn', 'Requesting MONITOR mode — AP going down…');
    S.setMonitor('field').then(function (r) {
      if (r && r.ok) { toast('err', 'MONITOR MODE active — AP disabled · 30:00 auto-revert'); }
      else { ST.transitioning = false; renderMode(); toast('err', 'Monitor switch failed: ' + ((r && (r.error || r.err)) || 'unknown')); }
      S.loadStatus().then(applyStatus);
    }).catch(function () { ST.transitioning = false; renderMode(); toast('err', 'Monitor switch error'); });
  }
  function doRestore() {
    ST.transitioning = true; renderMode();
    toast('ok', 'Restoring hotspot — AP coming back up…');
    S.setHotspot().then(function (r) {
      if (r && r.ok) toast('ok', 'Hotspot mode restored — AP back up');
      else toast('warn', 'Restore reported: ' + ((r && (r.error || r.err)) || 'unknown'));
      S.loadStatus().then(applyStatus);
    }).catch(function () { ST.transitioning = false; renderMode(); toast('err', 'Restore error'); });
  }
  function tickRevert() {
    if (!wrap || !wrap.isConnected) return;
    if (ST.mode !== 'monitor' || !ST.revertEndMs) { return; }
    var ms = ST.revertEndMs - Date.now();
    if (ms <= 0) { refs.revertTime.textContent = '00:00'; return; }
    var s = Math.floor(ms / 1000); refs.revertTime.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }

  /* ============================================================ DIALOG */
  function buildDialog() {
    var d = el('div', 'sig-dialog'); refs.dialog = d; document.body.appendChild(d);
    d.innerHTML = '<div class="sig-dialog-p"><div class="sig-dialog-h"><span class="ic">⚠</span>SWITCH TO MONITOR MODE</div>' +
      '<div class="sig-dialog-b">Monitor mode takes <b>wlan1 DOWN as an access point</b> for passive 802.11 capture.' +
      '<div class="warn"><b>EVERY client connected to this dashboard over the ATAK_LINUX_1 (wlan1) Wi-Fi will be disconnected immediately</b> — including the device you may be reading this on. The wlan0 internet uplink and WireGuard tunnel are unaffected. A <b>30-minute auto-revert</b> timer restores the hotspot automatically; you can also restore it manually at any time.</div></div>' +
      '<div class="sig-dialog-f"><button class="sig-db" data-x="cancel">CANCEL — STAY IN HOTSPOT</button><button class="sig-db danger" data-x="confirm">CONFIRM — DROP AP, GO MONITOR</button></div></div>';
    d.addEventListener('click', function (e) { if (e.target === d) d.classList.remove('show'); });
    d.querySelector('[data-x="cancel"]').addEventListener('click', function () { d.classList.remove('show'); });
    d.querySelector('[data-x="confirm"]').addEventListener('click', function () { d.classList.remove('show'); doMonitor(); });
  }
  function openDialog() { refs.dialog.classList.add('show'); }

  /* ============================================================ BODY */
  function buildBody() {
    var b = el('div', 'sig-body'); wrap.appendChild(b);
    var main = el('div', 'sig-main'); b.appendChild(main); refs.main = main;
    var f = el('div', 'sig-filters');
    var chips = [['all', 'ALL', ''], ['known', 'KNOWN', 'var(--green)'], ['random', 'RANDOMIZED', 'var(--accent)'], ['unknown', 'UNKNOWN', 'var(--red)']];
    chips.forEach(function (cf) {
      var b2 = el('button', 'sig-fchip' + (cf[0] === 'all' ? ' on' : ''), (cf[2] ? '<span class="dt" style="background:' + cf[2] + '"></span>' : '') + cf[1]);
      b2.addEventListener('click', function () { ST.filter = cf[0]; [].forEach.call(f.querySelectorAll('.sig-fchip'), function (n) { n.classList.remove('on'); }); b2.classList.add('on'); renderTable(); loadVisibleSparklines(); });
      f.appendChild(b2);
    });
    var search = el('input', 'sig-search'); search.placeholder = '🔍 Search MAC / manufacturer…';
    search.addEventListener('input', function () { ST.search = this.value.toUpperCase(); renderTable(); });
    f.appendChild(search);
    var apt = el('button', 'sig-aptoggle on', 'DETECTED APs ▸');
    apt.addEventListener('click', function () { ST.apOpen = !ST.apOpen; refs.side.classList.toggle('collapsed', !ST.apOpen); apt.classList.toggle('on', ST.apOpen); if (ST.apOpen) S.loadBeacons().then(renderAPs); });
    f.appendChild(apt); refs.apToggle = apt;
    main.appendChild(f);
    var tw = el('div', 'sig-tablewrap'); main.appendChild(tw);
    refs.table = el('table', 'sig-table'); tw.appendChild(refs.table);
    var side = el('div', 'sig-side'); b.appendChild(side); refs.side = side;
    side.innerHTML = '<div class="sig-side-h"><span class="sig-sec-h">DETECTED APs</span><button class="x">✕</button></div><div class="sig-ap-sub" id="sigApSub"></div><div class="sig-aplist" id="sigApList"></div>';
    refs.apList = side.querySelector('#sigApList'); refs.apSub = side.querySelector('#sigApSub');
    side.querySelector('.x').addEventListener('click', function () { ST.apOpen = false; side.classList.add('collapsed'); refs.apToggle.classList.remove('on'); });
  }

  var COLS = [
    { k: 'mac', label: 'MAC ADDRESS' }, { k: 'mfr', label: 'MANUFACTURER (OUI)' }, { k: 'cls', label: 'CLASS' },
    { k: 'firstMin', label: 'FIRST SEEN' }, { k: 'lastMin', label: 'LAST SEEN' }, { k: 'rssi', label: 'RSSI' },
    { k: 'spark', label: 'SIGNAL', nosort: true }, { k: 'packets', label: 'PROBES' }, { k: 'status', label: 'STATUS' }
  ];
  function filtered() {
    var arr = S.devices.filter(function (d) {
      if (ST.filter !== 'all' && d.cls !== ST.filter) return false;
      if (ST.search) { if ((d.mac + ' ' + d.mfr).toUpperCase().indexOf(ST.search) < 0) return false; }
      return true;
    });
    var k = ST.sort;
    arr.sort(function (a, b) {
      var va = a[k], vb = b[k];
      if (k === 'cls') { var ord = { unknown: 0, random: 1, known: 2 }; va = ord[a.cls]; vb = ord[b.cls]; }
      if (k === 'status') { var so = { active: 0, stale: 1, gone: 2 }; va = so[a.status]; vb = so[b.status]; }
      if (typeof va === 'string') return ST.dir * va.localeCompare(vb);
      return ST.dir * (va - vb);
    });
    return arr;
  }
  function emptyMsg() {
    if (!ST.online) return 'SIGINT CONTROLLER STOPPED — start the service to capture devices';
    return 'No devices in the database yet — enter MONITOR mode to capture probe requests (this drops the AP)';
  }
  function renderTable() {
    var t = refs.table;
    var thead = '<thead><tr>' + COLS.map(function (c) {
      var sorted = ST.sort === c.k;
      return '<th data-k="' + c.k + '"' + (sorted ? ' class="sorted"' : '') + (c.nosort ? ' style="cursor:default"' : '') + '>' + c.label + (sorted ? '<span class="ar">' + (ST.dir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>';
    }).join('') + '</tr></thead>';
    var rows = filtered();
    var tbody = '<tbody>';
    if (!rows.length) {
      tbody += '<tr><td colspan="' + COLS.length + '" class="sig-empty">' + emptyMsg() + '</td></tr>';
    } else {
      rows.forEach(function (d) { tbody += rowHTML(d); if (ST.expanded === d.uid) tbody += detailHTML(d); });
    }
    tbody += '</tbody>';
    t.innerHTML = thead + tbody;
    [].forEach.call(t.querySelectorAll('thead th'), function (th) {
      var k = th.getAttribute('data-k'); var col = COLS.filter(function (c) { return c.k === k; })[0];
      if (col.nosort) return;
      th.addEventListener('click', function () { if (ST.sort === k) ST.dir *= -1; else { ST.sort = k; ST.dir = k === 'lastMin' || k === 'firstMin' ? 1 : -1; } renderTable(); loadVisibleSparklines(); });
    });
    [].forEach.call(t.querySelectorAll('tbody tr[data-uid]'), function (tr) {
      tr.addEventListener('click', function () { var uid = +tr.getAttribute('data-uid'); ST.expanded = ST.expanded === uid ? null : uid; renderTable(); loadVisibleSparklines(); refreshExpandedSparkline(); });
    });
    rows.forEach(function (d) {
      var cv = t.querySelector('canvas[data-spark="' + d.uid + '"]'); if (cv) spark(cv, d.hist.slice(-60), 74, 22);
      if (ST.expanded === d.uid) { var big = t.querySelector('canvas[data-big="' + d.uid + '"]'); if (big) spark(big, d.hist, big.clientWidth || 360, 120, true); }
    });
    if (ST.expanded) wireDetail(rows.filter(function (d) { return d.uid === ST.expanded; })[0]);
  }
  function rowHTML(d) {
    var spk = '<canvas class="sig-spark" data-spark="' + d.uid + '" width="74" height="22"></canvas>';
    var rssiColor = d.rssi > -55 ? 'var(--green)' : d.rssi > -75 ? 'var(--text-1)' : 'var(--text-2)';
    return '<tr data-uid="' + d.uid + '" class="cls-' + d.cls + (ST.expanded === d.uid ? ' sel' : '') + '">' +
      '<td class="mono">' + d.mac + '</td>' +
      '<td>' + esc(d.mfr) + (d.whitelisted ? ' <span style="color:var(--green)">✓</span>' : '') + '</td>' +
      '<td><span class="sig-badge b-' + d.cls + '">' + S.clsLabel[d.cls] + '</span></td>' +
      '<td class="dim">' + d.firstSeen + '</td>' +
      '<td class="dim">' + d.lastSeen + '</td>' +
      '<td><span class="sig-rssi-val" style="color:' + rssiColor + '">' + d.rssi + '</span></td>' +
      '<td>' + spk + '</td>' +
      '<td class="dim">' + d.packets.toLocaleString() + '</td>' +
      '<td><span class="sig-badge b-' + d.status + '">' + S.statusLabel[d.status] + '</span></td></tr>';
  }
  function detailHTML(d) {
    var probes = d.probes.length ? d.probes.map(function (s) { return '<span class="sig-probe' + (s === 'Hidden Network' ? ' hidden-ssid' : '') + '">' + esc(s) + '</span>'; }).join('') : '<span class="sig-probe hidden-ssid">no directed probes captured — broadcast only (probe SSIDs are captured live in monitor mode)</span>';
    var polLine = d.pol ? '<div class="sig-poflag">◆ PATTERN-OF-LIFE FLAGGED — seen across ' + d.sessionCount + ' sessions' + (d.distinctLocations > 1 ? ' · ' + d.distinctLocations + ' distinct locations' : '') + (d.recentPersistent ? ' · recent persistent' : '') + '</div>' : '';
    return '<tr class="sig-detail" data-detail="' + d.uid + '"><td colspan="' + COLS.length + '"><div class="sig-detail-inner">' +
      '<div class="sig-dcol"><h4>DEVICE INTELLIGENCE</h4>' +
      '<div class="sig-dfield"><span class="k">FULL MAC</span><span class="v mono">' + d.mac + '</span>' +
      '<span class="k">MANUFACTURER</span><span class="v">' + esc(d.mfr) + '</span>' +
      '<span class="k">CLASSIFICATION</span><span class="v">' + S.clsLabel[d.cls] + ' (' + esc(d.classificationRaw || '—') + ')</span>' +
      '<span class="k">FIRST SEEN</span><span class="v">' + d.firstSeen + ' (' + S.lastText(d.firstMin) + ' ago)</span>' +
      '<span class="k">LAST SEEN</span><span class="v">' + d.lastSeen + ' (' + S.lastText(d.lastMin) + ' ago)</span>' +
      '<span class="k">PROBE PACKETS</span><span class="v">' + d.packets.toLocaleString() + '</span>' +
      '<span class="k">SESSIONS</span><span class="v">' + d.sessionCount + '</span>' +
      '<span class="k">CHANNEL</span><span class="v">' + (d.channel != null ? ('ch ' + d.channel + ' · ' + (d.channel <= 14 ? '2.4GHz' : '5GHz')) : '—') + '</span></div>' +
      polLine +
      '<h4>PROBE REQUEST TARGETS</h4><div class="sig-probes">' + probes + '</div>' +
      '<div class="sig-dactions"><button class="sig-dbtn green" data-act="whitelist"' + (d.whitelisted ? ' disabled' : '') + '>✓ ' + (d.whitelisted ? 'WHITELISTED' : 'WHITELIST (MARK KNOWN)') + '</button>' +
      '<button class="sig-dbtn amber" data-act="alert">🔔 ' + (d.alerted ? 'ALERT SET' : 'SET ALERT') + '</button>' +
      '<button class="sig-dbtn" data-act="copy">📋 COPY MAC</button></div></div>' +
      '<div class="sig-dcol"><h4>RSSI HISTORY — LAST ' + d.hist.length + ' SAMPLES</h4><canvas class="sig-bigchart" data-big="' + d.uid + '"></canvas>' +
      '<div class="sig-dfield" style="margin-top:12px"><span class="k">BEST RSSI</span><span class="v">' + d.rssi + ' dBm</span>' +
      '<span class="k">WORST RSSI</span><span class="v">' + d.worstRssi + ' dBm</span>' +
      '<span class="k">MEAN</span><span class="v">' + Math.round(d.hist.reduce(function (a, b) { return a + b; }, 0) / d.hist.length) + ' dBm</span>' +
      '<span class="k">STATUS</span><span class="v">' + S.statusLabel[d.status] + '</span></div></div>' +
      '</div></td></tr>';
  }
  function wireDetail(d) {
    if (!d) return;
    var row = refs.table.querySelector('tr[data-detail="' + d.uid + '"]'); if (!row) return;
    var wbtn = row.querySelector('[data-act="whitelist"]');
    if (wbtn && !d.whitelisted) wbtn.addEventListener('click', function (e) {
      e.stopPropagation();
      wbtn.disabled = true; wbtn.textContent = '✓ WHITELISTING…';
      S.api.postJSON('/api/sigint/whitelist', { mac: d.rawMac, label: 'user-' + d.rawMac }).then(function (r) {
        if (r && r.ok) { d.whitelisted = true; d.cls = 'known'; toast('ok', 'Whitelisted ' + d.mac + ' — added to known DB'); renderTable(); renderStatus(); }
        else { wbtn.disabled = false; wbtn.textContent = '✓ WHITELIST (MARK KNOWN)'; toast('err', 'Whitelist failed: ' + ((r && (r.error || r.err)) || 'unknown')); }
      }).catch(function () { wbtn.disabled = false; toast('err', 'Whitelist error'); });
    });
    row.querySelector('[data-act="alert"]').addEventListener('click', function (e) {
      e.stopPropagation(); d.alerted = !d.alerted; toast(d.alerted ? 'ok' : 'warn', d.alerted ? 'Ticker watch armed for ' + d.mac : 'Watch disarmed');
      if (d.alerted && window.DBShell) DBShell.ticker('SIGINT', 'var(--purple)', 'Watch armed — MAC: ' + d.mac + '  MFR: ' + d.mfr); renderTable();
    });
    row.querySelector('[data-act="copy"]').addEventListener('click', function (e) { e.stopPropagation(); if (navigator.clipboard) navigator.clipboard.writeText(d.rawMac).catch(function () {}); toast('ok', 'Copied ' + d.mac); });
  }

  /* ---- lazy sparkline loading (real /api/sigint/sparkline, cached per mac) ---- */
  function loadVisibleSparklines() {
    if (!ST.online) return;
    filtered().slice(0, 60).forEach(function (d) {
      if (d._sparkLoaded || d._sparkFetching) return;
      d._sparkFetching = true;
      S.loadSparkline(d, 'all').then(function () {
        d._sparkFetching = false;
        if (gone()) return;
        var cv = refs.table.querySelector('canvas[data-spark="' + d.uid + '"]'); if (cv) spark(cv, d.hist.slice(-60), 74, 22);
        if (ST.expanded === d.uid) { var big = refs.table.querySelector('canvas[data-big="' + d.uid + '"]'); if (big) spark(big, d.hist, big.clientWidth || 360, 120, true); }
      });
    });
  }
  function refreshExpandedSparkline() {
    if (!ST.online || ST.expanded == null) return;
    var d = S.devices.filter(function (x) { return x.uid === ST.expanded; })[0]; if (!d) return;
    S.loadSparkline(d, 'all').then(function () {
      if (gone()) return;
      var big = refs.table.querySelector('canvas[data-big="' + d.uid + '"]'); if (big) spark(big, d.hist, big.clientWidth || 360, 120, true);
      var cv = refs.table.querySelector('canvas[data-spark="' + d.uid + '"]'); if (cv) spark(cv, d.hist.slice(-60), 74, 22);
    });
  }

  /* ---- ticker: UNKNOWN non-randomized devices new this poll ---- */
  function tickerCheck() {
    S.devices.forEach(function (d) {
      if (d.cls !== 'unknown') return;             // only unknown class
      if (d.classificationRaw === 'random') return; // and non-randomized
      if (S._seenUnknown[d.rawMac]) return;
      S._seenUnknown[d.rawMac] = 1;
      if (!primedTicker) return;                    // don't flood on first load
      if (window.DBShell) {
        DBShell.ticker('SIGINT', 'var(--purple)', 'Unknown device detected — MAC: ' + d.mac + '  ' + d.mfr);
        if (d.pol) DBShell.ticker('ALERT', 'var(--red)', 'SIGINT pattern-of-life — ' + d.mac + ' recurring presence');
      }
    });
  }

  /* ============================================================ SPARKLINES (canvas) */
  function spark(cv, arr, w, h, big) {
    if (!arr || arr.length < 2) arr = arr && arr.length ? [arr[0], arr[0]] : [-99, -99];
    var dpr = window.devicePixelRatio || 1;
    if (big && !w) w = cv.clientWidth || 360;
    cv.width = w * dpr; cv.height = h * dpr;
    var x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, h);
    var mn = -95, mx = -30;
    if (big) {
      x.strokeStyle = 'rgba(136,152,170,0.12)'; x.lineWidth = 1;
      for (var g = 1; g < 4; g++) { var gy = h / 4 * g; x.beginPath(); x.moveTo(0, gy); x.lineTo(w, gy); x.stroke(); }
    }
    x.strokeStyle = '#E8B54A'; x.lineWidth = big ? 1.6 : 1.2; x.beginPath();
    arr.forEach(function (v, i) { var px = i / (arr.length - 1) * w, py = h - (v - mn) / (mx - mn) * h; py = Math.max(0, Math.min(h, py)); i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
    if (big) { x.lineTo(w, h); x.lineTo(0, h); x.closePath(); x.fillStyle = 'rgba(232,181,74,0.08)'; x.fill(); }
  }

  /* ============================================================ AP SIDE PANEL */
  function renderAPs() {
    if (gone()) return;
    refs.apSub.textContent = ST.online ? (S.beacons.length + ' access points · beacon frames (not probes)') : 'controller offline';
    refs.apList.innerHTML = '';
    if (!S.beacons.length) { refs.apList.appendChild(el('div', 'sig-ap', '<div class="ssid" style="color:var(--text-2)">' + (ST.online ? 'No beacons captured — enter monitor mode' : 'Controller stopped') + '</div>')); return; }
    S.beacons.forEach(function (ap) {
      var bars = signalBars(ap.rssi);
      var encCls = ap.enc === 'OPEN' || ap.enc === 'WEP' ? 'open' : /WPA3/.test(ap.enc) ? 'wpa3' : '';
      var row = el('div', 'sig-ap');
      row.innerHTML = '<div class="ssid">' + esc(ap.ssid) + '<span class="enc ' + encCls + '">' + ap.enc + '</span></div>' +
        '<div class="bssid">' + ap.bssid + '</div>' +
        '<div class="meta"><span>CH <b>' + (ap.channel || '—') + '</b></span><span>' + ap.band + 'G</span><span>RSSI <b>' + ap.rssi + '</b></span><span class="bars">' + bars + '</span></div>';
      refs.apList.appendChild(row);
    });
  }
  function signalBars(rssi) { var lv = rssi > -50 ? 5 : rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -80 ? 2 : 1; var s = ''; for (var i = 0; i < 5; i++) s += '<i class="' + (i < lv ? 'on' : '') + '" style="height:' + (3 + i * 2) + 'px"></i>'; return s; }

  /* ============================================================ STATUS BAR */
  function buildStatus() { var s = el('div', 'sig-status'); wrap.appendChild(s); refs.status = s; }
  function renderStatus() {
    var unk = S.devices.filter(function (d) { return d.cls === 'unknown' && !d.whitelisted; }).length;
    var st = S.status || {};
    var sessMacs = (st.unique_macs_session != null ? st.unique_macs_session : 0);
    var sessProbes = (st.probe_count != null ? st.probe_count : 0);
    var ch = (ST.hopIdx >= 0 ? S.HOP_PLAN[ST.hopIdx] : ST.curChannel);
    refs.status.innerHTML =
      '<div class="sig-stat">DEVICES (DB) <b>' + S.devices.length + '</b></div>' +
      '<div class="sig-stat' + (unk > 0 ? ' alert' : '') + '">UNKNOWN <b>' + unk + '</b></div>' +
      '<div class="sig-stat">SESSION <b>' + sessMacs + '</b> macs · <b>' + sessProbes.toLocaleString() + '</b> probes</div>' +
      '<div class="sig-stat" id="sigStatChan">CH <b>' + (ch || '—') + '</b> · ' + (ch ? (ch <= 14 ? '2.4G' : '5G') : 'idle') + ' · hop <b>2s</b></div>' +
      '<div class="sig-stat ' + (ST.online ? '' : 'stopped') + '" style="flex:1"><span class="run">SIGINT CONTROLLER: <b>' + (ST.online ? 'RUNNING' : 'STOPPED') + '</b><span class="d"></span></span></div>';
    refs.statChan = refs.status.querySelector('#sigStatChan');
  }

  /* ============================================================ TOAST */
  function buildToast() { refs.toast = el('div', 'sig-toast'); document.body.appendChild(refs.toast); }
  function toast(kind, msg) { var t = refs.toast; t.className = 'sig-toast ' + kind + ' show'; t.textContent = (kind === 'ok' ? '✓ ' : kind === 'err' ? '✗ ' : '⚠ ') + msg; clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, kind === 'err' ? 4200 : 2600); }

  window.addEventListener('resize', function () { if (refs && refs.table && ST && ST.expanded != null) { var d = S.devices.filter(function (x) { return x.uid === ST.expanded; })[0]; if (d) { var big = refs.table.querySelector('canvas[data-big="' + d.uid + '"]'); if (big) spark(big, d.hist, big.clientWidth || 360, 120, true); } } });

})(window.DBSigint);
