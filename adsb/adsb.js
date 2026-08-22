/* ============================================================
   DOOM BOX — ADS-B UI
   Live sortable table, summary stats, aircraft detail, alerts.
   ============================================================ */
window.DBAdsb = window.DBAdsb || {};
(function (A) {
  "use strict";
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function svg(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }

  var ST, wrap, refs;
  A._iv = A._iv || [];

  /* ---- value color scales ---- */
  function altCls(a) { return a < 10000 ? 'val-lo' : a < 25000 ? 'val-md' : a < 38000 ? 'val-hi' : 'val-xhi'; }
  function spdCls(s) { return s < 150 ? 'val-lo' : s < 350 ? 'val-md' : s < 480 ? 'val-hi' : 'val-xhi'; }
  function lsCls(s) { return s > 60 ? 'ab-ls crit' : s > 30 ? 'ab-ls warn' : 'ab-ls'; }
  function vr(a) { return a.vrate > 100 ? '<span class="ab-vr vr-up">▲</span>' : a.vrate < -100 ? '<span class="ab-vr vr-dn">▼</span>' : '<span class="ab-vr vr-lvl">—</span>'; }
  function typeColor(c) { return c === 'MILITARY' ? '#EE4444' : c === 'COMMERCIAL' ? '#5EB8E8' : c === 'GENERAL' ? '#5DD87A' : c === 'HELICOPTER' ? '#E8B54A' : '#8898AA'; }

  /* ---- columns ---- */
  var COLS = [
    { key: 'callsign', label: 'CALLSIGN', def: 1, dyn: 0, sort: function (a) { return a.callsign || a.hex; }, cell: function (a) { var chips = (a.mil ? '<span class="ab-chip chip-MIL">MIL</span>' : '') + (a.interesting ? '<span class="ab-chip chip-star">★</span>' : '') + (a.isNew && Date.now() - a.isNew < 60000 ? '<span class="ab-chip chip-NEW">NEW</span>' : ''); return '<div class="ab-cs cs"><span>' + (a.callsign || '<span class="h">' + a.hex + '</span>') + chips + '</span></div>'; } },
    { key: 'hex', label: 'ICAO HEX', def: 1, dyn: 0, sort: function (a) { return a.hex; }, cell: function (a) { return '<span class="ab-hex' + (a.mil ? ' mil' : '') + '">' + a.hex + '</span>'; } },
    { key: 'type', label: 'TYPE', def: 0, dyn: 0, sort: function (a) { return a.type; }, cell: function (a) { return '<span class="ab-type"><span class="ti" style="background:' + typeColor(a.cat) + '"></span>' + (a.mil ? '<span style="color:var(--red)">' + a.type + '</span>' : a.type) + '</span>'; } },
    { key: 'altitude', label: 'ALTITUDE', def: 1, dyn: 1, sort: function (a) { return a.alt; }, cell: function (a) { return '<span class="' + altCls(a.alt) + '">' + Math.round(a.alt).toLocaleString() + '</span> ' + vr(a); } },
    { key: 'speed', label: 'SPEED', def: 1, dyn: 1, sort: function (a) { return a.spd; }, cell: function (a) { return '<span class="' + spdCls(a.spd) + '">' + Math.round(a.spd) + '</span> kt'; } },
    { key: 'heading', label: 'HEADING', def: 1, dyn: 1, sort: function (a) { return a.hdg; }, cell: function (a) { return Math.round(a.hdg) + '° ' + A.card(a.hdg); } },
    { key: 'distance', label: 'DISTANCE', def: 1, dyn: 1, sort: function (a) { var d = a._dist != null ? a._dist : A.dist(A.OWN, a); return d == null ? 1e9 : d; }, cell: function (a) { var d = a._dist != null ? a._dist : A.dist(A.OWN, a); if (d == null) return '<span class="h">—</span>'; var b = a._brg || A.bearing(A.OWN, a); return d.toFixed(1) + ' nm · ' + Math.round(b) + '°'; } },
    { key: 'squawk', label: 'SQUAWK', def: 1, dyn: 1, sort: function (a) { return a.squawk; }, cell: function (a) { var e = a.squawk === '7500' || a.squawk === '7600' || a.squawk === '7700'; return '<span class="ab-sq' + (e ? ' emerg' : '') + '">' + a.squawk + '</span>'; } },
    { key: 'lastseen', label: 'LAST SEEN', def: 1, dyn: 1, sort: function (a) { return a.lastSeen; }, cell: function (a) { return '<span class="' + lsCls(a.lastSeen) + '">' + Math.round(a.lastSeen) + 's</span>'; } },
    { key: 'flag', label: 'FLAG', def: 0, dyn: 0, sort: function (a) { return a.country; }, cell: function (a) { return '<span class="ab-flag">' + (a.country || '—') + '</span>'; } },
    { key: 'airline', label: 'AIRLINE', def: 0, dyn: 0, sort: function (a) { return a.op || ''; }, cell: function (a) { return a.op || '—'; } },
    { key: 'origin', label: 'ORIGIN', def: 0, dyn: 0, sort: function (a) { return a.origin[0]; }, cell: function (a) { return a.origin[0]; } },
    { key: 'dest', label: 'DEST', def: 0, dyn: 0, sort: function (a) { return a.dest[0]; }, cell: function (a) { return a.dest[0]; } },
    { key: 'reg', label: 'REG', def: 0, dyn: 0, sort: function (a) { return a.reg; }, cell: function (a) { return a.reg; } },
    { key: 'age', label: 'AGE', def: 0, dyn: 0, sort: function (a) { return a.year; }, cell: function (a) { return a.year; } },
    { key: 'category', label: 'CAT', def: 0, dyn: 0, sort: function (a) { return a.emitterCat; }, cell: function (a) { return a.emitterCat; } },
    { key: 'rssi', label: 'RSSI', def: 0, dyn: 1, sort: function (a) { return a.rssi == null ? -999 : a.rssi; }, cell: function (a) { return a.rssi == null ? '—' : a.rssi.toFixed(1); } },
    { key: 'messages', label: 'MSGS', def: 0, dyn: 1, sort: function (a) { return a.msgs; }, cell: function (a) { return a.msgs.toLocaleString(); } },
    { key: 'track', label: 'TRACK', def: 0, dyn: 1, sort: function (a) { return a.tracks; }, cell: function (a) { return a.tracks; } }
  ];
  var COLMAP = {}; COLS.forEach(function (c) { COLMAP[c.key] = c; });

  /* ============================================================ MOUNT */
  A.mount = function (container) {
    A._iv.forEach(clearInterval); A._iv = [];
    ['.ab-modal', '.ab-toast'].forEach(function (s) { [].forEach.call(document.querySelectorAll(s), function (e) { e.remove(); }); });
    A.build();
    ST = { filter: 'ALL', search: '', sortKey: 'distance', sortDir: 1, cols: {}, sel: null, sessionOpen: false, colddOpen: false };
    COLS.forEach(function (c) { ST.cols[c.key] = !!c.def; });
    // military contacts (AE**** hex) → scrolling ticker with ADSB tag
    A._onMil = function (a) { if (window.DBShell && DBShell.ticker) DBShell.ticker('ADSB', '#EE4444', 'MILITARY ' + (a.callsign || a.hex) + ' · ' + a.hex + ' · ' + Math.round(a.alt).toLocaleString() + ' ft · SQ ' + a.squawk); };
    container.style.padding = '0'; container.style.position = 'relative'; container.style.overflow = 'hidden';
    container.innerHTML = ''; wrap = el('div', 'adsb'); container.appendChild(wrap); refs = {};
    buildLeft(); buildRight(); buildModal(); buildToast();
    rebuildTable(); renderRight();
    // initial live load + 5 s poll
    A.refresh(function () { if (!wrap.isConnected) return; rebuildTable(); renderRight(); if (ST.sessionOpen) renderSession(); });
    A._iv.push(setInterval(function () { if (!wrap.isConnected) { A._iv.forEach(clearInterval); return; } A.refresh(function () { rebuildTable(); renderRight(); if (ST.sessionOpen) renderSession(); }); }, A.POLL_MS));
    A._iv.push(setInterval(tick, 1000));
  };

  /* ============================================================ LEFT */
  function buildLeft() {
    var L = el('div', 'ab-left'); wrap.appendChild(L); refs.left = L;
    var top = el('div', 'ab-topbar');
    top.innerHTML = '<div class="ab-count"><span class="n">0</span><span class="s">in range · last sweep 0:00 ago</span></div>';
    refs.count = top.querySelector('.n'); refs.countSub = top.querySelector('.s');
    var filters = el('div', 'ab-filters');
    ['ALL', 'MILITARY', 'COMMERCIAL', 'GENERAL', 'HELICOPTER', 'UNKNOWN', 'ALERT'].forEach(function (f) {
      var b = el('button', 'ab-fchip' + (f === 'ALL' ? ' on' : ''), f); b.addEventListener('click', function () { ST.filter = f; [].forEach.call(filters.children, function (c) { c.classList.remove('on'); }); b.classList.add('on'); rebuildTable(); }); filters.appendChild(b);
    });
    top.appendChild(filters);
    var search = el('input', 'ab-search'); search.placeholder = '🔍 callsign, hex, airline…'; search.addEventListener('input', function () { ST.search = search.value.toUpperCase(); rebuildTable(); }); top.appendChild(search);
    var rc = el('div', 'ab-rctrls');
    rc.innerHTML = '<div class="ab-live"><span class="dot"></span>LIVE</div>';
    var colBtn = el('div', 'ab-tb-btn', 'COLUMNS ▾'); colBtn.style.position = 'relative';
    var dd = el('div', 'ab-coldd'); COLS.forEach(function (c) { var ci = el('div', 'ci' + (ST.cols[c.key] ? ' on' : ''), '<span class="bx"></span>' + c.label); ci.addEventListener('click', function (e) { e.stopPropagation(); ST.cols[c.key] = !ST.cols[c.key]; ci.classList.toggle('on', ST.cols[c.key]); rebuildTable(); }); dd.appendChild(ci); });
    colBtn.appendChild(dd); colBtn.addEventListener('click', function () { dd.classList.toggle('show'); }); refs.coldd = dd;
    var sesBtn = el('div', 'ab-tb-btn', '📊 SESSION LOG'); sesBtn.addEventListener('click', function () { ST.sessionOpen = !ST.sessionOpen; refs.session.classList.toggle('open', ST.sessionOpen); sesBtn.classList.toggle('on', ST.sessionOpen); if (ST.sessionOpen) renderSession(); });
    var mapBtn = el('div', 'ab-tb-btn', '📍 SHOW ALL ON MAP'); mapBtn.addEventListener('click', showAllMap);
    rc.appendChild(colBtn); rc.appendChild(sesBtn); rc.appendChild(mapBtn); top.appendChild(rc);
    L.appendChild(top);

    var tw = el('div', 'ab-tablewrap'); var tbl = el('table', 'ab-table'); tbl.innerHTML = '<thead></thead><tbody></tbody>'; tw.appendChild(tbl); L.appendChild(tw);
    refs.thead = tbl.querySelector('thead'); refs.tbody = tbl.querySelector('tbody');

    var ses = el('div', 'ab-session'); refs.session = ses; L.appendChild(ses);
    document.addEventListener('click', function (e) { if (refs.coldd && !e.target.closest('.ab-tb-btn')) refs.coldd.classList.remove('show'); });
  }

  function visCols() { return COLS.filter(function (c) { return ST.cols[c.key]; }); }
  function filtered() {
    var list = A.fleet.filter(function (a) {
      if (ST.filter === 'MILITARY' && !a.mil) return false;
      if (ST.filter === 'COMMERCIAL' && a.cat !== 'COMMERCIAL') return false;
      if (ST.filter === 'GENERAL' && a.cat !== 'GENERAL') return false;
      if (ST.filter === 'HELICOPTER' && a.cat !== 'HELICOPTER') return false;
      if (ST.filter === 'UNKNOWN' && a.cat !== 'UNKNOWN') return false;
      if (ST.filter === 'ALERT' && !a.alertCfg && !a.emergency) return false;
      if (ST.search) { var s = (a.callsign + ' ' + a.hex + ' ' + (a.op || '') + ' ' + a.type).toUpperCase(); if (s.indexOf(ST.search) < 0) return false; }
      return true;
    });
    var col = COLMAP[ST.sortKey];
    list.sort(function (a, b) { var x = col.sort(a), y = col.sort(b); return (x > y ? 1 : x < y ? -1 : 0) * ST.sortDir; });
    list.sort(function (a, b) { return rank(b) - rank(a); });
    return list;
  }
  function rank(a) { return (a.emergency ? 3 : 0) + (a.mil ? 2 : 0) + (a.pinned ? 1 : 0); }

  function rebuildTable() {
    if (!refs.thead) return;
    var cols = visCols();
    refs.thead.innerHTML = '<tr>' + cols.map(function (c) { var on = ST.sortKey === c.key; return '<th data-k="' + c.key + '" class="' + (on ? 'sorted' : '') + '">' + c.label + (on ? ' <span class="ar">' + (ST.sortDir > 0 ? '▲' : '▼') + '</span>' : '') + '</th>'; }).join('') + '<th></th></tr>';
    [].forEach.call(refs.thead.querySelectorAll('th[data-k]'), function (th) { th.addEventListener('click', function () { var k = th.getAttribute('data-k'); if (ST.sortKey === k) ST.sortDir *= -1; else { ST.sortKey = k; ST.sortDir = 1; } rebuildTable(); }); });
    var list = filtered(); refs.tbody.innerHTML = ''; refs._rows = {};
    if (!list.length) {
      refs.tbody.innerHTML = '<tr class="ab-emptyrow"><td colspan="' + (cols.length + 1) + '"><div class="ab-emptybox"><div class="ei">✈</div><div class="et">NO AIRCRAFT IN RANGE</div><div class="es">' + (A.fleet.length ? 'No aircraft match the current filter.' : 'No ADS-B contacts within receiver range — antenna line-of-sight dependent.') + '</div></div></td></tr>';
      updateCount(); return;
    }
    list.forEach(function (a) {
      var tr = el('tr', (ST.sel === a.hex ? 'sel ' : '') + (a.emergency ? 'emerg ' : a.mil ? 'mil ' : a.interesting ? 'interesting ' : '') + (a.stale ? 'stale ' : '') + (a.isNew && Date.now() - a.isNew < 1500 ? 'newarr' : ''));
      tr._cells = {};
      cols.forEach(function (c) { var td = el('td'); td.innerHTML = c.cell(a); tr.appendChild(td); if (c.dyn) tr._cells[c.key] = td; });
      var act = el('td'); act.innerHTML = '<span class="ab-rowacts"><button data-a="map" title="Map">📍</button><button data-a="detail" title="Detail">ℹ</button><button data-a="pin" title="Pin">📌</button><button data-a="alert" title="Alert">🔔</button></span>'; tr.appendChild(act);
      tr.addEventListener('click', function (e) { var b = e.target.closest('[data-a]'); if (b) { e.stopPropagation(); rowAct(b.getAttribute('data-a'), a); return; } select(a.hex); });
      refs.tbody.appendChild(tr); refs._rows[a.hex] = tr;
    });
    updateCount();
  }
  function rowAct(act, a) { if (act === 'map') centerMap(a); else if (act === 'detail') select(a.hex); else if (act === 'pin') { a.pinned = !a.pinned; rebuildTable(); toast(a.pinned ? 'PINNED ' + (a.callsign || a.hex) : 'UNPINNED'); } else if (act === 'alert') openModal(a); }

  function tick() {
    if (!wrap || !wrap.isConnected) { A._iv.forEach(clearInterval); return; }
    var removed = A.tickAge();   // age effective last-seen; drop aircraft >120 s
    if (removed && removed.length) { rebuildTable(); }
    else {
      var cols = visCols();
      Object.keys(refs._rows || {}).forEach(function (hex) {
        var a = byHex(hex), tr = refs._rows[hex]; if (!a) return;
        cols.forEach(function (c) { if (c.dyn && tr._cells[c.key]) tr._cells[c.key].innerHTML = c.cell(a); });
        tr.classList.toggle('stale', !!a.stale);
        if (a.isNew && Date.now() - a.isNew > 1500) tr.classList.remove('newarr');
      });
    }
    updateCount();
    if (ST.sel) renderDetail(byHex(ST.sel)); else renderSummary();
    if (ST.sessionOpen) renderSession();
  }
  function byHex(h) { return A.fleet.filter(function (a) { return a.hex === h; })[0]; }
  function updateCount() {
    refs.count.textContent = A.fleet.length + (A.fleet.length === 1 ? ' AIRCRAFT' : ' AIRCRAFT');
    var ago = A.receiver.lastPoll ? Math.round((Date.now() - A.receiver.lastPoll) / 1000) : '–';
    var ref = A.gpsFix ? 'GPS FIX' : 'VEGAS REF (no GPS fix)';
    refs.countSub.textContent = 'in range · ref ' + ref + ' · swept ' + ago + 's ago';
  }

  function select(hex) { ST.sel = ST.sel === hex ? null : hex; [].forEach.call(refs.tbody.querySelectorAll('tr'), function (t) { t.classList.remove('sel'); }); if (ST.sel && refs._rows[hex]) refs._rows[hex].classList.add('sel'); renderRight(); }

  /* ============================================================ RIGHT */
  function buildRight() { var R = el('div', 'ab-right'); wrap.appendChild(R); refs.right = R; }
  function renderRight() { if (ST.sel) renderDetail(byHex(ST.sel)); else renderSummary(); }

  function renderSummary() {
    var f = A.fleet, mil = f.filter(function (a) { return a.mil; }).length;
    var highest = f.length ? f.reduce(function (m, a) { return a.alt > m.alt ? a : m; }) : null;
    var fastest = f.length ? f.reduce(function (m, a) { return a.spd > m.spd ? a : m; }) : null;
    var closest = f.length ? f.reduce(function (m, a) { return ((a._dist == null ? 1e9 : a._dist) < (m._dist == null ? 1e9 : m._dist)) ? a : m; }) : null;
    if (!refs.right._summary) {
      refs.right.innerHTML = '<div class="ab-pad"><div class="ab-rh ab-brk" style="padding:10px 12px">ADS-B SUMMARY</div>' +
        '<div class="ab-stats" id="ab-stats"></div>' +
        '<div class="ab-sec">ALTITUDE DISTRIBUTION</div><div id="ab-altdist"></div>' +
        '<div class="ab-sec">RANGE COVERAGE</div><div class="ab-range"><canvas id="ab-rangecv" width="200" height="200"></canvas></div>' +
        '<div class="ab-sec">RECEIVER HEALTH</div><div class="ab-health" id="ab-health"></div></div>';
      refs.right._summary = true; refs.right._detail = false;
    }
    var stat = function (k, v, s) { return '<div class="ab-stat"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="sub">' + s + '</div></div>'; };
    refs.right.querySelector('#ab-stats').innerHTML =
      stat('IN RANGE', f.length, 'aircraft') + stat('MILITARY', mil, 'AE**** hex') +
      stat('HIGHEST', highest ? Math.round(highest.alt / 1000) + 'k ft' : '—', highest ? (highest.callsign || highest.hex) : '—') +
      stat('FASTEST', fastest ? Math.round(fastest.spd) + ' kt' : '—', fastest ? (fastest.callsign || fastest.hex) : '—') +
      stat('CLOSEST', (closest && closest._dist != null) ? closest._dist.toFixed(1) + ' nm' : '—', closest ? (closest.callsign || closest.hex) : '—') +
      stat('SESSION', A.sessionTotal, 'this session');
    var bands = [['FL400+', 40000, 1e9], ['FL300-400', 30000, 40000], ['FL200-300', 20000, 30000], ['FL100-200', 10000, 20000], ['<FL100', 0, 10000]];
    var max = 1; var counts = bands.map(function (b) { var n = f.filter(function (a) { return a.alt >= b[1] && a.alt < b[2]; }).length; max = Math.max(max, n); return n; });
    refs.right.querySelector('#ab-altdist').innerHTML = bands.map(function (b, i) { return '<div class="ab-altbar"><span class="lb">' + b[0] + '</span><span class="track"><i style="width:' + (counts[i] / max * 100) + '%"></i></span><span class="ct">' + counts[i] + '</span></div>'; }).join('');
    var rec = A.receiver;
    refs.right.querySelector('#ab-health').innerHTML =
      '<div><span class="k">Aircraft tracked</span> ' + f.length + '</div>' +
      '<div><span class="k">Military (AE****)</span> ' + mil + '</div>' +
      '<div><span class="k">GPS reference</span> <span class="' + (rec.gpsFix ? 'good' : '') + '">' + (rec.gpsFix ? 'GPS FIX' : 'VEGAS FALLBACK') + '</span></div>' +
      '<div><span class="k">dump1090 feed</span> <span class="' + (rec.ok ? 'good' : '') + '">' + (rec.ok ? 'OK' : 'unavailable') + '</span></div>' +
      '<div><span class="k">Last sweep</span> ' + (rec.lastPoll ? Math.round((Date.now() - rec.lastPoll) / 1000) + 's ago' : '—') + '</div>';
    drawRange();
  }
  function drawRange() {
    var cv = refs.right.querySelector('#ab-rangecv'); if (!cv) return; var dpr = window.devicePixelRatio || 1; cv.width = 200 * dpr; cv.height = 200 * dpr; var x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); var cx = 100, cy = 100, R = 92;
    x.clearRect(0, 0, 200, 200);
    [25, 50, 100, 150, 200].forEach(function (nm) { var r = nm / 200 * R; x.strokeStyle = 'rgba(136,152,170,0.25)'; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke(); x.fillStyle = 'rgba(136,152,170,0.5)'; x.font = '7px ' + mono(); x.fillText(nm, cx + 2, cy - r + 8); });
    x.strokeStyle = 'rgba(136,152,170,0.15)'; x.beginPath(); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.stroke();
    A.fleet.forEach(function (a) { var d = a._dist || A.dist(A.OWN, a), b = a._brg || A.bearing(A.OWN, a); if (d > 200) return; var r = d / 200 * R, px = cx + Math.sin(b * Math.PI / 180) * r, py = cy - Math.cos(b * Math.PI / 180) * r; x.fillStyle = a.emergency ? '#EE4444' : a.mil ? '#EE4444' : a.cat === 'COMMERCIAL' ? '#5EB8E8' : a.cat === 'GENERAL' ? '#5DD87A' : '#E8B54A'; x.fillRect(px - 1.5, py - 1.5, 3, 3); });
    x.fillStyle = '#E8B54A'; x.beginPath(); x.arc(cx, cy, 3, 0, 7); x.fill();
  }

  function symFor(a) {
    var s = '<svg viewBox="0 0 24 24" fill="rgba(12,16,24,0.7)" stroke-width="1.6" stroke-linejoin="round">';
    if (a.mil || a.emergency) return s + '<path d="M12 3 L20 12 L12 21 L4 12 Z" stroke="#EE4444"/></svg>';
    if (a.cat === 'COMMERCIAL') return s + '<path d="M4 14 a8 8 0 0 1 16 0 Z" stroke="#5EB8E8"/></svg>';
    if (a.cat === 'GENERAL') return s + '<rect x="5" y="5" width="14" height="14" stroke="#5DD87A"/></svg>';
    if (a.cat === 'HELICOPTER') return s + '<circle cx="12" cy="12" r="8" stroke="#E8B54A"/><path d="M5 5 L19 19 M19 5 L5 19" stroke="#E8B54A"/></svg>';
    return s + '<path d="M12 5 a7 7 0 1 0 0.01 0 M12 5 v-2" stroke="#E8D24A"/></svg>';
  }

  function renderDetail(a) {
    if (!a) { ST.sel = null; renderSummary(); return; }
    refs.right._summary = false; refs.right._detail = true;
    var d = a._dist || A.dist(A.OWN, a), b = a._brg || A.bearing(A.OWN, a);
    var catBadge = '<span class="ab-dcat cat-' + (a.cat === 'GENERAL' ? 'GENERAL' : a.cat) + '">' + (a.cat === 'GENERAL' ? 'GENERAL AV' : a.cat) + '</span>';
    function card(title, rows, cls) { return '<div class="ab-card ' + (cls || '') + '"><div class="ch">' + title + '</div><div class="cb">' + rows.map(function (r) { return '<span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span>'; }).join('') + '</div></div>'; }
    var mgrs = window.DBMap ? DBMap.toMGRS(a.lat, a.lon) : '—';
    var html = '<div class="ab-pad"><div class="ab-dhead"><div class="ab-dsym">' + symFor(a) + '</div>' +
      '<div class="ab-dcs">' + (a.callsign || a.hex) + '</div>' +
      '<div class="ab-dop">' + (a.op ? a.op + ' · ' : '') + a.typeName + '</div>' +
      '<div class="ab-dhex">' + a.hex + '</div>' + catBadge + '</div>' +
      '<div class="ab-dacts"><button class="ab-dact primary" data-a="map">📍 CENTER ON MAP</button>' +
      '<button class="ab-dact" data-a="alert">🔔 SET ALERT</button><button class="ab-dact" data-a="pin">📌 ' + (a.pinned ? 'UNPIN' : 'PIN TO TOP') + '</button></div>';
    if (a.emergency) html += card('🚨 EMERGENCY SQUAWK', [], 'emerg').replace('<div class="cb"></div>', '<div class="emerg-codes"><div class="hot">' + a.squawk + ' · ' + sqText(a.squawk) + '</div><div>7500 · HIJACK</div><div>7600 · RADIO FAILURE</div><div>7700 · GENERAL EMERGENCY</div><div style="margin-top:6px">Alert generated: ' + A.zulu(new Date()) + '</div><div>Ticker notification: <span class="hot">ACTIVE</span></div></div>');
    if (a.mil) html += card('⚠ MILITARY CONTACT', [['HEX BLOCK', a.hex.slice(0, 2) + '**** (USAF/USN/USMC)'], ['UNIT', a.op || '(unidentified)'], ['AIRCRAFT', a.typeName], ['NOTE', 'Cross-ref OSINT for context']], 'mil');
    html += card('POSITION &amp; MOVEMENT', [['ALTITUDE', Math.round(a.alt).toLocaleString() + ' ft MSL'], ['CLIMB RATE', a.vrate > 100 ? '▲ +' + a.vrate + ' ft/min' : a.vrate < -100 ? '▼ ' + a.vrate + ' ft/min' : 'Level (±0)'], ['SPEED', Math.round(a.spd) + ' kt GS'], ['HEADING', Math.round(a.hdg) + '° · ' + A.card(a.hdg)], ['POSITION', a.lat.toFixed(4) + '°N ' + Math.abs(a.lon).toFixed(4) + '°W'], ['MGRS', mgrs], ['DISTANCE', d.toFixed(1) + ' nm · brg ' + Math.round(b) + '°']]);
    html += card('IDENTIFICATION', [['SQUAWK', a.squawk + (a.emergency ? ' (EMERGENCY)' : ' (normal)')], ['CATEGORY', a.emitterCat], ['COUNTRY', a.country], ['OPERATOR', a.op || '—'], ['REG', a.reg], ['TYPE', a.type + ' · ' + a.typeName], ['YEAR', a.year]]);
    if (a.cat === 'COMMERCIAL') html += card('ROUTE', [['ORIGIN', a.origin[0] + ' · ' + a.origin[1]], ['DEST', a.dest[0] + ' · ' + a.dest[1]], ['FLIGHT', a.callsign], ['ETA', '(not computed locally)']]);
    html += card('THIS SESSION', [['FIRST SEEN', A.zulu(a.firstSeen) + ' (' + a.firstSeenMin + ' min ago)'], ['POSITION REPORTS', a.tracks], ['MAX ALTITUDE', Math.round(a.maxAlt).toLocaleString() + ' ft'], ['MAX SPEED', Math.round(a.maxSpd) + ' kt'], ['DIST TRAVELED', '~' + Math.round(a.maxSpd * a.firstSeenMin / 60) + ' nm']]);
    html += card('SIGNAL', [['RSSI', a.rssi.toFixed(1) + ' dBFS'], ['MSG RATE', (a.msgs / 600).toFixed(1) + ' / sec'], ['MSG TYPES', 'DF17 ADS-B (ES)'], ['LAST MSG', a.lastSeen.toFixed(1) + 's ago']]);
    html += '<div class="ab-sec">TRACK HISTORY</div><div class="ab-track"><canvas></canvas></div><button class="ab-dact" data-a="map" style="margin-top:0">📍 VIEW ON MAIN MAP</button></div>';
    refs.right.innerHTML = html;
    [].forEach.call(refs.right.querySelectorAll('[data-a]'), function (btn) { btn.addEventListener('click', function () { var k = btn.getAttribute('data-a'); if (k === 'map') centerMap(a); else if (k === 'alert') openModal(a); else if (k === 'pin') { a.pinned = !a.pinned; rebuildTable(); renderDetail(a); } }); });
    drawTrack(a);
  }
  function sqText(s) { return s === '7500' ? 'HIJACK' : s === '7600' ? 'RADIO FAILURE' : 'GENERAL EMERGENCY'; }
  function drawTrack(a) {
    var cv = refs.right.querySelector('.ab-track canvas'); if (!cv) return; var box = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; if (!box.width) return; cv.width = box.width * dpr; cv.height = box.height * dpr; var x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); var w = box.width, h = box.height;
    x.fillStyle = '#0c1018'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(136,152,170,0.08)'; for (var g = 0; g < w; g += 26) { x.beginPath(); x.moveTo(g, 0); x.lineTo(g, h); x.stroke(); } for (g = 0; g < h; g += 26) { x.beginPath(); x.moveTo(0, g); x.lineTo(w, g); x.stroke(); }
    var hist = a.hist; if (hist.length < 2) return;
    var lats = hist.map(function (p) { return p.lat; }), lons = hist.map(function (p) { return p.lon; });
    var mnLat = Math.min.apply(0, lats), mxLat = Math.max.apply(0, lats), mnLon = Math.min.apply(0, lons), mxLon = Math.max.apply(0, lons);
    var pad = 18; function X(lon) { return mxLon === mnLon ? w / 2 : pad + (lon - mnLon) / (mxLon - mnLon) * (w - pad * 2); } function Y(lat) { return mxLat === mnLat ? h / 2 : h - pad - (lat - mnLat) / (mxLat - mnLat) * (h - pad * 2); }
    x.strokeStyle = '#E8B54A'; x.lineWidth = 1.8; x.beginPath(); hist.forEach(function (p, i) { i ? x.lineTo(X(p.lon), Y(p.lat)) : x.moveTo(X(p.lon), Y(p.lat)); }); x.stroke();
    var s = hist[0], c = hist[hist.length - 1]; x.fillStyle = '#5DD87A'; x.beginPath(); x.arc(X(s.lon), Y(s.lat), 4, 0, 7); x.fill();
    x.fillStyle = '#E8B54A'; x.beginPath(); x.arc(X(c.lon), Y(c.lat), 4, 0, 7); x.fill();
  }

  /* ============================================================ SESSION LOG */
  function renderSession() {
    var s = A.session;
    var dur = Math.floor((Date.now() - A.sessionStart) / 60000);
    var rows = s.length
      ? s.slice(0, 60).map(function (rec) {
          var live = A.fleet.some(function (a) { return a.hex === rec.hex; });
          var exit = live ? '<span class="gd">IN RANGE</span>' : A.zulu(new Date(rec.exit || rec.last));
          return '<tr><td><span class="' + (live ? 'gd' : 'gy') + '">●</span> ' + (rec.callsign || rec.hex) + ' <span class="h">' + rec.hex + '</span></td><td>' + A.zulu(new Date(rec.first)) + '</td><td>' + exit + '</td><td>' + Math.round(rec.maxAlt || 0).toLocaleString() + '</td><td>' + Math.round(rec.maxSpd || 0) + '</td><td>' + (rec.dwell || 0) + 'm</td><td>' + (rec.tracks || 0) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="7" style="text-align:center;color:var(--text-2);padding:18px">No aircraft observed yet this session.</td></tr>';
    refs.session.innerHTML = '<div class="sh"><span class="t">SESSION LOG — ' + A.sessionTotal + ' AIRCRAFT OBSERVED</span></div>' +
      '<div class="sbody"><table class="ab-slog-tbl"><thead><tr><th>CALLSIGN / HEX</th><th>ENTRY</th><th>EXIT</th><th>MAX ALT</th><th>MAX SPD</th><th>DWELL</th><th>TRACKS</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' +
      '<div class="ab-sfoot"><span>Session started: ' + A.zulu(A.sessionStart) + ' · Duration: ' + Math.floor(dur / 60) + ':' + (dur % 60 < 10 ? '0' : '') + (dur % 60) + ' · Unique: ' + A.sessionTotal + ' · persisted (localStorage)</span><span class="grp"><button>💾 EXPORT CSV</button><button class="del">🗑 CLEAR</button></span></div>';
    refs.session.querySelector('.del').addEventListener('click', function () { A.clearSession(); renderSession(); toast('SESSION LOG CLEARED'); });
    refs.session.querySelector('.grp button').addEventListener('click', exportSessionCsv);
  }
  function exportSessionCsv() {
    var head = ['callsign', 'hex', 'entry_z', 'exit_z', 'max_alt_ft', 'max_spd_kt', 'dwell_min', 'tracks'];
    var lines = [head.join(',')].concat(A.session.map(function (r) {
      var live = A.fleet.some(function (a) { return a.hex === r.hex; });
      return [r.callsign || '', r.hex, A.zulu(new Date(r.first)), live ? 'IN_RANGE' : A.zulu(new Date(r.exit || r.last)), Math.round(r.maxAlt || 0), Math.round(r.maxSpd || 0), r.dwell || 0, r.tracks || 0].join(',');
    }));
    try {
      var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'doombox_adsb_session.csv'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      toast('EXPORTED ' + A.session.length + ' RECORDS');
    } catch (e) { toast('EXPORT FAILED'); }
  }

  /* ============================================================ MAP HANDOFF */
  function enableMapLayers() { if (window.DBMap) { DBMap.state.active['adsb'] = true; DBMap.state.active['mil_air'] = true; if (DBMap.ui) DBMap.ui.updateLayerCount(); } }
  function showAllMap() { if (window.DBShell) DBShell.go('MAP'); setTimeout(enableMapLayers, 160); }
  function centerMap(a) { if (window.DBShell) DBShell.go('MAP'); setTimeout(function () { enableMapLayers(); if (window.DBMap) { DBMap.tools.setMarker(a.lat, a.lon); DBMap.flyTo(a.lat, a.lon, 11); } }, 160); }

  /* ============================================================ MODAL + TOAST */
  function buildModal() {
    var m = el('div', 'ab-modal'); refs.modal = m;
    m.innerHTML = '<div class="ab-modal-p"><div class="ab-modal-h">SET AIRCRAFT ALERT — <span class="who"></span></div><div class="ab-modal-b">' +
      '<div class="grp-h">Alert when this aircraft:</div>' +
      mrow('radius', 'Enters radius', 1, 25, 'nm from position') + mrow('alt', 'Changes altitude above', 1, 5000, 'ft') +
      mrow('sq', 'Squawks emergency', 0) + mrow('first', 'First appears in range', 1) + mrow('gone', 'Disappears from range', 1) +
      '<div class="grp-h" style="margin-top:10px">Alert via:</div>' +
      mrow('ticker', 'Ticker notification', 1) + mrow('notif', 'Dashboard notification center', 1) + mrow('mesh', 'Mesh broadcast', 0) +
      '</div><div class="ab-modal-f"><button class="ab-mb" data-x="cancel">CANCEL</button><button class="ab-mb amber" data-x="save">SAVE ALERT</button></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('show'); });
    [].forEach.call(m.querySelectorAll('.ab-mrow'), function (r) { r.addEventListener('click', function (e) { if (e.target.tagName === 'INPUT') return; r.classList.toggle('on'); }); });
    m.querySelector('[data-x="cancel"]').addEventListener('click', function () { m.classList.remove('show'); });
    m.querySelector('[data-x="save"]').addEventListener('click', function () { if (ST._alertAc) { ST._alertAc.alertCfg = {}; toast('ALERT SET · ' + (ST._alertAc.callsign || ST._alertAc.hex)); rebuildTable(); } m.classList.remove('show'); });
  }
  function mrow(k, label, on, num, unit) { return '<div class="ab-mrow' + (on ? ' on' : '') + '" data-k="' + k + '"><span class="bx"></span><span>' + label + (num != null ? ': <input class="num" value="' + num + '">' + ' ' + unit : '') + '</span></div>'; }
  function openModal(a) { ST._alertAc = a; refs.modal.querySelector('.who').textContent = a.callsign || a.hex; refs.modal.classList.add('show'); }
  function buildToast() { refs.toast = el('div', 'ab-toast'); document.body.appendChild(refs.toast); }
  function toast(msg) { var t = refs.toast; t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 2000); }

  function mono() { return getComputedStyle(document.body).getPropertyValue('--font-mono') || 'monospace'; }
  window.addEventListener('resize', function () { if (refs && refs.right && refs.right._summary) drawRange(); });

})(window.DBAdsb);
