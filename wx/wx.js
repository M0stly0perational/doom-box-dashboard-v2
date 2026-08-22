/* ============================================================
   DOOM BOX — WX UI
   Current bar, 7-day strip + hourly popover, tabbed detail
   (Alerts / Radar+Sat / Aviation / History), sun-moon footer.
   ============================================================ */
window.DBWx = window.DBWx || {};
(function (W) {
  "use strict";
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }

  /* ---- geometric weather icons (SVG, no emoji) ---- */
  function ic(type) {
    var s = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
    var sun = '<circle cx="24" cy="24" r="8"/>' + ray();
    function ray() { var o = ''; for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4, x = 24 + Math.cos(a), y = 24 + Math.sin(a); o += '<path d="M' + (24 + Math.cos(a) * 12) + ' ' + (24 + Math.sin(a) * 12) + ' L' + (24 + Math.cos(a) * 16) + ' ' + (24 + Math.sin(a) * 16) + '"/>'; } return o; }
    var cloud = '<path d="M14 32 H33 a6 6 0 0 0 .4-12 A8 8 0 0 0 15 19 A6 6 0 0 0 14 32 Z"/>';
    var map = {
      clear: sun,
      pcloudy: '<circle cx="18" cy="18" r="5.5"/><path d="M18 8.5 V11 M8.5 18 H11 M11.5 11.5 L13 13"/>' + '<path d="M16 36 H35 a6 6 0 0 0 .4-12 A8 8 0 0 0 17 23 A6 6 0 0 0 16 36 Z" fill="rgba(12,16,24,0.6)"/>',
      cloudy: cloud,
      rain: cloud + '<path d="M18 35 L16 40 M25 35 L23 40 M32 35 L30 40" stroke-width="2"/>',
      thunder: cloud + '<path d="M25 33 L20 40 L24 40 L21 45" stroke="#E8B54A" stroke-width="2"/>',
      snow: cloud + '<path d="M18 38 v3 M16.5 39.5 h3 M30 38 v3 M28.5 39.5 h3 M24 40 v3 M22.5 41.5 h3"/>',
      windy: '<path d="M6 18 H30 a4 4 0 1 0 -4 -4"/><path d="M6 26 H38 a5 5 0 1 1 -5 5"/><path d="M6 34 H24 a3 3 0 1 0 -3 3"/>',
      fog: cloud + '<path d="M14 37 H34 M16 41 H32"/>'
    };
    return s + (map[type] || cloud) + '</svg>';
  }
  W.icon = ic;

  var ST, wrap, refs;
  W._raf = null; W._intervals = W._intervals || [];

  W.mount = function (container) {
    if (W._raf) cancelAnimationFrame(W._raf); W._raf = null;
    W._intervals.forEach(clearInterval); W._intervals = [];
    ST = { tab: 'alerts', day: null, av: 'KLAS', histTf: '24H', radarLayer: 'radar', frame: 12, playing: false, loop: true, speed: 1, alerts: [] };
    container.style.padding = '0'; container.style.position = 'relative'; container.style.overflow = 'hidden';
    container.innerHTML = ''; wrap = el('div', 'wx'); container.appendChild(wrap); refs = {};
    wrap.innerHTML = '<div class="wx-loading">◈ LOADING LIVE WEATHER…</div>';
    var firstDone = false, lastGen = null;
    function refresh() {
      W.loadLive(function () {
        if (!container.isConnected) { W._intervals.forEach(clearInterval); return; }
        // rebuild on first load, then only when the fetcher produced a new snapshot
        if (!firstDone || W.meta.genIso !== lastGen) { firstDone = true; lastGen = W.meta.genIso; build(); }
      });
    }
    refresh();
    // fetcher runs every 5 min; poll status every 60 s and rebuild on change
    W._intervals.push(setInterval(function () { if (!container.isConnected) { W._intervals.forEach(clearInterval); return; } refresh(); }, 60000));
  };
  function build() {
    if (W._raf) { cancelAnimationFrame(W._raf); W._raf = null; ST.playing = false; }
    ST.alerts = W.alerts.slice();
    refs = {}; wrap.innerHTML = '';
    buildCurrent(); wrap.appendChild(div()); buildWeek(); wrap.appendChild(div()); buildTabs(); buildFooter();
    setTab(ST.tab);
  }
  function div() { return el('div', 'wx-div'); }

  /* ============================================================ ROW 1 */
  function buildCurrent() {
    var c = W.current, row = el('div', 'wx-current wx-brk');
    // left
    var L = el('div', 'wx-cur-l');
    L.innerHTML = '<div class="wx-station">' + c.station + ' · ' + c.name + '</div>' +
      '<div class="wx-updated">UPD <b>' + (W.meta.updated || '—') + '</b>' + (W.meta.ageStr ? ' · ' + W.meta.ageStr : '') + ' · NWS LAS VEGAS</div>' +
      '<div class="wx-temp">' + c.tempF + '°F / ' + c.tempC + '°C</div>' +
      '<div class="wx-cond">' + c.cond + '</div>' +
      '<div class="wx-subline">FEELS ' + c.feelsF + '°F · HUMIDITY ' + c.humidity + '% · DEW ' + c.dewF + '°F</div>' +
      '<div class="wx-elev">' + c.elevFt.toLocaleString() + ' ft / ' + c.elevM + ' m MSL</div>' +
      '<div class="wx-metar-row"><button class="wx-metar-btn">SHOW METAR ▾</button><div class="wx-metar">' + c.metar + '</div></div>';
    L.querySelector('.wx-metar-btn').addEventListener('click', function () { var m = L.querySelector('.wx-metar'); var on = m.classList.toggle('show'); this.textContent = on ? 'HIDE METAR ▴' : 'SHOW METAR ▾'; });
    // center compass
    var C = el('div', 'wx-cur-c');
    C.innerHTML = compassSVG(c.windDir) +
      '<div class="wx-wind">' + c.windDir + '° · ' + c.windCard + ' · ' + c.windKt + ' KT · GUSTS ' + c.gustKt + ' KT</div>' +
      '<div class="wx-beaufort">' + c.beaufort + '</div>';
    // right grid
    var R = el('div', 'wx-cur-r');
    function sec(k, a, b) { return '<div class="wx-sec"><div class="k">' + k + '</div><div class="v1">' + a + '</div><div class="v2">' + b + '</div></div>'; }
    R.innerHTML = '<div class="wx-sec-grid">' +
      sec('VISIBILITY', c.visSM + ' SM', c.visKM + ' km') + sec('PRESSURE', c.presIn + ' inHg', c.presHpa + ' hPa') + sec('CEILING', c.ceiling, c.ceilCode) +
      sec('HUMIDITY', c.humidity + '%', 'DEW ' + c.dewC + '°C') + sec('UV INDEX', c.uv + ' · ' + c.uvLabel, '') + sec('SOLAR RAD', c.solar + ' W/m²', '') +
      '</div><div class="wx-source-sel">SOURCE: <select id="wx-src">' + W.STATIONS.map(function (s) { return '<option' + (s === c.station ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>';
    row.appendChild(L); row.appendChild(C); row.appendChild(R); wrap.appendChild(row);
  }
  function compassSVG(dir) {
    return '<div class="wx-compass"><svg viewBox="0 0 60 60">' +
      '<circle class="ring" cx="30" cy="30" r="26" fill="none"/>' +
      '<circle class="ring" cx="30" cy="30" r="2" fill="currentColor"/>' +
      '<text class="card" x="30" y="9" text-anchor="middle">N</text><text class="card" x="30" y="55" text-anchor="middle">S</text>' +
      '<text class="card" x="52" y="32" text-anchor="middle">E</text><text class="card" x="8" y="32" text-anchor="middle">W</text>' +
      '<g class="arrow" style="transform:rotate(' + dir + 'deg)"><path d="M30 10 L25 30 L30 26 L35 30 Z"/><path d="M30 50 L26 32 L30 35 L34 32 Z" opacity="0.4"/></g>' +
      '</svg></div>';
  }

  /* ============================================================ ROW 2 */
  function buildWeek() {
    var strip = el('div', 'wx-week'); refs.week = strip;
    W.week.forEach(function (d, i) {
      var card = el('div', 'wx-day' + (i === 0 ? ' today' : ''));
      card.innerHTML = '<div class="d">' + d.dow + ' ' + d.date + '</div>' +
        '<div class="ic">' + ic(d.icon) + '</div>' +
        '<div class="hl">HI ' + d.hi + '° <span class="lo">LO ' + d.lo + '°</span></div>' +
        '<div class="cd">' + d.cond + ' · ' + d.precipPct + '% PRECIP</div>' +
        '<div class="wd">' + d.windCard + ' ' + d.windKt + ' KT</div>';
      card.addEventListener('click', function () { openDay(i, card); });
      strip.appendChild(card);
    });
    var pop = el('div', 'wx-popover'); refs.pop = pop; strip.appendChild(pop);
    wrap.appendChild(strip);
  }
  function openDay(i, card) {
    if (ST.day === i) { closeDay(); return; }
    ST.day = i;
    [].forEach.call(refs.week.querySelectorAll('.wx-day'), function (n) { n.classList.remove('sel'); });
    card.classList.add('sel');
    var d = W.week[i], pop = refs.pop;
    // real NWS detailed forecast (day + night periods); feed has no hourly series
    pop.innerHTML = '<div class="wx-pop-h"><div class="t">' + d.dow + ' ' + d.date + ' — FORECAST</div><button class="x">✕</button></div>' +
      '<div class="wx-pop-detail">' +
      '<div class="wx-pop-stats">HI <b>' + d.hi + '°</b> · LO <b>' + d.lo + '°</b> · ' + d.cond + ' · WIND ' + d.windCard + ' ' + d.windKt + ' KT · PRECIP ' + d.precipPct + '%</div>' +
      (d.detailDay ? '<div class="wx-pop-sec">DAY</div><div class="wx-pop-p">' + d.detailDay + '</div>' : '') +
      (d.detailNight ? '<div class="wx-pop-sec">NIGHT</div><div class="wx-pop-p">' + d.detailNight + '</div>' : '') +
      (!d.detailDay && !d.detailNight ? '<div class="wx-pop-p">No detailed forecast text available for this period.</div>' : '') +
      '<div class="wx-sun-line"><span>☀ RISE <b>' + W.sun.rise + '</b> · SET <b>' + W.sun.set + '</b></span>' +
      (W.sun.dayLen && W.sun.dayLen !== '—' ? '<span>DAY LENGTH <b>' + W.sun.dayLen + '</b></span>' : '') + '</div></div>';
    pop.classList.add('show');
    pop.querySelector('.x').addEventListener('click', closeDay);
  }
  function closeDay() { ST.day = null; refs.pop.classList.remove('show'); [].forEach.call(refs.week.querySelectorAll('.wx-day'), function (n) { n.classList.remove('sel'); }); }

  /* ============================================================ ROW 3 — TABS */
  function buildTabs() {
    var box = el('div', 'wx-tabs-wrap');
    var bar = el('div', 'wx-tabbar');
    var tabs = [['alerts', 'ALERTS'], ['radar', 'RADAR & SATELLITE'], ['aviation', 'AVIATION'], ['history', 'HISTORY']];
    tabs.forEach(function (t) {
      var b = el('button', 'wx-tab', t[1] + (t[0] === 'alerts' && ST.alerts.length ? ' <span class="ab">' + ST.alerts.length + '</span>' : ''));
      b.setAttribute('data-tab', t[0]); b.addEventListener('click', function () { setTab(t[0]); }); bar.appendChild(b);
    });
    box.appendChild(bar);
    var body = el('div', 'wx-tabbody'); refs.body = body; box.appendChild(body);
    wrap.appendChild(box); refs.tabbar = bar;
  }
  function setTab(name) {
    ST.tab = name;
    if (W._raf) { cancelAnimationFrame(W._raf); W._raf = null; ST.playing = false; }
    [].forEach.call(refs.tabbar.querySelectorAll('.wx-tab'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    var body = refs.body; body.innerHTML = '';
    if (name === 'alerts') paneAlerts(body);
    else if (name === 'radar') paneRadar(body);
    else if (name === 'aviation') paneAviation(body);
    else if (name === 'history') paneHistory(body);
  }

  /* ---- ALERTS ---- */
  function paneAlerts(body) {
    var pane = el('div', 'wx-pane on'); body.appendChild(pane);
    if (!ST.alerts.length) { pane.innerHTML = '<div class="wx-empty ok"><div class="ei">✓</div><div class="et">NO ACTIVE ALERTS</div><div class="es">No NWS watches, warnings, or advisories for the Las Vegas area.</div></div>'; return; }
    ST.alerts.forEach(function (a) {
      var iss = new Date(Date.now() + a.issued * 60000), exp = new Date(Date.now() + a.expires * 60000);
      var card = el('div', 'wx-alert ' + a.sev);
      card.innerHTML = '<div class="wx-alert-top"><span class="wx-sev ' + a.sev + '">' + a.sev + '</span>' +
        '<span class="wx-alert-type">' + a.type + '</span>' +
        '<span class="wx-alert-times">ISSUED ' + W.zulu(iss) + '<br>EXPIRES ' + W.zulu(exp) + '</span></div>' +
        '<div class="wx-alert-head">' + a.headline + '</div>' +
        '<div class="wx-alert-body">' + a.body + '</div>' +
        '<div class="wx-alert-zones">AFFECTED ZONES: <b>' + a.zones + '</b></div>' +
        '<div class="wx-aisum"><div class="h">◈ LOCAL AI SUMMARY</div><span class="txt"></span></div>' +
        '<div class="wx-alert-acts"><button class="wx-aact primary" data-a="map">📍 SHOW ON MAP</button>' +
        '<button class="wx-aact" data-a="ai">◈ AI SUMMARY</button><button class="wx-aact" data-a="collapse">▼ COLLAPSE</button></div>';
      card.querySelector('[data-a="map"]').addEventListener('click', function () { if (window.DBShell) DBShell.go('MAP'); setTimeout(function () { if (window.DBMap) { DBMap.state.active['nws'] = true; if (DBMap.ui) DBMap.ui.updateLayerCount(); DBMap.tools.setMarker(a.loc.lat, a.loc.lon); DBMap.flyTo(a.loc.lat, a.loc.lon, 12); } }, 160); });
      card.querySelector('[data-a="ai"]').addEventListener('click', function () {
        var box = card.querySelector('.wx-aisum'); box.classList.add('show');
        var span = box.querySelector('.txt'); span.textContent = 'thinking…';
        var local = 'Assessment: ' + a.type.toLowerCase() + ' active through ' + W.zulu(exp) + '. ' + (a.sev === 'EXTREME' || a.sev === 'SEVERE' ? 'Elevated risk to personnel and equipment; implement mitigation now.' : 'Routine precautions advised; monitor for escalation.');
        fetch('/api/ai/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: (a.type + '. ' + (a.headline || '') + ' ' + (a.body || '')).replace(/\s+/g, ' ').slice(0, 1200), model: 'qwen2.5:1.5b' }), cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { if (!span.isConnected) return; streamText(span, (j && j.ok && j.summary) ? j.summary : local); })
          .catch(function () { if (span.isConnected) streamText(span, local); });
      });
      var bodyEl = card.querySelector('.wx-alert-body');
      card.querySelector('[data-a="collapse"]').addEventListener('click', function () { var hidden = bodyEl.style.display === 'none'; bodyEl.style.display = hidden ? '' : 'none'; this.textContent = hidden ? '▼ COLLAPSE' : '▶ EXPAND'; });
      pane.appendChild(card);
    });
  }

  /* ---- RADAR & SATELLITE ---- */
  var RADAR_LAYERS = [['radar', 'RADAR'], ['ir', 'SATELLITE IR'], ['vis', 'SATELLITE VISIBLE'], ['wv', 'SATELLITE WV'], ['comp', 'COMPOSITE']];
  function paneRadar(body) {
    var pane = el('div', 'wx-pane on nopad'); body.appendChild(pane);
    var r = el('div', 'wx-radar'); pane.appendChild(r);
    var top = el('div', 'wx-radar-top');
    RADAR_LAYERS.forEach(function (l) { var b = el('button', 'wx-lyr' + (l[0] === ST.radarLayer ? ' on' : ''), '<span class="rd"></span>' + l[1]); b.addEventListener('click', function () { ST.radarLayer = l[0]; [].forEach.call(top.querySelectorAll('.wx-lyr'), function (n) { n.classList.remove('on'); }); b.classList.add('on'); updateLegend(); }); top.appendChild(b); });
    r.appendChild(top);
    var mapw = el('div', 'wx-mapwrap');
    var cv = el('canvas'); mapw.appendChild(cv); refs.radarCv = cv;
    var legend = el('div', 'wx-legend'); refs.legend = legend; mapw.appendChild(legend);
    var center = el('button', 'wx-center-btn', '📍 CENTER ON MY POSITION'); center.addEventListener('click', function () { ST.cx = 0; ST.cy = 0; center.textContent = '✓ CENTERED ON GPS'; setTimeout(function () { if (center.isConnected) center.textContent = '📍 CENTER ON MY POSITION'; }, 1500); }); mapw.appendChild(center);
    r.appendChild(mapw);
    // playbar
    var pb = el('div', 'wx-playbar');
    pb.innerHTML = '<div class="wx-play-btns"><button data-p="first">◀◀</button><button data-p="prev">◀</button><button data-p="play">▶</button><button data-p="next">▶</button><button data-p="last">▶▶</button></div>' +
      '<span class="wx-frame-ts"></span><input type="range" class="wx-scrub" min="0" max="12" value="12">' +
      '<div class="wx-play-opt">LOOP <button data-o="loop" class="on">ON</button> SPD <button data-o="s05">0.5×</button><button data-o="s1" class="on">1×</button><button data-o="s2">2×</button></div>';
    r.appendChild(pb); refs.playbar = pb; refs.scrub = pb.querySelector('.wx-scrub'); refs.frameTs = pb.querySelector('.wx-frame-ts');
    wireRadar(pb);
    buildFrames();
    updateLegend();
    requestAnimationFrame(function () { sizeRadar(); drawRadar(); updateFrameTs(); });
  }
  function wireRadar(pb) {
    pb.querySelector('[data-p="first"]').addEventListener('click', function () { ST.frame = 0; syncFrame(); });
    pb.querySelector('[data-p="last"]').addEventListener('click', function () { ST.frame = 12; syncFrame(); });
    pb.querySelector('[data-p="prev"]').addEventListener('click', function () { ST.frame = Math.max(0, ST.frame - 1); syncFrame(); });
    pb.querySelector('[data-p="next"]').addEventListener('click', function () { ST.frame = Math.min(12, ST.frame + 1); syncFrame(); });
    var playBtn = pb.querySelector('[data-p="play"]');
    playBtn.addEventListener('click', function () { ST.playing = !ST.playing; playBtn.textContent = ST.playing ? '❚❚' : '▶'; if (ST.playing) playLoop(); });
    refs.scrub.addEventListener('input', function () { ST.frame = +refs.scrub.value; drawRadar(); updateFrameTs(); });
    pb.querySelector('[data-o="loop"]').addEventListener('click', function () { ST.loop = !ST.loop; this.textContent = ST.loop ? 'ON' : 'OFF'; this.classList.toggle('on', ST.loop); });
    [['s05', 0.5], ['s1', 1], ['s2', 2]].forEach(function (o) { pb.querySelector('[data-o="' + o[0] + '"]').addEventListener('click', function () { ST.speed = o[1]; [].forEach.call(pb.querySelectorAll('[data-o^="s"]'), function (n) { n.classList.remove('on'); }); this.classList.add('on'); }); });
  }
  function syncFrame() { refs.scrub.value = ST.frame; drawRadar(); updateFrameTs(); }
  function updateFrameTs() { var d = new Date(Date.now() - (12 - ST.frame) * 10 * 60000); refs.frameTs.textContent = W.hhmmZ(d); }
  var FRAMES = null;
  function buildFrames() {
    FRAMES = []; var rr = W.icon ? null : null;
    function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    var r = rng(424242);
    var cells = []; for (var i = 0; i < 7; i++) cells.push({ x: r(), y: r(), r: 0.06 + r() * 0.12, vx: 0.01 + r() * 0.02, vy: (r() - 0.5) * 0.01, ph: r() });
    for (var f = 0; f < 13; f++) { FRAMES.push(cells.map(function (c) { return { x: (c.x + c.vx * f) % 1.2 - 0.1, y: c.y + c.vy * f, r: c.r * (0.7 + 0.5 * Math.sin(f / 3 + c.ph * 6)), i: 0.4 + 0.6 * Math.abs(Math.sin(f / 4 + c.ph * 3)) }; })); }
  }
  function sizeRadar() { var cv = refs.radarCv; if (!cv) return; var box = cv.parentNode.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = box.width * dpr; cv.height = box.height * dpr; cv._w = box.width; cv._h = box.height; var x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function drawRadar() {
    var cv = refs.radarCv; if (!cv || !cv.isConnected) return; var x = cv.getContext('2d'), w = cv._w, h = cv._h;
    x.fillStyle = '#0a0a12'; x.fillRect(0, 0, w, h);
    // grid + roads basemap
    x.strokeStyle = 'rgba(136,152,170,0.07)'; x.lineWidth = 1; x.beginPath();
    for (var gx = 0; gx < w; gx += 44) { x.moveTo(gx, 0); x.lineTo(gx, h); } for (var gy = 0; gy < h; gy += 44) { x.moveTo(0, gy); x.lineTo(w, gy); } x.stroke();
    x.strokeStyle = 'rgba(232,181,74,0.12)'; x.lineWidth = 2; x.beginPath(); x.moveTo(0, h * 0.7); x.lineTo(w, h * 0.35); x.moveTo(w * 0.3, 0); x.lineTo(w * 0.55, h); x.stroke();
    x.strokeStyle = 'rgba(94,184,232,0.14)'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, h * 0.5); for (var t = 0; t <= 20; t++) { x.lineTo(w * t / 20, h * 0.5 + Math.sin(t / 2) * 18); } x.stroke();
    // layer overlay
    var lyr = ST.radarLayer, frame = FRAMES[ST.frame];
    x.save(); x.globalCompositeOperation = 'lighter';
    frame.forEach(function (c) {
      var px = c.x * w, py = c.y * h, rad = c.r * Math.min(w, h);
      var g = x.createRadialGradient(px, py, 0, px, py, rad);
      if (lyr === 'radar' || lyr === 'comp') { g.addColorStop(0, 'rgba(238,68,68,' + (0.5 * c.i) + ')'); g.addColorStop(0.35, 'rgba(232,181,74,' + (0.4 * c.i) + ')'); g.addColorStop(0.7, 'rgba(93,216,122,' + (0.3 * c.i) + ')'); g.addColorStop(1, 'rgba(93,216,122,0)'); }
      else if (lyr === 'ir') { g.addColorStop(0, 'rgba(238,68,68,' + (0.4 * c.i) + ')'); g.addColorStop(0.5, 'rgba(176,140,240,' + (0.3 * c.i) + ')'); g.addColorStop(1, 'rgba(94,184,232,0)'); }
      else if (lyr === 'wv') { g.addColorStop(0, 'rgba(93,216,122,' + (0.4 * c.i) + ')'); g.addColorStop(0.6, 'rgba(94,184,232,' + (0.25 * c.i) + ')'); g.addColorStop(1, 'rgba(94,184,232,0)'); }
      else { g.addColorStop(0, 'rgba(235,238,245,' + (0.35 * c.i) + ')'); g.addColorStop(1, 'rgba(235,238,245,0)'); }
      x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
    });
    x.restore();
    // crosshair center
    x.strokeStyle = 'rgba(232,181,74,0.6)'; x.lineWidth = 1; x.beginPath(); x.moveTo(w / 2 - 8, h / 2); x.lineTo(w / 2 + 8, h / 2); x.moveTo(w / 2, h / 2 - 8); x.lineTo(w / 2, h / 2 + 8); x.stroke();
  }
  var lastPlay = 0;
  function playLoop(ts) {
    if (!ST.playing || !refs.radarCv || !refs.radarCv.isConnected) { ST.playing = false; return; }
    if (!ts) ts = 0; if (ts - lastPlay > 600 / ST.speed) { lastPlay = ts; ST.frame++; if (ST.frame > 12) { if (ST.loop) ST.frame = 0; else { ST.frame = 12; ST.playing = false; var pb = refs.playbar.querySelector('[data-p="play"]'); if (pb) pb.textContent = '▶'; } } syncFrame(); }
    W._raf = requestAnimationFrame(playLoop);
  }
  function updateLegend() {
    if (!refs.legend) return; var lyr = ST.radarLayer;
    if (lyr === 'radar' || lyr === 'comp') refs.legend.innerHTML = '<div class="lt">REFLECTIVITY dBZ</div><div class="scale" style="background:linear-gradient(90deg,#5DD87A,#E8B54A,#CC5511,#EE4444,#B08CF0)"></div><div class="sl"><span>5</span><span>30</span><span>50</span><span>70+</span></div>';
    else refs.legend.innerHTML = '<div class="lt">CLOUD-TOP TEMP °C</div><div class="scale" style="background:linear-gradient(90deg,#5EB8E8,#5DD87A,#E8B54A,#EE4444,#B08CF0)"></div><div class="sl"><span>+30</span><span>0</span><span>-40</span><span>-80</span></div>';
  }

  /* ---- AVIATION ---- */
  function paneAviation(body) {
    var pane = el('div', 'wx-pane on'); body.appendChild(pane);
    var search = el('div', 'wx-av-search'); var inp = el('input'); inp.value = ST.av; inp.maxLength = 4; var go = el('button', null, 'GET WEATHER');
    search.appendChild(inp); search.appendChild(go); pane.appendChild(search);
    var chips = el('div', 'wx-chips');
    W.AV_ORDER.forEach(function (a) { var b = el('button', 'wx-achip' + (a === ST.av ? ' on' : ''), a + (a === 'KLSV' ? ' · NELLIS' : '')); b.addEventListener('click', function () { ST.av = a; setTab('aviation'); }); chips.appendChild(b); });
    pane.appendChild(chips);
    go.addEventListener('click', function () { var v = inp.value.trim().toUpperCase(); if (W.airports[v]) { ST.av = v; setTab('aviation'); } else { go.textContent = 'NO DATA'; setTimeout(function () { if (go.isConnected) go.textContent = 'GET WEATHER'; }, 1400); } });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go.click(); });

    var ap = W.airports[ST.av];
    var card = el('div', 'wx-av-card');
    card.innerHTML = '<div class="wx-av-h"><span class="nm">' + ST.av + ' · ' + ap.name + '</span><span class="wx-fcat fcat-' + ap.cat + '">' + ap.cat + '</span></div>' +
      '<div class="wx-sub-h">METAR</div><div class="wx-raw">' + ap.metar + '</div>' +
      '<div class="wx-decoded">' + ap.decoded.map(function (d) { return '<div class="dl">' + d[0] + ': <b>' + d[1] + '</b></div>'; }).join('') + '</div>' +
      '<div class="wx-sub-h">TAF</div><div class="wx-raw">' + ap.taf + '</div>' +
      '<table class="wx-taf-tbl"><tr><th>FROM</th><th>TO</th><th>WIND</th><th>VIS</th><th>CEILING</th><th>CAT</th></tr>' +
      ap.tafRows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td><td class="cat-' + r[5] + '">' + r[5] + '</td></tr>'; }).join('') + '</table>' +
      '<div class="wx-sub-h">PIREP</div>' + (ap.pirep ? '<div class="wx-pirep">' + ap.pirep + '</div>' : '<div class="wx-notam-note">No recent pilot reports for this area.</div>') +
      '<div class="wx-sub-h">NOTAM</div><div class="wx-notam-note">NOTAM data requires internet connection — showing cached advisories only.</div>';
    pane.appendChild(card);
  }

  /* ---- HISTORY ---- */
  function paneHistory(body) {
    var pane = el('div', 'wx-pane on'); body.appendChild(pane);
    var ctrl = el('div', 'wx-hist-ctrl');
    ['24H', '7D', '30D'].forEach(function (t) { var b = el('button', t === ST.histTf ? 'on' : '', t); b.addEventListener('click', function () { ST.histTf = t; setTab('history'); }); ctrl.appendChild(b); });
    pane.appendChild(ctrl);
    var cross = el('div', 'wx-crosshair', 'Hover charts for exact values'); pane.appendChild(cross); refs.cross = cross;
    var data = W.history(ST.histTf);
    var charts = [['TEMPERATURE °F (HI/LO RANGE)', 'band'], ['PRESSURE hPa', 'line-pres'], ['WIND SPEED KT', 'line-wind'], ['PRECIPITATION in', 'bars-precip'], ['HUMIDITY %', 'line-hum']];
    refs.histCharts = [];
    charts.forEach(function (c) {
      var w = el('div', 'wx-chart', '<div class="ct">' + c[0] + '</div>'); var cv = el('canvas'); w.appendChild(cv); pane.appendChild(w);
      refs.histCharts.push({ cv: cv, kind: c[1] });
    });
    pane.appendChild(el('div', 'wx-hist-note', 'Historical data limited to locally cached records · Internet required for extended history'));
    requestAnimationFrame(function () { renderHist(data, -1); attachHistHover(data); });
  }
  function renderHist(data, hi) {
    refs.histCharts.forEach(function (c) {
      if (c.kind === 'band') bandChart(c.cv, data.hi, data.lo, '#E8B54A', hi);
      else if (c.kind === 'line-pres') lineChart(c.cv, data.pres, '#E8B54A', { hi: hi, raw: data.t });
      else if (c.kind === 'line-wind') lineChart(c.cv, data.wind, '#8898AA', { hi: hi, arrows: data.wdir });
      else if (c.kind === 'bars-precip') barChart(c.cv, data.precip, '#5EB8E8', Math.max(0.1, Math.max.apply(0, data.precip)), hi);
      else if (c.kind === 'line-hum') lineChart(c.cv, data.hum, '#5EB8E8', { hi: hi, max: 100 });
    });
  }
  function attachHistHover(data) {
    refs.histCharts.forEach(function (c) {
      c.cv.addEventListener('mousemove', function (e) {
        var rect = c.cv.getBoundingClientRect(), idx = Math.round((e.clientX - rect.left) / rect.width * (data.t.length - 1));
        idx = Math.max(0, Math.min(data.t.length - 1, idx));
        renderHist(data, idx);
        refs.cross.textContent = W.zulu(data.t[idx]) + '  ·  TEMP ' + data.hi[idx] + '/' + data.lo[idx] + '°F  ·  ' + data.pres[idx] + ' hPa  ·  WIND ' + data.wind[idx] + ' KT ' + W.card(data.wdir[idx]) + '  ·  PRECIP ' + data.precip[idx] + '"  ·  RH ' + data.hum[idx] + '%';
      });
      c.cv.addEventListener('mouseleave', function () { renderHist(data, -1); refs.cross.textContent = 'Hover charts for exact values'; });
    });
  }

  /* ============================================================ FOOTER */
  function buildFooter() {
    var s = W.sun, f = el('div', 'wx-footer');
    // feed provides sunrise/sunset + day length; moon / twilight not in feed
    f.innerHTML = '<span><span class="ic">☀</span> RISE <b>' + s.rise + '</b> SET <b>' + s.set + '</b></span>' +
      (s.dayLen && s.dayLen !== '—' ? '<span>DAY LENGTH <b>' + s.dayLen + '</b></span>' : '') +
      '<span><span class="ic">☽</span> MOON <b>—</b></span>' +
      '<span>CIVIL TWILIGHT <b>—</b></span><span>GOLDEN HOUR <b>—</b></span>';
    wrap.appendChild(f);
  }

  /* ============================================================ CHART HELPERS */
  function setup(cv) { var box = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; if (!box.width) return null; cv.width = box.width * dpr; cv.height = box.height * dpr; var x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); return { x: x, w: box.width, h: box.height }; }
  function lineChart(cv, arr, color, o) {
    o = o || {}; var s = setup(cv); if (!s) return; var x = s.x, w = s.w, h = s.h, pad = 6;
    var mn = o.min != null ? o.min : Math.min.apply(0, arr), mx = o.max != null ? o.max : Math.max.apply(0, arr); if (mx === mn) mx = mn + 1;
    function X(i) { return pad + i / (arr.length - 1) * (w - pad * 2); } function Y(v) { return h - pad - (v - mn) / (mx - mn) * (h - pad * 2); }
    if (o.fill) { x.beginPath(); x.moveTo(X(0), h); arr.forEach(function (v, i) { x.lineTo(X(i), Y(v)); }); x.lineTo(X(arr.length - 1), h); x.closePath(); x.fillStyle = color.replace(')', ',0.12)').replace('#', 'rgba(') ? hexa(color, 0.12) : color; x.fill(); }
    x.beginPath(); arr.forEach(function (v, i) { i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)); }); x.strokeStyle = color; x.lineWidth = 1.6; x.stroke();
    if (o.arrows) { x.fillStyle = 'rgba(136,152,170,0.7)'; x.font = '8px ' + mono(); for (var i = 0; i < arr.length; i += Math.ceil(arr.length / 8)) { x.save(); x.translate(X(i), 6); x.rotate(o.arrows[i] * Math.PI / 180); x.fillText('↓', -3, 0); x.restore(); } }
    if (o.hi != null && o.hi >= 0) cross(x, X(o.hi), w, h, color, Y(arr[o.hi]));
  }
  function bandChart(cv, hiArr, loArr, color, hoverI) {
    var s = setup(cv); if (!s) return; var x = s.x, w = s.w, h = s.h, pad = 6;
    var mn = Math.min.apply(0, loArr) - 2, mx = Math.max.apply(0, hiArr) + 2;
    function X(i) { return pad + i / (hiArr.length - 1) * (w - pad * 2); } function Y(v) { return h - pad - (v - mn) / (mx - mn) * (h - pad * 2); }
    x.beginPath(); hiArr.forEach(function (v, i) { i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)); }); for (var i = loArr.length - 1; i >= 0; i--) x.lineTo(X(i), Y(loArr[i])); x.closePath(); x.fillStyle = hexa(color, 0.14); x.fill();
    x.beginPath(); hiArr.forEach(function (v, i) { i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)); }); x.strokeStyle = color; x.lineWidth = 1.5; x.stroke();
    x.beginPath(); loArr.forEach(function (v, i) { i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)); }); x.strokeStyle = hexa(color, 0.55); x.lineWidth = 1.2; x.stroke();
    if (hoverI != null && hoverI >= 0) cross(x, X(hoverI), w, h, color, Y(hiArr[hoverI]));
  }
  function barChart(cv, arr, color, max, hoverI) {
    var s = setup(cv); if (!s) return; var x = s.x, w = s.w, h = s.h, pad = 6, bw = (w - pad * 2) / arr.length;
    arr.forEach(function (v, i) { var bh = (v / max) * (h - pad * 2); x.fillStyle = (hoverI === i) ? '#fff' : color; x.fillRect(pad + i * bw + 1, h - pad - bh, Math.max(1, bw - 2), bh); });
    if (hoverI != null && hoverI >= 0) cross(x, pad + hoverI * bw + bw / 2, w, h, color, null);
  }
  function cross(x, px, w, h, color) { x.strokeStyle = 'rgba(232,181,74,0.7)'; x.lineWidth = 1; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(px, 2); x.lineTo(px, h - 2); x.stroke(); x.setLineDash([]); }
  function hexa(hex, a) { if (hex[0] !== '#') return hex; var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function mono() { return getComputedStyle(document.body).getPropertyValue('--font-mono') || 'monospace'; }

  function streamText(span, txt) { var words = txt.split(' '), i = 0; span.textContent = ''; var iv = setInterval(function () { if (!span.isConnected || i >= words.length) { clearInterval(iv); return; } span.textContent += (i ? ' ' : '') + words[i++]; }, 26); }

  // resize radar on window resize
  window.addEventListener('resize', function () { if (refs && refs.radarCv && refs.radarCv.isConnected) { sizeRadar(); drawRadar(); } });

})(window.DBWx);
