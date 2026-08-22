/* ============================================================
   DOOM BOX — SYS UI
   7 health cards, 5s polling, canvas sparklines, warning pulse.
   DBSys.mount().
   ============================================================ */
window.DBSys = window.DBSys || {};
(function (S) {
  "use strict";
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function svg(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var IC = {
    bat: svg('<rect x="2" y="7" width="17" height="10"/><path d="M21 10.5 V13.5"/>'),
    gps: svg('<path d="M12 21 C12 21 19 14.5 19 9 a7 7 0 0 0-14 0 C5 14.5 12 21 12 21 Z"/><circle cx="12" cy="9" r="2.4"/>'),
    cpu: svg('<rect x="7" y="7" width="10" height="10"/><path d="M10 3.5V6 M14 3.5V6 M10 18V20.5 M14 18V20.5 M3.5 10H6 M3.5 14H6 M18 10H20.5 M18 14H20.5"/>'),
    mem: svg('<rect x="3" y="7" width="18" height="10"/><path d="M7 7V4 M12 7V4 M17 7V4 M7 20v-3 M12 20v-3 M17 20v-3"/>'),
    disk: svg('<rect x="3" y="4" width="18" height="16"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
    net: svg('<path d="M2 8.5 a14 14 0 0 1 20 0 M5 12 a9 9 0 0 1 14 0 M8.5 15.5 a4.5 4.5 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>'),
    svc: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5V5 M12 19V21.5 M21.5 12H19 M5 12H2.5 M18.4 5.6 L16.6 7.4 M7.4 16.6 L5.6 18.4 M18.4 18.4 L16.6 16.6 M7.4 7.4 L5.6 5.6"/>'),
    therm: svg('<path d="M12 4 a2 2 0 0 0-2 2 V13 a3.5 3.5 0 1 0 4 0 V6 a2 2 0 0 0-2-2 Z"/>'),
    dev: svg('<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M11 18h2"/>'),
    up: svg('<path d="M12 19V5 M6 11l6-6 6 6"/>'),
    dn: svg('<path d="M12 5v14 M6 13l6 6 6-6"/>')
  };

  var ST, wrap, refs;
  S._iv = S._iv || [];

  S.mount = function (container) {
    S._iv.forEach(clearInterval); S._iv = [];
    S.build();
    container.style.padding = '0'; container.style.position = 'relative'; container.style.overflow = 'hidden';
    container.innerHTML = ''; wrap = el('div', 'sys'); container.appendChild(wrap); refs = {};
    var grid = el('div', 'sys-grid'); wrap.appendChild(grid); refs.grid = grid;
    refs.cards = {};
    ['battery', 'gps', 'cpu', 'mem', 'storage', 'net', 'services'].forEach(function (id) {
      var card = el('div', 'sys-card' + (id === 'battery' || id === 'services' ? ' span2' : ''));
      card.innerHTML = '<span class="cnr tr"></span><span class="cnr bl"></span><div class="sys-cardbody"></div>';
      grid.appendChild(card); refs.cards[id] = card;
    });
    renderAll(); drawSparks();
    S._iv.push(setInterval(function () {
      if (!wrap.isConnected) { S._iv.forEach(clearInterval); return; }
      var warns = S.poll(); renderAll(); drawSparks();
      warns.forEach(function (w) { var map = { cpu: 'cpu', mem: 'mem' }; var c = refs.cards[map[w]]; if (c) { c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); } });
    }, 5000));
    // Real-data integration: repaint as soon as an async fetch lands (first
    // paint ~100 ms after mount instead of waiting for the 5 s tick).
    if (!S._wired) {
      S._wired = true;
      window.addEventListener('db:sysdata', function () {
        if (wrap && wrap.isConnected) { renderAll(); drawSparks(); }
      });
    }
  };

  function body(id) { return refs.cards[id].querySelector('.sys-cardbody'); }
  function head(icon, label, warnHtml) { return '<div class="sys-h"><span class="ic">' + icon + '</span>' + label + (warnHtml || '') + '</div>'; }
  function bar(pct, cls) { return '<div class="sys-bar"><i class="' + (cls || '') + '" style="width:' + pct + '%"></i></div>'; }
  function badge(cls, txt, pulse) { return '<span class="sys-badge ' + cls + (pulse ? ' pulse-b' : '') + '">' + txt + '</span>'; }

  function renderAll() { renderBattery(); renderGps(); renderCpu(); renderMem(); renderStorage(); renderNet(); renderServices(); }

  /* ===== BATTERY ===== */
  function renderBattery() {
    var b = S.state.battery, sp = S.spread(b.cells), spCls = S.spreadClass(sp);
    var stCls = b.state === 'CHARGING' || b.state === 'FAST CHARGE' ? 'bg-green' : b.state === 'IDLE' ? 'bg-grey' : 'bg-amber';
    var maxCell = 4200, minCell = 3400;
    var cells = b.cells.map(function (c, i) {
      var h = (c - minCell) / (maxCell - minCell) * 100;
      return '<div class="sys-cell"><div class="cl">CELL ' + (i + 1) + '</div><div class="cbar"><i style="height:' + h + '%"></i></div><div class="cv">' + c.toLocaleString() + '</div><div class="cu">mV</div></div>';
    }).join('');
    var curCls = b.currentMa < 0 ? 'red' : 'green';
    body('battery').innerHTML =
      head(IC.bat, 'BATTERY') +
      '<div class="sys-bat-top"><div class="sys-bat-pct">' + b.pct + '%</div><div class="sys-bat-side">' + bar(b.pct, b.pct < 15 ? 'crit' : '') + badge(stCls, b.state) + '</div></div>' +
      '<div class="sys-cells">' + cells + '</div>' +
      '<div class="sys-spread ' + spCls + '">' + sp + ' mV spread</div>' +
      '<div class="sys-kv"><span class="k">Pack voltage</span><span class="v">' + S.pack(b).toFixed(3) + ' V</span>' +
      '<span class="k">Current draw</span><span class="v ' + curCls + '">' + (b.currentMa > 0 ? '+' : '') + b.currentMa + ' mA</span>' +
      '<span class="k">Power</span><span class="v">' + S.power(b).toFixed(1) + ' W</span>' +
      '<span class="k">Runtime remaining</span><span class="v amber">' + S.runtime(b) + '</span>' +
      '<span class="k">VBUS</span><span class="v">' + b.vbusV + 'V / ' + b.vbusMa + 'mA</span></div>';
  }

  /* ===== GPS ===== */
  function renderGps() {
    var g = S.state.gps;
    var badgeCls = g.fix === 'FIX' ? 'bg-green' : g.fix === 'SEARCHING' ? 'bg-amber' : 'bg-red';
    var badgeTxt = g.fix === 'FIX' ? 'FIX ACQUIRED' : g.fix === 'SEARCHING' ? 'SEARCHING' : 'NO FIX';
    var dotCls = g.fix === 'FIX' ? '' : g.fix === 'SEARCHING' ? 'searching' : 'nofix';
    var mgrs = window.DBMap ? DBMap.toMGRS(g.lat, g.lon) : '18T WL 8364 0481';
    body('gps').innerHTML =
      head(IC.gps, 'GPS') +
      '<div style="display:flex;align-items:center;gap:9px">' + badge(badgeCls, '<span class="sys-gps-dot ' + dotCls + '"></span>' + badgeTxt, g.fix === 'SEARCHING') + '</div>' +
      '<div class="sys-gps-pos">' + mgrs + '</div>' +
      '<div class="sys-gps-ll">' + g.lat.toFixed(4) + '°N  ' + Math.abs(g.lon).toFixed(4) + '°W</div>' +
      '<div class="sys-kv"><span class="k">Altitude</span><span class="v">' + g.alt + ' m MSL</span>' +
      '<span class="k">Satellites</span><span class="v">' + g.sats + ' in view / ' + g.used + ' used</span>' +
      '<span class="k">Accuracy</span><span class="v">±' + g.acc.toFixed(1) + ' m horizontal</span>' +
      '<span class="k">Last update</span><span class="v">00:' + (g.updatedSec < 10 ? '0' : '') + g.updatedSec + ' ago [' + S.zulu() + ']</span>' +
      '<span class="k">Source</span><span class="v">u-blox 7 GPS / gpsd</span></div>';
  }

  /* ===== CPU ===== */
  function renderCpu() {
    var c = S.state.cpu, avg = Math.round(c.cores.reduce(function (a, x) { return a + x; }, 0) / c.cores.length);
    var tCls = S.tempClass(c.temp);
    var cores = c.cores.map(function (p, i) {
      return '<div class="sys-core"><span class="cn">Core ' + i + '</span>' + bar(p, p > 90 ? 'crit' : '') + '<span class="cp">' + p + '%</span></div>';
    }).join('');
    body('cpu').innerHTML =
      head(IC.cpu, 'CPU', c.temp > 70 ? '<span class="warn crit">⚠</span>' : '') +
      '<div class="sys-cores">' + cores + '</div>' +
      '<div class="sys-kv"><span class="k">Overall</span><span class="v">' + avg + '% average · Cortex-A76</span>' +
      '<span class="k">Frequency</span><span class="v">' + c.freq.toFixed(1) + ' GHz</span></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:11px">' +
      '<div class="sys-temp ' + tCls + '"><span class="th">' + IC.therm + '</span>' + c.temp + '°C</div>' +
      '<span class="dim mono" style="font-size:.58rem">last 10 min</span></div>' +
      '<canvas class="sys-spark" data-spark="cputemp"></canvas>' +
      '<div class="sys-kv"><span class="k">Uptime</span><span class="v">' + S.fmtUptime(c.uptimeMin) + '</span></div>';
  }

  /* ===== MEMORY ===== */
  function renderMem() {
    var m = S.state.mem, pct = Math.round(m.usedGb / m.totalGb * 100);
    var avail = (m.totalGb - m.usedGb).toFixed(1);
    body('mem').innerHTML =
      head(IC.mem, 'MEMORY', pct > 85 ? '<span class="warn">⚠</span>' : '') +
      '<div class="mono" style="font-size:1.1rem;color:var(--text-1);margin-bottom:9px">' + m.usedGb.toFixed(1) + ' GB <span class="dim">/ ' + m.totalGb.toFixed(1) + ' GB</span></div>' +
      bar(pct, pct > 85 ? 'crit' : '') +
      '<div class="sys-kv"><span class="k">Used</span><span class="v">' + m.usedGb.toFixed(1) + ' GB (' + pct + '%)</span>' +
      '<span class="k">Cached</span><span class="v">' + m.cachedGb.toFixed(1) + ' GB</span>' +
      '<span class="k">Available</span><span class="v green">' + avail + ' GB</span>' +
      '<span class="k">Swap</span><span class="v">' + m.swapMb + ' MB used</span></div>';
  }

  /* ===== STORAGE ===== */
  function renderStorage() {
    var n = S.state.nvme, sd = S.state.sandisk;
    var nPct = Math.round(n.usedGb / n.totalGb * 100), sPct = Math.round(sd.usedGb / sd.totalGb * 100);
    body('storage').innerHTML =
      head(IC.disk, 'STORAGE') +
      '<div class="sys-sub"><div class="st">NVMe ' + n.totalGb + ' GB ' + badge('bg-green', n.smart + ' · SMART') + '</div>' +
      bar(nPct) + '<div class="mono dim" style="font-size:.58rem;margin-top:5px">' + n.usedGb + ' GB / ' + n.totalGb + ' GB used</div>' +
      '<div class="sys-paths"><span>/home</span><span class="v">45 GB</span><span>Ollama models</span><span class="v">8 GB</span><span>PMTiles maps</span><span class="v">35 GB</span><span>Dashboard</span><span class="v">2 GB</span></div></div>' +
      '<div class="sys-sub"><div class="st">SanDisk 1TB USB ' + badge(sd.mounted ? 'bg-green' : 'bg-red', sd.mounted ? 'MOUNTED' : 'UNMOUNTED') + '</div>' +
      bar(sPct) + '<div class="mono dim" style="font-size:.58rem;margin-top:5px">' + sd.usedGb + ' GB / ' + sd.totalGb + ' GB used · write ' + sd.writeMb + ' MB/s</div></div>';
  }

  /* ===== NETWORK ===== */
  function renderNet() {
    var net = S.state.net;
    function iface(key, title, sub, rows) {
      var n = net[key];
      return '<div class="sys-if"><div class="ih"><span class="nm">' + title + '</span>' + badge(n.up ? 'bg-green' : 'bg-grey', n.up ? 'UP' : 'DOWN') + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div>' +
        '<div class="idata"><span class="up">↑ ' + n.tx.toFixed(1) + ' MB/s</span><span class="dn">↓ ' + n.rx.toFixed(1) + ' MB/s</span>' + rows + '</div>' +
        '<canvas class="sys-spark ispark" data-spark="net_' + key + '"></canvas></div>';
    }
    body('net').innerHTML =
      head(IC.net, 'NETWORK') +
      iface('wlan0', 'wlan0', '', '<span>Signal: ' + net.wlan0.sig + ' dBm</span>') +
      iface('wlan1', 'wlan1', 'ALFA AP · 192.168.4.1', '<span>Clients: ' + net.wlan1.clients + '</span>') +
      iface('wg0', 'wg0', 'WireGuard · 10.8.0.1', '<span>Peers: ' + net.wg0.peers + '/' + net.wg0.peersCfg + '</span>');
  }

  /* ===== SERVICES & CONNECTIONS ===== */
  function renderServices() {
    var svcs = S.state.services, c = S.state.conns;
    var col = svcs.map(function (s) {
      return '<div class="sys-svc"><span class="d ' + s.status + '"></span><span class="nm">' + s.name + '</span><span class="ut">' + s.uptime + '</span></div>';
    }).join('');
    var tak = c.tak.map(function (t) { return '<div class="sys-conn-row"><span class="ci">' + IC.dev + '</span><span class="nm">' + t.name + '</span><span class="rs">' + t.ip + '</span></div>'; }).join('');
    var sta = c.stations.map(function (s) { return '<div class="sys-conn-row"><span class="ci">' + IC.dev + '</span><span class="nm">' + s.ip + '</span><span class="rs">' + s.dbm + ' dBm</span></div>'; }).join('');
    body('services').innerHTML =
      head(IC.svc, 'SERVICES &amp; CONNECTIONS') +
      '<div class="sys-svc-grid"><div class="sys-svc-col"><div class="ct">SERVICES (' + svcs.filter(function (s) { return s.status === 'active'; }).length + '/' + svcs.length + ' ACTIVE)</div>' + col + '</div>' +
      '<div class="sys-svc-col"><div class="ct">CONNECTIONS</div>' +
      '<div class="sys-conn-block"><div class="bt">TAK clients: ' + c.tak.length + ' connected</div>' + tak + '</div>' +
      '<div class="sys-conn-block"><div class="bt">Mesh nodes heard (5m): ' + c.meshHeard + '</div></div>' +
      '<div class="sys-conn-block"><div class="bt">Hotspot stations: ' + c.stations.length + '</div>' + sta + '</div>' +
      '<div class="sys-conn-block"><div class="bt">VPN peers: ' + c.vpnActive + ' of ' + c.vpnCfg + ' active</div></div>' +
      '</div></div>';
  }

  /* ===== SPARKLINES ===== */
  function drawSparks() {
    sparkCanvas('cputemp', S.state.cpu.tempHist, 44, 82, true);
    ['wlan0', 'wlan1', 'wg0'].forEach(function (k) { sparkCanvas('net_' + k, S.state.net[k].hist, 0, 6, false); });
  }
  function sparkCanvas(key, arr, mn, mx, fill) {
    var cv = wrap.querySelector('canvas[data-spark="' + key + '"]'); if (!cv) return;
    var box = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!box.width) { return; }
    cv.width = box.width * dpr; cv.height = box.height * dpr;
    var x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    var w = box.width, h = box.height; x.clearRect(0, 0, w, h);
    if (arr.length < 2) return;
    x.strokeStyle = '#E8B54A'; x.lineWidth = 1.3; x.beginPath();
    arr.forEach(function (v, i) { var px = i / (arr.length - 1) * w, py = h - (clamp(v, mn, mx) - mn) / (mx - mn) * h; i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
    if (fill) { x.lineTo(w, h); x.lineTo(0, h); x.closePath(); x.fillStyle = 'rgba(232,181,74,0.08)'; x.fill(); }
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  window.addEventListener('resize', function () { if (refs && wrap && wrap.isConnected) drawSparks(); });

})(window.DBSys);
