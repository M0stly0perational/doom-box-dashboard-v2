/* ============================================================
   DOOM BOX — WX DATA (LIVE, 2026-06-06)
   Real weather from the NWS-driven fetcher:
     GET /api/wx/state   current · forecast(14 periods) · alerts · sun
     GET /api/wx/status   per-category fetch status + generated_at
   Populates W.current / W.week / W.alerts / W.sun / W.meta and calls
   the render layer's rebuild hook.
   Radar / Aviation / History tabs keep their synthetic data — no real
   endpoint backs them (out of scope; left as-is).
   Attaches to window.DBWx.
   ============================================================ */
window.DBWx = window.DBWx || {};
(function (W) {
  "use strict";

  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function p2(n) { n = String(Math.floor(n)); return n.length < 2 ? '0' + n : n; }
  function p3(n) { n = String(Math.floor(n)); while (n.length < 3) n = '0' + n; return n; }
  W.zulu = function (d) { return '[' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()) + 'Z]'; };
  W.hhmmZ = function (d) { return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + 'Z'; };

  var DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var CARDS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  W.card = function (deg) { return CARDS[Math.round(deg / 22.5) % 16]; };

  W.STATIONS = ['KLAS', 'KVGT', 'KHND'];
  // static station facts (the obs feed carries no station name / elevation)
  var STATION_META = {
    KLAS: { name: 'LAS VEGAS INTL', elevFt: 2181, elevM: 665 },
    KVGT: { name: 'NORTH LAS VEGAS', elevFt: 2205, elevM: 672 },
    KHND: { name: 'HENDERSON EXEC', elevFt: 2492, elevM: 760 },
    KLSV: { name: 'NELLIS AFB', elevFt: 1870, elevM: 570 }
  };

  /* ---- loading-state defaults (replaced by the first live fetch) ---- */
  W.current = { station: 'KLAS', name: 'LAS VEGAS INTL', tempF: '—', tempC: '—', cond: 'LOADING…', feelsF: '—', humidity: '—', dewC: '—', dewF: '—', elevFt: 2181, elevM: 665, metar: '—', windDir: 0, windCard: '—', windKt: '—', gustKt: '—', beaufort: '—', visSM: '—', visKM: '—', presIn: '—', presHpa: '—', ceiling: '—', ceilCode: '—', uv: '—', uvLabel: '', solar: '—' };
  W.week = [];
  W.alerts = [];
  W.sun = { rise: '—', set: '—', moonRise: '—', moonSet: '—', civil: '—', golden: '—', phase: '—', illum: '—', dayLen: '—' };
  W.meta = { updated: null, ageStr: '', genIso: null, status: null };

  /* ============================================================ MAPPERS */

  // NWS icon_key vocabulary → the render layer's icon set
  W.mapIcon = function (key) {
    switch (String(key || '')) {
      case 'clear': case 'clear-night': case 'hot': return 'clear';
      case 'partly-cloudy': case 'partly-cloudy-night': return 'pcloudy';
      case 'cloudy': case 'cold': return 'cloudy';
      case 'rain': return 'rain';
      case 'snow': return 'snow';
      case 'thunderstorm': return 'thunder';
      case 'fog': return 'fog';
      case 'wind': return 'windy';
      default: return 'cloudy';
    }
  };
  function cardToDeg(card) { var i = CARDS.indexOf(String(card || '').toUpperCase()); return i < 0 ? 0 : i * 22.5; }
  // NWS wind strings: "8 to 20 mph", "20 mph", "Calm" → max kt
  function parseWindKt(s) {
    var nums = String(s || '').match(/\d+/g); if (!nums) return 0;
    var mph = Math.max.apply(null, nums.map(Number));
    return Math.round(mph * 0.868976);
  }
  function mphToKt(mph) { return mph == null ? null : Math.round(mph * 0.868976); }
  function beaufort(kt) {
    if (kt == null || kt === '—') return '—';
    var b = [[1, 'CALM'], [4, 'LIGHT AIR'], [7, 'LIGHT BREEZE'], [11, 'GENTLE BREEZE'], [17, 'MODERATE BREEZE'], [22, 'FRESH BREEZE'], [28, 'STRONG BREEZE'], [34, 'NEAR GALE'], [41, 'GALE'], [48, 'STRONG GALE'], [56, 'STORM'], [64, 'VIOLENT STORM']];
    for (var i = 0; i < b.length; i++) if (kt < b[i][0]) return b[i][1];
    return 'HURRICANE FORCE';
  }
  function ddhhmmZ(iso) { var d = new Date(iso); return p2(d.getUTCDate()) + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + 'Z'; }
  function fmtTT(c) { if (c == null) return '//'; var v = Math.round(c); return (v < 0 ? 'M' : '') + p2(Math.abs(v)); }
  function skyCode(iconKey) {
    var i = W.mapIcon(iconKey);
    return ({ clear: 'CLR', pcloudy: 'FEW', cloudy: 'BKN', rain: 'OVC', thunder: 'OVC', snow: 'OVC', fog: 'FG', windy: 'CLR' })[i] || 'CLR';
  }
  // reconstruct a METAR-style line from the real obs (feed carries no raw METAR)
  function reconstructMetar(c) {
    var dir = c.wind_dir_deg != null ? p3(Math.round(c.wind_dir_deg)) : 'VRB';
    var kt = mphToKt(c.wind_mph);
    var spd = kt != null ? p2(kt) : '//';
    var gust = mphToKt(c.wind_gust_mph); var gstr = gust ? 'G' + p2(gust) : '';
    var vis = c.visibility_mi != null ? Math.round(c.visibility_mi) + 'SM' : '////';
    var sky = skyCode(c.icon_key);
    var tt = fmtTT(c.temp_c) + '/' + fmtTT(c.dewpoint_c);
    var alt = c.pressure_inhg != null ? ' A' + Math.round(c.pressure_inhg * 100) : '';
    var when = c.ts ? ddhhmmZ(c.ts) : '------Z';
    return (c.station || 'K---') + ' ' + when + ' ' + dir + spd + gstr + 'KT ' + vis + ' ' + sky + ' ' + tt + alt;
  }

  function buildCurrent(c) {
    if (!c) return W.current;
    var st = c.station || 'KLAS', meta = STATION_META[st] || { name: st, elevFt: 0, elevM: 0 };
    var kt = mphToKt(c.wind_mph), gust = mphToKt(c.wind_gust_mph);
    var clear = /clear|fair|sunny/i.test(c.text || '') || W.mapIcon(c.icon_key) === 'clear';
    return {
      station: st, name: meta.name,
      tempF: c.temp_f != null ? Math.round(c.temp_f) : '—', tempC: c.temp_c != null ? Math.round(c.temp_c) : '—',
      cond: (c.text || '—').toUpperCase(),
      feelsF: c.feels_like_f != null ? Math.round(c.feels_like_f) : '—',
      humidity: c.humidity_pct != null ? Math.round(c.humidity_pct) : '—',
      dewC: c.dewpoint_c != null ? Math.round(c.dewpoint_c) : '—', dewF: c.dewpoint_f != null ? Math.round(c.dewpoint_f) : '—',
      elevFt: meta.elevFt, elevM: meta.elevM,
      metar: reconstructMetar(c),
      windDir: c.wind_dir_deg != null ? c.wind_dir_deg : 0, windCard: c.wind_dir_cardinal || (c.wind_dir_deg != null ? W.card(c.wind_dir_deg) : '—'),
      windKt: kt != null ? kt : '—', gustKt: gust != null ? gust : '—', beaufort: beaufort(kt),
      visSM: c.visibility_mi != null ? Math.round(c.visibility_mi) : '—', visKM: c.visibility_m != null ? Math.round(c.visibility_m / 1000) : '—',
      presIn: c.pressure_inhg != null ? c.pressure_inhg.toFixed(2) : '—', presHpa: c.pressure_pa != null ? Math.round(c.pressure_pa / 100) : '—',
      ceiling: clear ? 'UNLIMITED' : '—', ceilCode: clear ? 'CLR' : skyCode(c.icon_key),
      uv: '—', uvLabel: '', solar: '—'   // not in feed
    };
  }

  // fold the 14 day/night periods into <=7 day cards
  function buildWeek(forecast) {
    var periods = (forecast && forecast.periods) || [];
    var byKey = {}, order = [];
    periods.forEach(function (p) {
      var key = String(p.start || '').slice(0, 10); if (!key) return;
      var b = byKey[key];
      if (!b) { b = byKey[key] = { key: key, hi: null, lo: null, icon: null, cond: null, precipPct: 0, windKt: null, windCard: null, windDir: 0, detailDay: null, detailNight: null }; order.push(key); }
      var setLook = function () { b.icon = W.mapIcon(p.icon_key); b.cond = (p.short || '').toUpperCase(); b.precipPct = p.precip_pct || 0; b.windKt = parseWindKt(p.wind); b.windCard = p.wind_dir || '—'; b.windDir = cardToDeg(p.wind_dir); };
      if (p.is_daytime) { b.hi = p.temp; b.detailDay = p.detailed; setLook(); }
      else { b.lo = p.temp; b.detailNight = p.detailed; if (b.icon == null) setLook(); }
    });
    return order.slice(0, 7).map(function (key) {
      var b = byKey[key], parts = key.split('-');
      var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));   // tz-stable calendar label
      return {
        dow: DOW[d.getUTCDay()], date: p2(+parts[2]) + ' ' + MON[+parts[1] - 1],
        icon: b.icon || 'cloudy', cond: b.cond || '—',
        hi: b.hi != null ? b.hi : (b.lo != null ? b.lo : '—'),
        lo: b.lo != null ? b.lo : (b.hi != null ? b.hi : '—'),
        precipPct: b.precipPct, windDir: b.windDir, windCard: b.windCard, windKt: b.windKt != null ? b.windKt : '—',
        detailDay: b.detailDay, detailNight: b.detailNight
      };
    });
  }

  function buildAlerts(state) {
    var active = (state.alerts && state.alerts.active) || [];
    var now = Date.now();
    return active.map(function (a) {
      var sev = String(a.severity || 'Unknown').toUpperCase();
      if (['EXTREME', 'SEVERE', 'MODERATE', 'MINOR'].indexOf(sev) < 0) sev = 'ADVISORY';   // Unknown → grey
      var eff = a.effective || a.onset || a.sent;
      var exp = a.ends || a.expires;
      var zones = (a.areas && String(a.areas).toUpperCase().replace(/\s*;\s*/g, ' · ')) ||
        (a.zones && a.zones.length ? a.zones.join(' · ') : 'LAS VEGAS AREA');
      return {
        sev: sev, type: (a.event || 'WEATHER ALERT').toUpperCase(),
        issued: eff ? (Date.parse(eff) - now) / 60000 : 0,
        expires: exp ? (Date.parse(exp) - now) / 60000 : 60,
        headline: a.headline || a.event || '',
        body: (a.description || '') + (a.instruction ? '\n\nINSTRUCTION: ' + a.instruction : ''),
        zones: zones,
        loc: { lat: 36.17, lon: -115.14 }   // Vegas centroid (feed alerts are zone-based, geometry often null)
      };
    });
  }

  function buildSun(state) {
    var s = state.sun || {};
    var rise = s.sunrise_utc ? W.hhmmZ(new Date(s.sunrise_utc)) : '—';
    var set = s.sunset_utc ? W.hhmmZ(new Date(s.sunset_utc)) : '—';
    return {
      rise: rise, set: set,
      moonRise: '—', moonSet: '—', civil: '—', golden: '—', phase: '—', illum: '—',
      dayLen: s.day_length_hours != null ? s.day_length_hours.toFixed(1) + ' h' : '—'
    };
  }

  W.applyState = function (state, status) {
    if (state) {
      W.current = buildCurrent(state.current);
      W.week = buildWeek(state.forecast);
      W.alerts = buildAlerts(state);
      W.sun = buildSun(state);
    }
    var gen = (status && status.generated_at) || (state && state.generated_at) || null;
    W.meta.genIso = gen;
    if (gen) {
      var d = new Date(gen);
      W.meta.updated = W.zulu(d);
      var ageMin = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
      W.meta.ageStr = ageMin < 1 ? 'just now' : ageMin + ' min ago';
    }
    W.meta.status = status && status.categories ? status.categories : null;
  };

  // fetch both endpoints, map, invoke cb(ok). Never throws.
  W.loadLive = function (cb) {
    Promise.all([
      fetch('/api/wx/state', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/api/wx/status', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var ok = !!res[0];
      W.applyState(res[0], res[1]);
      if (cb) cb(ok);
    });
  };

  /* ============================================================ MOCK SUB-TABS
     Radar / Aviation / History have no live backing endpoint. Their synthetic
     data is preserved so those tabs keep rendering (out of this task's scope). */

  W.history = function (tf) {
    var n = tf === '24H' ? 24 : tf === '7D' ? 7 * 8 : 30, r = rng(tf === '24H' ? 11 : tf === '7D' ? 22 : 33);
    var stepH = tf === '24H' ? 1 : tf === '7D' ? 3 : 24;
    var t = [], hi = [], lo = [], pres = [], wind = [], wdir = [], precip = [], hum = [];
    var now = Date.now();
    for (var i = 0; i < n; i++) {
      var time = new Date(now - (n - 1 - i) * stepH * 3600000);
      var di = (Math.sin(i / (tf === '24H' ? 24 : 8) * Math.PI * 2 - 1.5) + 1) / 2;
      t.push(time);
      hi.push(Math.round(88 + di * 18 + (r() - 0.5) * 4));
      lo.push(Math.round(68 + di * 8 + (r() - 0.5) * 4));
      pres.push(+(1010 + Math.sin(i / 6) * 5 + (r() - 0.5) * 2).toFixed(1));
      wind.push(Math.round(6 + di * 16 + r() * 6));
      wdir.push(Math.floor(160 + r() * 80));
      precip.push(r() > 0.82 ? +(r() * 0.4).toFixed(2) : 0);
      hum.push(Math.round(10 + (1 - di) * 30 + r() * 8));
    }
    return { t: t, hi: hi, lo: lo, pres: pres, wind: wind, wdir: wdir, precip: precip, hum: hum };
  };

  W.airports = {
    KLAS: { name: 'LAS VEGAS INTL', cat: 'VFR', metar: 'KLAS 311853Z 19012G18KT 10SM CLR 34/06 A2992 RMK AO2 SLP132', decoded: [['Wind', '190° at 12 kt, gusting 18'], ['Visibility', '10 statute miles'], ['Sky', 'Clear below 12,000 ft'], ['Temp', '34°C · Dewpoint: 6°C'], ['Altimeter', '29.92 inHg']], taf: 'KLAS 311730Z 3118/0124 19012G18KT P6SM SKC FM010000 21008KT P6SM SKC FM010600 18006KT P6SM SKC', tafRows: [['1800Z', '0000Z', '190/12G18', '10SM', 'CLR', 'VFR'], ['0000Z', '0600Z', '210/08', '10SM', 'CLR', 'VFR'], ['0600Z', '1200Z', '180/06', '10SM', 'CLR', 'VFR']], pirep: 'UA /OV KLAS180015 /TM 1842 /FL095 /TP C172 /TB LGT /RM SMOOTH ABV 110' },
    KVGT: { name: 'NORTH LAS VEGAS', cat: 'VFR', metar: 'KVGT 311853Z 20010KT 10SM FEW120 33/05 A2993 RMK AO2', decoded: [['Wind', '200° at 10 kt'], ['Visibility', '10 statute miles'], ['Sky', 'Few at 12,000 ft'], ['Temp', '33°C · Dewpoint: 5°C'], ['Altimeter', '29.93 inHg']], taf: 'KVGT 311730Z 3118/0118 20010KT P6SM FEW120 FM010200 19006KT P6SM SKC', tafRows: [['1800Z', '0200Z', '200/10', '10SM', 'FEW120', 'VFR'], ['0200Z', '1800Z', '190/06', '10SM', 'CLR', 'VFR']], pirep: null },
    KHND: { name: 'HENDERSON EXEC', cat: 'MVFR', metar: 'KHND 311853Z 21014G22KT 6SM HZ BKN045 32/08 A2991 RMK AO2', decoded: [['Wind', '210° at 14 kt, gusting 22'], ['Visibility', '6 statute miles in haze'], ['Sky', 'Broken at 4,500 ft'], ['Temp', '32°C · Dewpoint: 8°C'], ['Altimeter', '29.91 inHg']], taf: 'KHND 311730Z 3118/0118 21014G22KT 6SM HZ BKN045 FM010300 20008KT P6SM SCT060', tafRows: [['1800Z', '0300Z', '210/14G22', '6SM', 'BKN045', 'MVFR'], ['0300Z', '1800Z', '200/08', '10SM', 'SCT060', 'VFR']], pirep: null },
    KLSV: { name: 'NELLIS AFB', cat: 'VFR', metar: 'KLSV 311855Z 19015G25KT 10SM CLR 35/04 A2990 RMK AO2A SLP118 $', decoded: [['Wind', '190° at 15 kt, gusting 25'], ['Visibility', '10 statute miles'], ['Sky', 'Clear'], ['Temp', '35°C · Dewpoint: 4°C'], ['Altimeter', '29.90 inHg']], taf: 'KLSV 311700Z 3118/0124 19015G25KT 9999 SKC FM010000 20010KT 9999 SKC', tafRows: [['1800Z', '0000Z', '190/15G25', '10SM', 'SKC', 'VFR'], ['0000Z', '2400Z', '200/10', '10SM', 'SKC', 'VFR']], pirep: 'UA /OV KLSV /TM 1850 /FL120 /TP F16 /TB MOD /RM MIL OPS AREA ACTIVE' }
  };
  W.AV_ORDER = ['KLAS', 'KVGT', 'KHND', 'KLSV'];

})(window.DBWx);
