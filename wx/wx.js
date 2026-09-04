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
  W._intervals = W._intervals || [];

  W.mount = function (container) {
    W._intervals.forEach(clearInterval); W._intervals = [];
    ST = { tab: 'alerts', day: null, alerts: [] };
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

  /* ---- RADAR / AVIATION / HISTORY ----
     No live backing endpoint for any of these — previously rendered
     fabricated radar frames, METAR/TAF/PIREP text, and history charts.
     That fake data was reachable in the UI; removed rather than left
     to masquerade as real readings. */
  function paneUnavailable(body, title, detail) {
    var pane = el('div', 'wx-pane on'); body.appendChild(pane);
    pane.innerHTML = '<div class="wx-empty"><div class="ei">—</div><div class="et">' + title + '</div><div class="es">' + detail + '</div></div>';
  }
  function paneRadar(body) { paneUnavailable(body, 'NO LIVE DATA SOURCE', 'Radar and satellite imagery have no backing feed wired up yet.'); }
  function paneAviation(body) { paneUnavailable(body, 'NO LIVE DATA SOURCE', 'Aviation weather (METAR/TAF/PIREP) has no backing feed wired up yet.'); }
  function paneHistory(body) { paneUnavailable(body, 'NO LIVE DATA SOURCE', 'Historical trend charts have no backing feed wired up yet.'); }

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

  function streamText(span, txt) { var words = txt.split(' '), i = 0; span.textContent = ''; var iv = setInterval(function () { if (!span.isConnected || i >= words.length) { clearInterval(iv); return; } span.textContent += (i ? ' ' : '') + words[i++]; }, 26); }

})(window.DBWx);
