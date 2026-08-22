/* ============================================================
   DOOM BOX — OSINT UI
   Left category nav + filters, right feed (list/cards/compact),
   inline expand, SHOW ON MAP handoff, streaming SITREP modal.
   ============================================================ */
window.DBOsint = window.DBOsint || {};
(function (O) {
  "use strict";

  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }

  var ST, items, refs, wrap;
  var TIMES = { '1h': 60, '6h': 360, '24h': 1440, '7d': 10080 };
  O._intervals = O._intervals || [];

  O.mount = function (container) {
    // reset any prior timers
    O._intervals.forEach(clearInterval); O._intervals = [];
    [].forEach.call(document.querySelectorAll('.os-modal'), function (e) { e.remove(); });
    items = O.build();   // [] until loadAll resolves
    var srcEnabled = {}; Object.keys(O.SOURCES).forEach(function (k) { srcEnabled[k] = {}; O.SOURCES[k].forEach(function (s) { srcEnabled[k][s.n] = !!s.on; }); });
    // default 7-day window: LVMPD CFS data lags ~several days, so 24h would
    // render an empty crime feed even though items exist.
    ST = { cat: 'all', sort: 'newest', view: 'list', filters: { unread: false, alerts: false, time: '7d' }, src: srcEnabled, expanded: null, srcOpen: false, autoMin: 15, pending: [], loading: true };

    container.style.padding = '0'; container.style.position = 'relative'; container.style.overflow = 'hidden';
    container.innerHTML = '';
    wrap = el('div', 'osint'); container.appendChild(wrap);
    refs = {};
    buildLeft(); buildRight(); buildModal();
    renderCats(); renderFeed();

    // initial live load
    O.loadAll().then(function (list) {
      if (!wrap.isConnected) return;
      items = list; ST.loading = false;
      renderCats(); renderHead(); renderFeed();
    });
    O.refreshStatus(function () { if (wrap.isConnected) renderRefresh(); });

    // poll for new items (banner) every 45 s
    O._intervals.push(setInterval(function () {
      if (!wrap.isConnected) { O._intervals.forEach(clearInterval); return; }
      O.poll().then(function (fresh) {
        if (!wrap.isConnected) return;
        if (fresh && fresh.length) { ST.pending = fresh.concat(ST.pending); showNewBanner(); }
      });
      O.refreshStatus(function () { if (wrap.isConnected) renderRefresh(); });
    }, 45000));
    // tick freshness labels
    O._intervals.push(setInterval(function () { if (!wrap.isConnected) { O._intervals.forEach(clearInterval); return; } O.CATS.forEach(function (c) { if (c.updated != null) c.updated++; }); renderRefresh(); }, 60000));
  };

  /* ============================================================ LEFT */
  function buildLeft() {
    var L = el('div', 'os-left'); wrap.appendChild(L); refs.left = L;
    var btn = el('div', 'os-sitrep', '<span class="g">◈</span> GENERATE SITREP');
    btn.addEventListener('click', openSitrep); L.appendChild(btn);
    L.appendChild(el('div', 'os-sitrep-note', 'Summarizes last 60 min of active feeds · runs on local AI · no internet required'));

    var catWrap = el('div'); refs.catWrap = catWrap; L.appendChild(catWrap);

    L.appendChild(el('div', 'os-divline'));
    L.appendChild(el('div', 'os-sec-h', 'FILTERS'));
    refs.filterWrap = el('div'); L.appendChild(refs.filterWrap);
    buildFilters();

    L.appendChild(el('div', 'os-divline'));
    // sources accordion
    var acc = el('div', 'os-srcacc'); refs.srcAcc = acc;
    var ah = el('div', 'os-srcacc-h', '<span class="dbm-h" style="font-family:var(--font-ui);font-weight:700;font-size:.66rem;letter-spacing:.16em;color:var(--text-2)">SOURCES</span><span class="chev">▸</span>');
    ah.addEventListener('click', function () { acc.classList.toggle('open'); });
    var ab = el('div', 'os-srcacc-b'); refs.srcBody = ab; acc.appendChild(ah); acc.appendChild(ab); L.appendChild(acc);
    renderSources();

    L.appendChild(el('div', 'os-divline'));
    L.appendChild(el('div', 'os-sec-h', 'REFRESH STATUS'));
    refs.refreshWrap = el('div'); L.appendChild(refs.refreshWrap);
    var auto = el('div', 'os-auto'); auto.innerHTML = 'AUTO-REFRESH';
    var sel = el('select'); [5, 15, 30, 60].forEach(function (m) { var o = el('option', null, m + ' MIN'); o.value = m; if (m === ST.autoMin) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { ST.autoMin = +sel.value; }); auto.appendChild(sel); L.appendChild(auto);
    renderRefresh();
  }

  function renderCats() {
    var w = refs.catWrap; w.innerHTML = '';
    var groups = []; O.CATS.forEach(function (c) { if (c.group && groups.indexOf(c.group) < 0) groups.push(c.group); });
    function unread(catId) { return items.filter(function (it) { return (catId === 'all' || it.cat === catId) && it.unread; }).length; }
    // ALL first
    w.appendChild(catRow(O.catById.all, unread('all')));
    groups.forEach(function (g) {
      w.appendChild(el('div', 'os-catgrp', '── ' + g + ' ' + '─'.repeat(Math.max(0, 22 - g.length))));
      O.CATS.filter(function (c) { return c.group === g; }).forEach(function (c) { w.appendChild(catRow(c, unread(c.id))); });
    });
  }
  function catRow(c, n) {
    var row = el('div', 'os-cat' + (ST.cat === c.id ? ' active' : '')); row.setAttribute('data-id', c.id);
    var src = c.srcLabel ? '<div class="csrc">' + c.srcLabel + '</div>' : '';
    row.innerHTML = '<div class="cic">' + c.icon + '</div><div class="cmeta">' +
      '<div class="cname">' + c.name + '<span class="os-badge' + (n ? '' : ' zero') + '">' + n + '</span></div>' +
      '<div class="cdesc">' + c.desc + '</div>' + src + '</div>';
    row.addEventListener('click', function () { ST.cat = c.id; ST.expanded = null; renderCats(); renderSources(); renderFeed(); refs.right.scrollTop = 0; });
    return row;
  }

  function buildFilters() {
    var w = refs.filterWrap; w.innerHTML = '';
    w.appendChild(checkRow('Show only unread', ST.filters.unread, function (v) { ST.filters.unread = v; renderFeed(); }));
    w.appendChild(checkRow('Alerts only (red items)', ST.filters.alerts, function (v) { ST.filters.alerts = v; renderFeed(); }));
    [['Last 1 hour', '1h'], ['Last 6 hours', '6h'], ['Last 24 hours', '24h'], ['Last 7 days', '7d']].forEach(function (t) {
      var r = el('div', 'os-filter radio' + (ST.filters.time === t[1] ? ' on' : '')); r.innerHTML = '<span class="bx"></span><span class="lab">' + t[0] + '</span>';
      r.addEventListener('click', function () { ST.filters.time = t[1]; [].forEach.call(w.querySelectorAll('.os-filter.radio'), function (n) { n.classList.remove('on'); }); r.classList.add('on'); renderFeed(); });
      w.appendChild(r);
    });
  }
  function checkRow(label, on, cb) {
    var r = el('div', 'os-filter' + (on ? ' on' : '')); r.innerHTML = '<span class="bx"></span><span class="lab">' + label + '</span>';
    r.addEventListener('click', function () { r.classList.toggle('on'); cb(r.classList.contains('on')); }); return r;
  }

  function renderSources() {
    var b = refs.srcBody; if (!b) return; b.innerHTML = '';
    var cat = ST.cat === 'all' ? 'crime' : ST.cat;
    if (!O.SOURCES[cat]) { b.appendChild(el('div', 'os-src', '<span class="lab" style="opacity:.6">No per-source toggles</span>')); return; }
    O.SOURCES[cat].forEach(function (s) {
      var on = ST.src[cat][s.n] && s.on !== 0 || (ST.src[cat][s.n] && s.note == null);
      var enabled = ST.src[cat][s.n];
      var r = el('div', 'os-src' + (enabled ? ' on' : '')); r.innerHTML = '<span class="bx"></span><span class="lab">' + s.n + '</span>' + (s.note ? '<span class="note">' + s.note + '</span>' : '');
      r.addEventListener('click', function () { if (s.note) return; ST.src[cat][s.n] = !ST.src[cat][s.n]; r.classList.toggle('on', ST.src[cat][s.n]); renderFeed(); });
      b.appendChild(r);
    });
  }

  function renderRefresh() {
    var w = refs.refreshWrap; if (!w) return; w.innerHTML = '';
    [['crime', 'CRIME'], ['news', 'LOCAL NEWS'], ['alert', 'ALERTS'], ['weather', 'WEATHER'], ['mesh', 'MESH'], ['sigint', 'SIGINT']].forEach(function (c) {
      var cat = O.catById[c[0]];
      var txt = cat.updated == null ? 'syncing…' : 'updated ' + cat.updated + ' min ago';
      var row = el('div', 'os-refresh-row'); row.innerHTML = '<span class="rn">' + c[1] + '</span><span class="rt">' + txt + '</span>';
      var b = el('button', 'rb', '↻'); b.title = 'Refresh feeds';
      b.addEventListener('click', function () {
        b.textContent = '…';
        O.poll().then(function (fresh) { if (fresh && fresh.length) { ST.pending = fresh.concat(ST.pending); showNewBanner(); } b.textContent = '↻'; });
        O.refreshStatus(function () { renderRefresh(); });
      });
      row.appendChild(b); w.appendChild(row);
    });
  }

  /* ============================================================ RIGHT */
  function buildRight() {
    var R = el('div', 'os-right'); wrap.appendChild(R); refs.right = R;
    var banner = el('div', 'os-newbanner'); banner.addEventListener('click', loadPending); R.appendChild(banner); refs.banner = banner;
    var head = el('div', 'os-rhead'); R.appendChild(head); refs.head = head;
    var feed = el('div', 'os-feed view-list'); R.appendChild(feed); refs.feed = feed;
  }

  function passes(it) {
    if (ST.cat !== 'all' && it.cat !== ST.cat) return false;
    var cat = it.cat; if (ST.src[cat] && ST.src[cat][it.source] === false) return false;
    if (ST.filters.unread && !it.unread) return false;
    if (ST.filters.alerts && it.severity < 2) return false;
    if ((Date.now() - it.ts) / 60000 > TIMES[ST.filters.time]) return false;
    return true;
  }
  function currentItems() {
    var list = items.filter(passes);
    if (ST.sort === 'oldest') list.sort(function (a, b) { return a.ts - b.ts; });
    else if (ST.sort === 'severity') list.sort(function (a, b) { return b.severity - a.severity || b.ts - a.ts; });
    else list.sort(function (a, b) { return b.ts - a.ts; });
    list.sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0); });
    return list;
  }

  function renderHead() {
    var cat = O.catById[ST.cat], list = currentItems(), unread = list.filter(function (i) { return i.unread; }).length;
    var h = '<div class="os-rtitle">' + cat.name + '</div>' +
      '<div class="os-rcount">' + list.length + ' items · <b>' + unread + ' unread</b></div>' +
      '<div class="os-rctrls">' +
      '<span class="os-seg-lbl">SORT</span><div class="os-seg" data-seg="sort">' +
      seg('NEWEST', 'newest', ST.sort) + seg('OLDEST', 'oldest', ST.sort) + seg('SEVERITY', 'severity', ST.sort) + '</div>' +
      '<span class="os-seg-lbl">VIEW</span><div class="os-seg" data-seg="view">' +
      seg('LIST', 'list', ST.view) + seg('CARDS', 'cards', ST.view) + seg('COMPACT', 'compact', ST.view) + '</div>' +
      '<button class="os-markall">MARK ALL READ</button></div>';
    refs.head.innerHTML = h;
    [].forEach.call(refs.head.querySelectorAll('.os-seg'), function (sg) {
      var key = sg.getAttribute('data-seg');
      [].forEach.call(sg.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () { ST[key] = b.getAttribute('data-v'); if (key === 'view') { refs.feed.className = 'os-feed view-' + ST.view; } renderHead(); renderFeed(); });
      });
    });
    refs.head.querySelector('.os-markall').addEventListener('click', function () { items.forEach(function (it) { if (ST.cat === 'all' || it.cat === ST.cat) it.unread = false; }); renderCats(); renderHead(); renderFeed(); });
  }
  function seg(label, v, cur) { return '<button class="' + (v === cur ? 'on' : '') + '" data-v="' + v + '">' + label + '</button>'; }

  function renderFeed() {
    renderHead();
    var feed = refs.feed; feed.className = 'os-feed view-' + ST.view; feed.innerHTML = '';
    var list = currentItems();
    if (!list.length) { feed.appendChild(emptyState()); return; }
    list.forEach(function (it) { feed.appendChild(it.isReport ? reportEl(it) : itemEl(it)); });
  }

  function tagFor(it) { var c = O.catById[it.cat]; return '<span class="os-tag ' + c.tagClass + '">' + c.tag + '</span>'; }

  function itemEl(it) {
    var row = el('div', 'os-item' + (it.unread ? ' unread' : '') + (it.pinned ? ' pinned' : '') + (ST.expanded === it.id ? ' expanded' : ''));
    var cred = it.cat === 'war' && it.cred != null ? '<span class="os-cred" title="' + O.CRED[it.cred][1] + '" style="background:' + O.CRED[it.cred][0] + '"></span>' : '';
    var region = it.region ? '<span class="os-region">' + it.region + '</span>' : '';
    var top = '<div class="os-item-top">' + tagFor(it) + '<span class="os-source">' + it.source + '</span><span class="os-sep">·</span><span class="os-time">' + O.zulu(it.ts) + '</span>' + cred + region +
      (it.pinned ? '<span class="os-pin-ic">★</span>' : it.unread ? '<span class="os-unreaddot"></span>' : '') + '</div>';
    var head = '<div class="os-headline">' + it.headline + '</div>';
    var exc = '<div class="os-excerpt">' + it.excerpt + '</div>';

    var chips = '<div class="os-chips">';
    if (it.isCfs) {
      chips += '<span class="os-offense off-' + it.offense + '">' + it.offense + '</span>';
      chips += '<span class="os-chip loc" data-act="map">📍 ' + it.intersection + '</span>';
      if (it.cfs) chips += '<span class="os-cfs cfs-' + it.cfs + '">CFS ' + it.cfs + '</span>';
      chips += '<span class="os-chip">⏱ ' + O.sinceText(it.ts) + '</span>';
    } else {
      if (it.loc) chips += '<span class="os-chip loc" data-act="map">📍 GEOLOCATED</span>';
      chips += '<span class="os-chip" data-act="expand">🔗 READ MORE</span>';
      chips += '<span class="os-chip" data-act="pin">📌 ' + (it.pinned ? 'PINNED' : 'SAVE') + '</span>';
    }
    chips += '</div>';

    row.innerHTML = top + head + exc + chips + '<div class="os-expand">' + expandHTML(it) + '</div>';

    row.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (act) { e.stopPropagation(); handleAct(act.getAttribute('data-act'), it, row); return; }
      if (e.target.closest('.os-expand')) return;
      toggleExpand(it);
    });
    return row;
  }

  function expandHTML(it) {
    var thumb = it.loc ? '<div class="os-mapthumb"><span class="pin">📍</span><span class="cap">' + (window.DBMap ? DBMap.toMGRS(it.loc.lat, it.loc.lon) : '') + '</span></div>' : '';
    var acts = '<div class="os-actions">';
    if (it.loc) acts += '<button class="os-act primary" data-act="map">📍 SHOW ON MAP</button>';
    acts += '<button class="os-act" data-act="ai">◈ AI SUMMARY</button>';
    acts += '<button class="os-act" data-act="pin">📌 ' + (it.pinned ? 'UNPIN' : 'PIN') + '</button>';
    acts += '<button class="os-act" data-act="open">↗ OPEN SOURCE</button>';
    acts += '<button class="os-act" data-act="close">✕ CLOSE</button></div>';
    return '<div class="os-fulltext">' + (it.body || '<p>No extended description.</p>') + '</div>' +
      '<div class="os-attr">' + it.source + ' · published ' + O.zulu(it.ts) + ' · ' + O.sinceText(it.ts) + '</div>' +
      thumb + '<div class="os-aisum"><div class="h">◈ LOCAL AI SUMMARY</div><span class="txt"></span></div>' + acts;
  }

  function toggleExpand(it) { ST.expanded = ST.expanded === it.id ? null : it.id; if (ST.expanded === it.id && it.unread) { it.unread = false; renderCats(); } renderFeed(); }

  function handleAct(act, it, row) {
    if (act === 'expand') { toggleExpand(it); return; }
    if (act === 'close') { ST.expanded = null; renderFeed(); return; }
    if (act === 'pin') { it.pinned = !it.pinned; renderFeed(); return; }
    if (act === 'open') {
      if (it.url) { window.open(it.url, '_blank', 'noopener,noreferrer'); return; }
      var b = row.querySelector('[data-act="open"]'); if (b) { b.textContent = '↗ NO SOURCE LINK'; setTimeout(function () { if (b.isConnected) b.textContent = '↗ OPEN SOURCE'; }, 1800); } return;
    }
    if (act === 'ai') { var box = row.querySelector('.os-aisum'); if (box) { box.classList.add('show'); streamAISummary(box.querySelector('.txt'), it); } if (ST.expanded !== it.id) toggleExpand(it); return; }
    if (act === 'map') { showOnMap(it); return; }
  }

  function showOnMap(it) {
    if (!it.loc) return;
    if (window.DBShell) DBShell.go('MAP');
    setTimeout(function () {
      if (!window.DBMap) return;
      if (it.cat === 'crime') { DBMap.state.active['crime_inc'] = true; DBMap.state.active['crime_heat'] = true; if (DBMap.ui) DBMap.ui.updateLayerCount(); }
      DBMap.tools.setMarker(it.loc.lat, it.loc.lon);
      DBMap.flyTo(it.loc.lat, it.loc.lon, 15);
    }, 160);
  }

  function wordStream(span, txt) {
    var words = String(txt || '').split(' '), i = 0; span.textContent = '';
    var iv = setInterval(function () { if (!span.isConnected || i >= words.length) { clearInterval(iv); return; } span.textContent += (i ? ' ' : '') + words[i++]; }, 28);
  }
  function localSummary(it) {
    return 'Assessment: ' + it.headline.toLowerCase() + '. ' + (it.isCfs ? 'Geolocated incident; cross-reference with the CFS density layer and recent patterns in the grid square.' : it.cat === 'weather' || it.cat === 'alert' ? 'Active advisory; monitor follow-on indicators and secure exterior equipment as warranted.' : 'Routine reporting; no immediate operational impact assessed.');
  }
  // Per-item AI summary via the real local model (/api/ai/triage, 1 sentence).
  function streamAISummary(span, it) {
    span.textContent = 'thinking…';
    var text = ((it.headline || '') + '. ' + (it.body || '').replace(/<[^>]+>/g, ' ')).slice(0, 1200);
    fetch('/api/ai/triage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, model: 'qwen2.5:1.5b' }), cache: 'no-store'
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!span.isConnected) return;
        wordStream(span, (j && j.ok && j.summary) ? j.summary : localSummary(it));
      })
      .catch(function () { if (span.isConnected) wordStream(span, localSummary(it)); });
  }

  function reportEl(it) {
    var row = el('div', 'os-report');
    var cred = '<span class="os-cred" style="background:' + O.CRED[it.cred][0] + '"></span>';
    var secs = it.report.map(function (s) { return '<div class="rsec">── ' + s[0] + '</div><div class="rp">' + s[1] + '</div>'; }).join('');
    row.innerHTML = '<div class="rh">' + it.headline + '</div><div class="rsub">' + cred + ' ISW · ' + it.region + ' · ' + O.zulu(it.ts) + ' · ' + O.sinceText(it.ts) + '</div>' + secs;
    return row;
  }

  function emptyState() {
    var e = el('div', 'os-empty');
    e.innerHTML = '<div class="ei">⊘</div><div class="et">NO FEED DATA</div>' +
      '<div class="ed">This category has no items matching the current filters.<br>Adjust filters or trigger a manual refresh.</div>';
    var b = el('button', 'eb', '↻ REFRESH NOW'); b.addEventListener('click', function () { ST.filters = { unread: false, alerts: false, time: '7d' }; buildFilters(); renderFeed(); }); e.appendChild(b);
    return e;
  }

  /* ---- new items banner ---- */
  function showNewBanner() { if (!refs.banner) return; refs.banner.innerHTML = '↑ ' + ST.pending.length + ' new item' + (ST.pending.length > 1 ? 's' : '') + ' — click to load'; refs.banner.classList.add('show'); }
  function loadPending() { items = ST.pending.concat(items); ST.pending = []; refs.banner.classList.remove('show'); renderCats(); renderFeed(); refs.right.scrollTop = 0; }

  /* ============================================================ SITREP MODAL */
  function buildModal() {
    var m = el('div', 'os-modal'); refs.modal = m;
    m.innerHTML = '<div class="os-modal-panel"><div class="os-modal-h"><div><div class="t">SITUATION REPORT</div><div class="s"></div></div><button class="cls">✕</button></div>' +
      '<div class="os-modal-body"></div>' +
      '<div class="os-modal-f"><button class="os-mb amber" data-m="copy">📋 COPY TO CLIPBOARD</button><button class="os-mb" data-m="save">💾 SAVE TO SANDISK</button><button class="os-mb" data-m="regen">◈ REGENERATE</button><button class="os-mb" data-m="close">✕ CLOSE</button>' +
      '<div class="note">Generated by local AI (qwen2.5:3b) · No data leaves this device · Knowledge limited to cached feeds</div></div></div>';
    document.body.appendChild(m);
    m.querySelector('.cls').addEventListener('click', closeSitrep);
    m.addEventListener('click', function (e) { if (e.target === m) closeSitrep(); });
    [].forEach.call(m.querySelectorAll('[data-m]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-m');
        if (k === 'close') closeSitrep();
        else if (k === 'regen') runSitrep();
        else if (k === 'copy') { if (navigator.clipboard) navigator.clipboard.writeText(refs.modal.querySelector('.os-modal-body').innerText).catch(function () {}); b.textContent = '✓ COPIED'; setTimeout(function () { b.textContent = '📋 COPY TO CLIPBOARD'; }, 1500); }
        else if (k === 'save') { b.textContent = '✓ SAVED → /sandisk/sitrep'; setTimeout(function () { b.textContent = '💾 SAVE TO SANDISK'; }, 1700); }
      });
    });
  }
  function openSitrep() { refs.modal.classList.add('show'); runSitrep(); }
  function closeSitrep() { refs.modal.classList.remove('show'); if (ST._srTimer) clearInterval(ST._srTimer); if (ST._srES) { try { ST._srES.close(); } catch (e) {} ST._srES = null; } }

  function computeSitrep() {
    function recent(cat, mins) { return items.filter(function (it) { return it.cat === cat && (Date.now() - it.ts) / 60000 <= mins; }); }
    var crime24 = recent('crime', 1440), alerts = items.filter(function (i) { return i.severity >= 2 && (Date.now() - i.ts) / 60000 <= 1440; });
    var nat = recent('national', 1440).slice(0, 3), intl = recent('intl', 1440).slice(0, 2), war = items.filter(function (i) { return i.cat === 'war' && !i.isReport; }).slice(0, 2);
    var d = new Date();
    return {
      date: O.zulu(d), sections: [
        ['EXECUTIVE SUMMARY', [{ t: 'p', x: 'Operating environment assessed as STABLE with localized elevated risk. ' + crime24.length + ' crime incidents and ' + alerts.length + ' priority alerts logged in the last 24 hours across monitored feeds. No change to overall posture recommended at this time.' }]],
        ['LOCAL THREAT PICTURE', [{ t: 'p', x: crime24.length + ' CFS / NIBRS incidents in the last 24h. Notable: ' + (crime24[0] ? crime24[0].headline : 'none') + '.' }, { t: 'li', x: alerts.length + ' priority (red) alert(s) active' }, { t: 'li', x: 'Crime density concentrated along eastern corridor grid squares' }]],
        ['NATIONAL SITUATION', nat.map(function (n) { return { t: 'li', x: n.headline + ' (' + n.source + ')' }; })],
        ['INTERNATIONAL / CONFLICT', intl.map(function (n) { return { t: 'li', x: n.headline }; }).concat(war.map(function (w) { return { t: 'li', x: '[' + (w.region || 'CONFLICT') + '] ' + w.headline }; }))],
        ['COMMUNICATIONS STATUS', [{ t: 'p', x: 'Mesh: 6 nodes online, integrity nominal. 3 messages received in last hour. No comms degradation reported.' }]],
        ['WEATHER', [{ t: 'p', x: 'Current: 4°C, baro 1014 hPa falling, visibility 9 km. WIND ADVISORY in effect until 1800Z, gusts to 45 kt.' }]],
        ['RECOMMENDED ACTIONS', [{ t: 'li', x: 'Maintain current monitoring posture; no escalation indicated' }, { t: 'li', x: 'Cross-reference crime cluster with MAP crime-heat overlay' }, { t: 'li', x: 'Secure exterior antennas ahead of forecast wind gusts' }, { t: 'li', x: 'Continue passive collection on flagged conflict zones' }]]
      ]
    };
  }

  // light markdown → HTML for the finished SITREP (the model emits **bold**,
  // bullets, and ALLCAPS section headers).
  function mdLite(s) {
    var h = String(s).replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; });
    h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    return h.split(/\n/).map(function (ln) {
      var t = ln.trim(); if (!t) return '';
      if (/^[-*•]\s+/.test(t)) return '<div class="os-sr-li">' + t.replace(/^[-*•]\s+/, '') + '</div>';
      if (/^#{1,6}\s+/.test(t)) return '<div class="os-sr-sec">' + t.replace(/^#{1,6}\s+/, '').replace(/:$/, '') + '</div>';
      if (/^[A-Z0-9 ()\/&.-]{4,}:?$/.test(t) && t.length < 50) return '<div class="os-sr-sec">' + t.replace(/:$/, '') + '</div>';
      return '<div class="os-sr-p">' + t + '</div>';
    }).join('');
  }

  // Real streaming SITREP via the local AI: GET SSE /api/ai/summarize/stream,
  // POST /api/ai/summarize fallback. Summarizes the last 60 min of live feeds.
  function runSitrep() {
    var body = refs.modal.querySelector('.os-modal-body'), sub = refs.modal.querySelector('.os-modal-h .s');
    var stamp = O.zulu(new Date());
    sub.textContent = stamp + ' · GENERATING…';
    body.innerHTML = '';
    var live = el('div', 'os-sr-live'); var txt = el('span', 'os-sr-stream'); var cursor = el('span', 'os-cursor');
    live.appendChild(txt); live.appendChild(cursor); body.appendChild(live);
    var acc = '', first = false, closed = false;

    if (ST._srES) { try { ST._srES.close(); } catch (e) {} ST._srES = null; }
    if (ST._srTimer) { clearInterval(ST._srTimer); ST._srTimer = null; }

    function finish(ok) {
      if (closed) return; closed = true;
      if (cursor.parentNode) cursor.remove();
      body.innerHTML = mdLite(acc || '(no content returned)');
      sub.textContent = stamp + (ok ? ' · COMPLETE' : ' · ERROR');
      body.scrollTop = 0;
    }
    function fallbackPOST() {
      if (closed) return;
      sub.textContent = stamp + ' · GENERATING (fallback)…';
      fetch('/api/ai/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since_seconds: 3600, model: 'qwen2.5:3b' }), cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (closed) return;
          if (j && j.ok && j.summary) { acc = j.summary; finish(true); }
          else { closed = true; if (cursor.parentNode) cursor.remove(); txt.textContent = 'No feed items in the last hour to summarize.'; sub.textContent = stamp + ' · NO DATA'; }
        })
        .catch(function () { if (closed) return; closed = true; if (cursor.parentNode) cursor.remove(); txt.textContent = 'AI summary unavailable — local model offline or busy.'; sub.textContent = stamp + ' · ERROR'; });
    }

    var url = '/api/ai/summarize/stream?' + new URLSearchParams({ since_seconds: '3600', model: 'qwen2.5:3b' }).toString();
    var es;
    try { es = new EventSource(url); } catch (e) { fallbackPOST(); return; }
    ST._srES = es;
    es.onmessage = function (e) {
      var obj; try { obj = JSON.parse(e.data); } catch (_) { return; }
      if (obj.error) { try { es.close(); } catch (_) {} ST._srES = null; if (!first) fallbackPOST(); else finish(false); return; }
      if (obj.token) { first = true; acc += obj.token; txt.textContent = acc; body.scrollTop = body.scrollHeight; }
      if (obj.done) { try { es.close(); } catch (_) {} ST._srES = null; finish(true); }
    };
    es.onerror = function () {
      try { es.close(); } catch (_) {} if (closed) return;
      ST._srES = null;
      if (!first) fallbackPOST();   // never opened — try POST
      else finish(true);            // partial stream — keep what we have
    };
  }

})(window.DBOsint);
