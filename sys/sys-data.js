/* ============================================================
   DOOM BOX — SYS DATA  (REAL INTEGRATION, 2026-06-03)
   Live data from Node-RED endpoints, mapped into the exact
   S.state shape that sys.js renders. Replaces the mock.

   Endpoints:
     GET /api/system          (5 s cadence — temp, cpu, mem, disk, net, services, tak, hotspot, mesh)
     GET /api/battery         (5 s cadence — SW2106 fuel gauge)
     GET /api/gps             (~30 s cadence — independent USB u-blox GPS via gpsd, since 2026-07-12)

   Contract preserved for sys.js:
     S.state, S.build(), S.poll() -> warns[], and helpers
     S.zulu/spread/spreadClass/pack/power/runtime/fmtUptime/tempClass.

   On every successful refresh a 'db:sysdata' window event fires so
   sys.js repaints immediately (first paint ~100 ms after mount,
   not after the 5 s tick).

   Fields with no existing endpoint are shown best-effort and noted
   in CLAUDE.md: cpu.freq (static 2.4 GHz), nvme SMART (N/A),
   sandisk write rate (—), wlan0 signal (—), wg peer counts (—),
   mesh "5m heard" uses total node_count.
   ============================================================ */
window.DBSys = window.DBSys || {};
(function (S) {
  "use strict";

  var BASE = { lat: 36.17, lon: -115.14 }; // Las Vegas fallback when no GPS fix
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  S.zulu = function () { var d = new Date(); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + 'Z'; };

  /* ---------------- helpers used by sys.js render ---------------- */
  S.spread = function (cells) { return Math.max.apply(null, cells) - Math.min.apply(null, cells); };
  S.spreadClass = function (mv) { return mv < 100 ? 'green' : mv <= 200 ? 'amber' : 'red'; };
  // Prefer real chip values stashed on the battery object; fall back to derived.
  S.pack = function (b) { return num(b.packV, b.cells.reduce(function (a, c) { return a + c; }, 0) / 1000); };
  S.power = function (b) { return num(b.powerW != null ? Math.abs(b.powerW) : null, Math.abs(S.pack(b) * b.currentMa / 1000)); };
  S.runtime = function (b) {
    if (b.currentMa >= 0) return '—';                 // charging / idle: no discharge runtime
    var rt = b.runtimeMin;
    if (rt == null || rt >= 65535 || rt <= 0) return '—';
    return Math.floor(rt / 60) + 'h ' + pad(rt % 60) + 'm';
  };
  S.fmtUptime = function (min) {
    var d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
    return d + 'd ' + pad(h) + 'h ' + pad(m) + 'm';
  };
  S.tempClass = function (t) { return t < 60 ? 'green' : t <= 70 ? 'amber' : 'red'; };
  S.SVC_ICON = true;

  /* ---------------- default skeleton so render never crashes ---------------- */
  function skeleton() {
    function emptyHist() { var a = []; for (var i = 0; i < 30; i++) a.push(0); return a; }
    return {
      battery: { pct: 0, state: 'IDLE', cells: [0, 0, 0, 0], currentMa: 0, vbusV: 0, vbusMa: 0, packV: 0, powerW: 0, runtimeMin: null },
      gps: { fix: 'NO FIX', sats: 0, used: 0, alt: 0, acc: 0, updatedSec: 0, lat: BASE.lat, lon: BASE.lon },
      cpu: { cores: [0, 0, 0, 0], temp: 0, freq: 2.4, tempHist: [], uptimeMin: 0 },
      mem: { usedGb: 0, totalGb: 8, cachedGb: 0, swapMb: 0 },
      nvme: { usedGb: 0, totalGb: 235, smart: 'N/A' },
      sandisk: { usedGb: 0, totalGb: 932, mounted: false, writeMb: 0 },
      net: {
        wlan0: { up: false, ip: '', sig: '—', tx: 0, rx: 0, hist: emptyHist() },
        wlan1: { up: false, ip: '192.168.4.1', clients: 0, tx: 0, rx: 0, hist: emptyHist() },
        wg0: { up: false, ip: '10.8.0.1', peers: '—', peersCfg: '—', tx: 0, rx: 0, hist: emptyHist() }
      },
      services: [],
      conns: { tak: [], meshHeard: 0, stations: [], vpnActive: '—', vpnCfg: '—' }
    };
  }

  S.state = null;
  S._prev = { temp: 0, memPct: 0 };
  S._busy = false;
  S._lastPos = 0;

  S.build = function () {
    if (!S.state) S.state = skeleton();
    refresh(true);
    return S.state;
  };

  // sys.js calls poll() every 5 s, then renderAll(). We kick an async refresh
  // (updates state for the imminent 'db:sysdata' repaint) and return warns
  // computed from the current/last-known state synchronously.
  S.poll = function () {
    refresh(false);
    return warns();
  };

  function warns() {
    var w = [], st = S.state;
    var memPct = st.mem.totalGb ? (st.mem.usedGb / st.mem.totalGb * 100) : 0;
    if (st.cpu.temp > 70 && S._prev.temp <= 70) w.push('cpu');
    if (memPct > 85 && S._prev.memPct <= 85) w.push('mem');
    S._prev.temp = st.cpu.temp; S._prev.memPct = memPct;
    return w;
  }

  /* ---------------- fetch + map ---------------- */
  function getJSON(url) {
    return fetch(url, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }

  function refresh(force) {
    if (S._busy) return;
    S._busy = true;
    var now = Date.now();
    var jobs = [
      getJSON('/api/system').then(mapSystem).catch(noop),
      getJSON('/api/battery').then(mapBattery).catch(noop)
    ];
    if (force || (now - S._lastPos) > 25000) {
      S._lastPos = now;
      jobs.push(getJSON('/api/gps').then(mapPosition).catch(noop));
    }
    Promise.all(jobs).then(function () {
      S._busy = false;
      try { window.dispatchEvent(new CustomEvent('db:sysdata')); } catch (e) {}
    });
  }
  function noop() {}

  function mapBattery(d) {
    if (!d || d.ok === false) return;
    var b = S.state.battery;
    b.cells = Array.isArray(d.cells_mv) && d.cells_mv.length ? d.cells_mv.slice(0, 4) : b.cells;
    b.pct = num(d.percent, b.pct);
    b.currentMa = num(d.current_ma, 0);
    b.state = stateLabel(d.state, d.charging, b.currentMa);
    b.packV = num(d.voltage, null);
    b.powerW = num(d.power_w, null);
    b.runtimeMin = num(d.runtime_min, null);
    if (d.vbus) { b.vbusV = num(d.vbus.voltage, 0); b.vbusMa = num(d.vbus.current_ma, 0); }
  }
  function stateLabel(s, charging, ma) {
    switch (String(s || '').toLowerCase()) {
      case 'charge': return 'CHARGING';
      case 'fast_charge': return 'FAST CHARGE';
      case 'discharge': return 'DISCHARGING';
      case 'idle': return 'IDLE';
    }
    if (charging) return 'CHARGING';
    return ma < 0 ? 'DISCHARGING' : 'IDLE';
  }

  function mapPosition(d) {
    if (!d) return;
    var g = S.state.gps;
    if (d.fix && typeof d.lat === 'number' && typeof d.lon === 'number') {
      g.fix = 'FIX'; g.lat = d.lat; g.lon = d.lon;
      g.alt = Math.round(num(d.alt_m, 0));
      g.acc = num(d.accuracy_m, 0);
      g.sats = num(d.sats, 0); g.used = g.sats;
    } else {
      g.fix = 'NO FIX';
      g.lat = BASE.lat; g.lon = BASE.lon;   // MGRS readout falls back to map center
      g.alt = 0; g.acc = 0; g.sats = num(d.sats, 0); g.used = g.sats;
    }
    g.updatedSec = clamp(Math.round(num(d.age_s, 0)), 0, 59);
  }

  function mapSystem(d) {
    if (!d || d.ok === false) return;
    var st = S.state;

    // CPU
    if (Array.isArray(d.cpu_pct)) st.cpu.cores = d.cpu_pct.map(function (x) { return Math.round(num(x, 0)); });
    st.cpu.temp = Math.round(num(d.temp_c, st.cpu.temp));
    if (Array.isArray(d.temp_history)) st.cpu.tempHist = d.temp_history.map(function (x) { return num(x && x.c, 0); }).slice(-60);
    st.cpu.uptimeMin = Math.floor(num(d.uptime_s, 0) / 60);
    // freq not exposed by /api/system — Pi 5 Cortex-A76 nominal
    st.cpu.freq = 2.4;

    // Memory (MB -> GB, GiB-style /1024)
    if (d.mem) {
      st.mem.totalGb = num(d.mem.total_mb, 8192) / 1024;
      st.mem.usedGb = num(d.mem.used_mb, 0) / 1024;
      st.mem.cachedGb = num(d.mem.cached_mb, 0) / 1024;
      st.mem.swapMb = Math.round(num(d.mem.swap_used_mb, 0));
    }

    // Storage (bytes -> GiB so totals read ~235 / ~932, matching df + hardware)
    var GiB = 1073741824;
    if (d.disk) {
      if (d.disk.root) {
        st.nvme.usedGb = Math.round(num(d.disk.root.used_b, 0) / GiB);
        st.nvme.totalGb = Math.round(num(d.disk.root.total_b, 0) / GiB);
      }
      if (d.disk.sandisk) {
        st.sandisk.usedGb = Math.round(num(d.disk.sandisk.used_b, 0) / GiB);
        st.sandisk.totalGb = Math.round(num(d.disk.sandisk.total_b, 0) / GiB);
        st.sandisk.mounted = true;
      } else {
        st.sandisk.mounted = false;
      }
    }

    // Network (bytes/s -> MB/s)
    if (d.net) {
      mapIf('wlan0', d.net.wlan0);
      mapIf('wlan1', d.net.wlan1);
      mapIf('wg0', d.net.wg0);
      if (d.hotspot) st.net.wlan1.clients = num(d.hotspot.count, 0);
    }

    // Services -> [{name,status,uptime}]
    if (d.services) {
      st.services = Object.keys(d.services).map(function (name) {
        var v = d.services[name] || {};
        return { name: name, status: svcStatus(v.state), uptime: svcUptime(v.uptime_s) };
      });
    }

    // Connections
    var c = st.conns;
    if (d.tak) c.tak = (d.tak.remote_ips || []).map(function (ip) { return { name: 'TAK client', ip: ip }; });
    if (d.hotspot) c.stations = (d.hotspot.stations || []).map(function (s) { return { ip: s.ip || s.mac || '?', dbm: num(s.signal_dbm, 0) }; });
    if (d.mesh) c.meshHeard = num(d.mesh.node_count, 0);  // total known nodes (no 5m-heard counter available)
  }

  function mapIf(key, src) {
    var n = S.state.net[key];
    if (!src) { n.up = false; return; }
    n.up = true;
    n.tx = clamp(num(src.tx_bps, 0) / 1e6, 0, 999);
    n.rx = clamp(num(src.rx_bps, 0) / 1e6, 0, 999);
    n.hist.push((n.tx + n.rx) / 2); if (n.hist.length > 30) n.hist.shift();
  }

  function svcStatus(state) {
    switch (String(state || '').toLowerCase()) {
      case 'active': return 'active';
      case 'activating':
      case 'deactivating':
      case 'reloading': return 'activating';
      case 'failed': return 'failed';
      default: return 'failed';   // inactive/dead — only styled classes are active/activating/failed
    }
  }
  function svcUptime(s) {
    s = num(s, 0);
    if (s <= 0) return '00d 00h';
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
    return pad(d) + 'd ' + pad(h) + 'h';
  }

})(window.DBSys);
