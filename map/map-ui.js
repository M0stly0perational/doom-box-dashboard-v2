/* ============================================================
   DOOM BOX V2 — MAP UI  (chrome wired to the REAL MapLibre map)
   Search, left toolbar, layers panel (basemap + real tactical
   overlays + settings), annotations panel, region manager
   (/api/maps/*), context menu, cursor readout, instruction
   banner, toast, fullscreen. Exposes DBMap.ui.mount(container).
   ============================================================ */
window.DBMap = window.DBMap || {};
(function (M) {
  "use strict";
  var S = M.state, T;
  var U = M.ui = {};
  var wrap, refs = {}, entityCounts = { tak: 0, adsb: 0, mesh: 0 };
  U._fmt = localStorage.getItem("db_map_coordfmt") || "MGRS";
  U._cursorMgrs = localStorage.getItem("db_map_cursormgrs") !== "0";

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function svg(p, vb) { return '<svg viewBox="' + (vb || "0 0 24 24") + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; }
  var TOOL_IC = {
    pan: svg('<path d="M12 2v20 M2 12h20"/><circle cx="12" cy="12" r="3"/>'),
    measure: svg('<path d="M3 17 L17 3 L21 7 L7 21 Z"/><path d="M7 13l2 2 M11 9l2 2 M15 5l2 2"/>'),
    rings: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
    point: svg('<path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.2"/>'),
    line: svg('<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M6.5 17.5 L17.5 6.5"/>'),
    polygon: svg('<path d="M12 3 L20 9 L17 20 L7 20 L4 9 Z"/>'),
    circle: svg('<circle cx="12" cy="12" r="8.5"/>'),
    freehand: svg('<path d="M3 17c3 0 3-8 6-8s3 6 6 6 4-7 6-7"/>'),
    undo: svg('<path d="M9 14 L4 9 L9 4"/><path d="M4 9h11a5 5 0 0 1 0 10H9"/>'),
    trash: svg('<path d="M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13"/>'),
    save: svg('<path d="M5 3h11l3 3v15H5z M8 3v6h7 M8 21v-7h8v7"/>'),
    north: svg('<path d="M12 2 L12 22 M12 2 L8 8 M12 2 L16 8"/>'),
    fit: svg('<path d="M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5"/>'),
    full: svg('<path d="M3 8V3h5 M21 8V3h-5 M3 16v5h5 M21 16v5h-5"/><rect x="8" y="8" width="8" height="8"/>')
  };

  /* ============================================================
     MOUNT
     ============================================================ */
  U.mount = function (container) {
    T = M.tools;
    container.style.padding = "0"; container.style.position = "relative"; container.innerHTML = "";
    wrap = el("div", "dbmap");
    container.appendChild(wrap);

    // attach the persistent MapLibre map element
    M.ensureMap(wrap);

    // resolve region (async) then refresh the region manager + readout label
    M.resolveRegion().then(function () {
      buildRegion();
      var reg = refs.ro && refs.ro.querySelector(".reg");
      if (reg) reg.textContent = "REGION: " + ((S.region && (S.region.name || S.region.region_id)) || "—");
    });

    buildSearch(); buildToolbar(); buildLayersBtn(); buildLayersPanel();
    buildAnnoPanel(); buildRegion(); buildContext(); buildReadout(); buildInstruct(); buildToast(); buildExitFull();
    if (M.hires && M.hires.mount) M.hires.mount(wrap);

    U.highlightTool(T.current || "pan");
    U.refreshAnnos(); U.updateLayerCount();
    M.updateTopbarReadout();

    wrap.addEventListener("pointerdown", function (e) { if (!e.target.closest(".dbm-ctx")) U.hideContext(); }, true);
  };

  /* ============================================================
     SEARCH
     ============================================================ */
  function buildSearch() {
    var s = el("div", "dbm-panel dbm-search");
    s.innerHTML = '<div class="s-ic">' + svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v4 M12 18v4 M2 12h4 M18 12h4"/>') + "</div>";
    var inp = el("input"); inp.type = "text"; inp.placeholder = "MGRS · LAT,LON · DMS …"; inp.spellcheck = false;
    var clr = el("button", "s-clear", "✕"), go = el("button", "s-go", "GO");
    s.appendChild(inp); s.appendChild(clr); s.appendChild(go); wrap.appendChild(s); refs.search = inp;
    function run() {
      var r = M.parseCoord(inp.value);
      if (r) { M.flyTo(r.lat, r.lon, 14); T.setMarker(r.lat, r.lon); U.toast("GOTO · " + M.mgrsAt(r.lon, r.lat, 4)); s.classList.remove("err"); }
      else if (inp.value.trim()) { s.classList.add("err"); setTimeout(function () { s.classList.remove("err"); }, 1400); }
    }
    go.addEventListener("click", run);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });
    clr.addEventListener("click", function () { inp.value = ""; T.clearMarker(); });
  }

  /* ============================================================
     LEFT TOOLBAR
     ============================================================ */
  function buildToolbar() {
    var t = el("div", "dbm-panel dbm-tools");
    var groups = [
      { lbl: "NAV", items: [["pan", "Pan", "tool"], ["measure", "Measure dist/bearing", "tool"], ["rings", "Range rings", "tool"]] },
      { lbl: "DRAW", items: [["point", "Drop point", "tool"], ["line", "Draw line", "tool"], ["polygon", "Draw polygon", "tool"], ["circle", "Draw circle", "tool"], ["freehand", "Freehand", "tool"], ["undo", "Undo last", "undo"], ["trash", "Clear all", "clear"], ["save", "Save to server", "save"]] },
      { lbl: "VIEW", items: [["north", "Reset bearing N", "north"], ["fit", "Fit to region", "fit"], ["full", "Fullscreen", "full"]] }
    ];
    groups.forEach(function (g, gi) {
      if (gi) t.appendChild(el("div", "t-sep"));
      t.appendChild(el("div", "t-lbl", g.lbl));
      g.items.forEach(function (it) {
        var b = el("button", "dbm-tool", TOOL_IC[it[0]] || "");
        b.setAttribute("data-tip", it[1]); b.setAttribute("data-act", it[2]); b.setAttribute("data-tool", it[0]);
        b.addEventListener("click", function () { onToolClick(it[2], it[0]); });
        t.appendChild(b);
      });
    });
    wrap.appendChild(t); refs.toolbar = t;
  }
  function onToolClick(act, id) {
    if (act === "tool") T.setTool(id === T.current ? "pan" : id);
    else if (act === "undo") T.undo();
    else if (act === "clear") { T.clearAll(); }
    else if (act === "save") T.saveServer();
    else if (act === "north") M.resetBearing();
    else if (act === "fit") M.fitRegion();
    else if (act === "full") { var on = T.toggleFull(); U.toast(on ? "FULLSCREEN · ESC TO EXIT" : "FULLSCREEN OFF"); }
  }
  U.highlightTool = function (name) {
    if (!refs.toolbar) return;
    [].forEach.call(refs.toolbar.querySelectorAll(".dbm-tool"), function (b) {
      var act = b.getAttribute("data-act"), id = b.getAttribute("data-tool");
      b.classList.toggle("on", act === "tool" && id === name);
      if (id === "full") b.classList.toggle("on", document.body.classList.contains("map-full"));
    });
  };

  /* ============================================================
     LAYERS BUTTON + PANEL
     ============================================================ */
  function buildLayersBtn() {
    var b = el("div", "dbm-panel dbm-layers-btn");
    b.innerHTML = svg('<path d="M12 3 L21 8 L12 13 L3 8 Z"/><path d="M3 13 L12 18 L21 13"/>') + "<span>LAYERS</span><span class=\"cnt\">0</span>";
    wrap.appendChild(b); refs.layersBtn = b;
    b.addEventListener("click", function () { refs.rpanel.classList.toggle("open"); });
  }
  function accordion(title, open) {
    var root = el("div", "dbm-acc" + (open ? " open" : ""));
    var h = el("div", "dbm-acc-h", '<span class="dbm-h">' + title + '</span><span class="chev">▸</span>');
    var body = el("div", "dbm-acc-b"); root.appendChild(h); root.appendChild(body);
    h.addEventListener("click", function () { root.classList.toggle("open"); });
    return { root: root, body: body };
  }
  function toggleRow(label, on, cb) {
    var r = el("div", "dbm-tg" + (on ? " on" : "")); r.innerHTML = '<span class="lab">' + label + '</span><span class="sw"></span>';
    r.addEventListener("click", function () { r.classList.toggle("on"); cb(r.classList.contains("on")); });
    return r;
  }
  function buildLayersPanel() {
    var p = el("div", "dbm-panel dbm-rpanel");
    var head = el("div", "rp-head"); head.innerHTML = '<span class="dbm-h">Layers &amp; Overlays</span>';
    var x = el("button", "rp-close", "✕"); head.appendChild(x); p.appendChild(head);
    x.addEventListener("click", function () { p.classList.remove("open"); });
    var body = el("div", "rp-body");

    // BASEMAP (offline stack only — the "Online only" satellite toggles live
    // in Map Settings below, off by default, so the default view is what the
    // field actually sees with no internet.)
    var s1 = accordion("Basemap", true);
    var bmOpts = [
      { id: "vector", lab: "Vector — Protomaps dark", sat: false }
    ];
    function curBm() { return S.basemap === "satellite" ? ("sat_" + S.satSource) : "vector"; }
    bmOpts.forEach(function (o) {
      var r = el("div", "dbm-radio" + (curBm() === o.id ? " on" : ""));
      r.innerHTML = '<span class="rd"></span><span class="lab">' + o.lab + "</span>";
      r.addEventListener("click", function () {
        [].forEach.call(s1.body.querySelectorAll(".dbm-radio"), function (n) { n.classList.remove("on"); });
        r.classList.add("on");
        if (o.sat) M.setBasemap("satellite", o.src); else M.setBasemap("vector");
      });
      s1.body.appendChild(r);
    });
    s1.body.appendChild(toggleRow("World imagery backdrop", S.worldBm, M.setWorldBm));
    s1.body.appendChild(toggleRow("US imagery", S.usImagery, M.setUsImagery));
    s1.body.appendChild(toggleRow("DFW hi-res imagery (z16)", S.regionDfw, M.setRegionDfw));
    s1.body.appendChild(toggleRow("Vegas hi-res imagery (z16)", S.regionVegas, M.setRegionVegas));
    body.appendChild(s1.root);

    // TACTICAL OVERLAYS (real)
    var s2 = accordion("Tactical Overlays", true);
    var groups = []; M.LAYERS.forEach(function (l) { if (groups.indexOf(l.g) < 0) groups.push(l.g); });
    refs.rows = {};
    groups.forEach(function (g) {
      s2.body.appendChild(el("div", "dbm-grp", "── " + g + " ──"));
      M.LAYERS.filter(function (l) { return l.g === g; }).forEach(function (l) {
        var on = M.layers.isActive(l.id);
        var row = el("div", "dbm-row" + (on ? " on" : "")); row.setAttribute("data-id", l.id);
        var cnt = (l.kind === "entity") ? ' <span class="ecnt" data-k="' + l.id + '"></span>' : "";
        row.innerHTML = '<span class="box"></span><span class="lab">' + l.label + cnt + '</span><span class="src">' + l.src + "</span>";
        row.addEventListener("click", function () {
          var nv = !M.layers.isActive(l.id);
          M.layers.setActive(l.id, nv);
          row.classList.toggle("on", nv);
        });
        refs.rows[l.id] = row;
        s2.body.appendChild(row);
      });
    });
    body.appendChild(s2.root);

    // SETTINGS
    var s3 = accordion("Map Settings", false);
    s3.body.appendChild(toggleRow("Show MGRS on cursor", U._cursorMgrs, function (v) { U._cursorMgrs = v; localStorage.setItem("db_map_cursormgrs", v ? "1" : "0"); }));
    var sel = el("div", "dbm-sel"); sel.innerHTML = '<span class="lab">Coord format</span>'; var dd = el("select");
    ["MGRS", "Decimal", "DMS"].forEach(function (o) { var op = el("option", null, o); op.value = o; if (o === U._fmt) op.selected = true; dd.appendChild(op); });
    dd.addEventListener("change", function () { U._fmt = dd.value; localStorage.setItem("db_map_coordfmt", dd.value); });
    sel.appendChild(dd); s3.body.appendChild(sel);

    // Live satellite imagery — fetches from the internet on every tile, default
    // OFF, deliberately tucked away here (not the Basemap accordion) so it's
    // never what a field/offline operator sees by default.
    s3.body.appendChild(el("div", "dbm-grp", "── Online only (needs internet) ──"));
    var satRows = [];
    function syncSatRows() {
      satRows.forEach(function (sr) {
        sr.row.classList.toggle("on", S.basemap === "satellite" && S.satSource === sr.src);
      });
    }
    [{ src: "usgs", lab: "Satellite — USGS (live)" }, { src: "esri", lab: "Satellite — ESRI (live)" }].forEach(function (o) {
      var row = toggleRow(o.lab, S.basemap === "satellite" && S.satSource === o.src, function (on) {
        if (on) M.setBasemap("satellite", o.src); else M.setBasemap("vector");
        syncSatRows();
      });
      satRows.push({ row: row, src: o.src });
      s3.body.appendChild(row);
    });
    body.appendChild(s3.root);

    var sum = el("div", "dbm-summary");
    sum.innerHTML = '<div class="cnt-line"><b id="dbm-actcnt">0</b> OVERLAYS ACTIVE</div>';
    var clr = el("button", "dbm-clear", "CLEAR ALL LAYERS");
    clr.addEventListener("click", function () {
      M.layers.clearAll();
      [].forEach.call(s2.body.querySelectorAll(".dbm-row"), function (n) { n.classList.remove("on"); });
      U.updateLayerCount();
    });
    sum.appendChild(clr);

    p.appendChild(body); p.appendChild(sum); wrap.appendChild(p);
    refs.rpanel = p; refs.actcnt = sum.querySelector("#dbm-actcnt");
  }
  U.updateLayerCount = function () {
    var n = M.layers.activeCount();
    if (refs.actcnt) refs.actcnt.textContent = n;
    if (refs.layersBtn) { refs.layersBtn.classList.toggle("has", n > 0); var c = refs.layersBtn.querySelector(".cnt"); if (c) c.textContent = n; }
  };
  U.onEntityCount = function (kind, n) {
    entityCounts[kind] = n;
    if (!refs.rows) return;
    var span = refs.rows[kind] && refs.rows[kind].querySelector(".ecnt");
    if (span) span.textContent = n ? "· " + n : "";
  };

  /* ============================================================
     ANNOTATIONS PANEL
     ============================================================ */
  function buildAnnoPanel() {
    var p = el("div", "dbm-panel dbm-lpanel");
    var head = el("div", "rp-head"); head.innerHTML = '<span class="dbm-h">Annotations</span>';
    var x = el("button", "rp-close", "✕"); head.appendChild(x); p.appendChild(head);
    x.addEventListener("click", function () { p.classList.remove("open"); });
    var list = el("div", "dbm-anno-list"); p.appendChild(list);
    var foot = el("div", "dbm-anno-foot");
    var sv = el("button", "dbm-anno-save", "SAVE TO SERVER"); sv.addEventListener("click", function () { T.saveServer(); });
    foot.appendChild(sv); p.appendChild(foot);
    wrap.appendChild(p); refs.lpanel = p; refs.annoList = list;

    var tab = el("div", "dbm-panel dbm-anno-tab");
    var tb = el("button", "dbm-tool", svg('<path d="M4 5h16 M4 10h16 M4 15h10"/>')); tb.setAttribute("data-tip", "Annotations"); tb.style.margin = "2px auto";
    tb.addEventListener("click", function () { p.classList.toggle("open"); });
    tab.appendChild(tb); wrap.appendChild(tab);
  }
  U.refreshAnnos = function () {
    if (!refs.annoList) return; var list = refs.annoList; list.innerHTML = "";
    var n = T.annos.length, raw = T.serverRaw || [];
    if (!n && !raw.length) list.appendChild(el("div", "dbm-empty", "NO ANNOTATIONS.\nUse the DRAW tools to add markers, lines, areas, circles and range rings."));
    T.annos.forEach(function (a) {
      var row = el("div", "dbm-anno");
      var meta = a.type === "circle" ? M.fmtDist(a.r) : (a.type === "line" || a.type === "measure") ? (a.pts.length + " pts") : a.type === "polygon" ? (a.pts.length + " vtx") : a.type === "rings" ? ((a.radii || []).length + " rings") : "";
      row.innerHTML = '<span class="aswatch" style="background:' + (a.color || "#E8B54A") + '"></span>';
      var nm = el("input", "an"); nm.value = a.name; nm.addEventListener("change", function () { T.rename(a.id, nm.value); });
      var m = el("span", "am", meta), xx = el("button", "ax", "✕"); xx.addEventListener("click", function () { T.remove(a.id); });
      row.appendChild(nm); row.appendChild(m); row.appendChild(xx); list.appendChild(row);
    });
    // Server-saved features — previously listed as an uneditable count only
    // ("N saved features loaded from server (read-only)"). Now individually
    // deletable: each row's ✕ removes just that one feature and persists the
    // change immediately (see T.removeServer). See CLAUDE.md "map drawings"
    // fix — this is what closes the gap Clear-All alone didn't cover.
    if (raw.length) {
      list.appendChild(el("div", "dbm-anno-hdr", "SAVED ON SERVER · " + raw.length));
      raw.forEach(function (f, i) {
        var p = (f.properties) || {};
        var col = (T.colormap && T.colormap[p.user_color]) || p.user_color || p.color || "#E8B54A";
        var label = p.user_label || p.label || p.name || ((f.geometry && f.geometry.type) || "Feature");
        var row = el("div", "dbm-anno dbm-anno-srv");
        row.innerHTML = '<span class="aswatch" style="background:' + col + '"></span>';
        var nm = el("span", "an", label);
        var xx = el("button", "ax", "✕"); xx.addEventListener("click", function () { T.removeServer(i); });
        row.appendChild(nm); row.appendChild(xx); list.appendChild(row);
      });
    }
  };

  /* ============================================================
     REGION MANAGER  (/api/maps/*)
     ============================================================ */
  function buildRegion() {
    if (refs.region) { refs.region.remove(); }
    var p = el("div", "dbm-panel dbm-region");
    var r = S.region || {};
    var sizeMB = r.size_bytes ? Math.round(r.size_bytes / 1048576) : 0;
    var bar = el("div", "rg-bar");
    bar.innerHTML = '<span class="chev">▴</span><span class="rg-name">REGION: ' + (r.name || r.region_id || "—") + "</span>" +
      '<span class="rg-meta">' + (r.bbox ? bboxLabel(r.bbox) : "") + " · " + sizeMB + " MB · z" + (r.minzoom || 0) + "–" + (r.maxzoom || 15) + "</span>";
    p.appendChild(bar);
    var body = el("div", "rg-body"); var inner = el("div", "rg-inner");
    (S.regions || []).forEach(function (rg) { inner.appendChild(regionRow(rg)); });
    body.appendChild(inner); p.appendChild(body); wrap.appendChild(p);
    refs.region = p; refs.regionInner = inner;
    bar.addEventListener("click", function () { p.classList.toggle("open"); });
  }
  function bboxLabel(b) { return "[" + b.map(function (n) { return (+n).toFixed(1); }).join(", ") + "]"; }
  function regionRow(rg) {
    var actv = rg.region_id === S.activeId;
    var r = el("div", "dbm-rgrow" + (actv ? " active" : ""));
    var sizeMB = rg.size_bytes ? Math.round(rg.size_bytes / 1048576) : 0;
    r.innerHTML = '<span class="n">' + (actv ? "▸ " : "") + (rg.name || rg.region_id) + '</span><span class="s">' + sizeMB + " MB · z" + (rg.minzoom || 0) + "–" + (rg.maxzoom || 15) + "</span>";
    var sw = el("button", null, actv ? "ACTIVE" : "SWITCH");
    if (!actv) sw.addEventListener("click", function (e) { e.stopPropagation(); U.toast("SWITCHING TO " + (rg.name || rg.region_id) + " …"); M.swapRegion(rg.region_id); });
    r.appendChild(sw); return r;
  }
  U.updateRegionMeta = function () { /* region bar rebuilt by buildRegion after resolve */ };

  /* ============================================================
     CONTEXT MENU
     ============================================================ */
  function buildContext() { refs.ctx = el("div", "dbm-panel dbm-ctx"); wrap.appendChild(refs.ctx); }
  U.showContext = function (ll, ev) {
    var rect = wrap.getBoundingClientRect(), x = (ev ? ev.clientX : 0) - rect.left, y = (ev ? ev.clientY : 0) - rect.top;
    var items = [
      ["📍", "Drop marker here", function () { T.dropMarker(ll); }],
      ["📏", "Measure from here", function () { T.measureFrom(ll); }],
      ["◎", "Range rings from here", function () { T.ringsFrom(ll); }],
      ["📋", "Copy coordinates", function () { T.copyCoords(ll); }],
      ["⬡", "Send position to Mesh", function () { T.sendMesh(ll); }],
      ["✕", "Close", function () {}]
    ];
    refs.ctx.innerHTML = '<div class="coordline">' + M.mgrsAt(ll.lon, ll.lat, 4) + "<br>" + M.toDec(ll.lat, ll.lon) + "</div>";
    items.forEach(function (it) { var d = el("div", "ci", '<span class="g">' + it[0] + "</span>" + it[1]); d.addEventListener("click", function () { it[2](); U.hideContext(); }); refs.ctx.appendChild(d); });
    refs.ctx.style.left = Math.min(x, rect.width - 210) + "px";
    refs.ctx.style.top = Math.min(y, rect.height - 220) + "px";
    refs.ctx.classList.add("show");
  };
  U.hideContext = function () { if (refs.ctx) refs.ctx.classList.remove("show"); };
  // popups handled natively by MapLibre — these are no-ops kept for the tools API
  U.showPopup = function () {}; U.hidePopup = function () {};

  /* ============================================================
     CURSOR READOUT  (bottom-right)
     ============================================================ */
  function buildReadout() {
    var ro = el("div", "dbm-readout");
    ro.innerHTML = '<div class="ln l1"><span class="k">MGRS </span><span class="v">—</span></div><div class="ln l2">—</div><div class="reg" id="dbm-reg">REGION: ' + ((S.region && (S.region.name || S.region.region_id)) || "—") + "</div>";
    wrap.appendChild(ro); refs.ro = ro;
  }
  U.onCursor = function (lngLat) {
    if (!refs.ro) return;
    var l1 = refs.ro.querySelector(".l1"), l2 = refs.ro.querySelector(".l2"), reg = refs.ro.querySelector(".reg");
    if (!lngLat) { return; }
    var lat = lngLat.lat, lon = lngLat.lng;
    if (U._cursorMgrs && U._fmt === "MGRS") { l1.style.display = ""; l1.querySelector(".k").textContent = "MGRS "; l1.querySelector(".v").textContent = M.mgrsAt(lon, lat, 4); }
    else if (U._cursorMgrs && U._fmt === "DMS") { l1.style.display = ""; l1.querySelector(".k").textContent = "DMS "; l1.querySelector(".v").textContent = toDMS(lat, lon); }
    else l1.style.display = "none";
    l2.textContent = M.toDec(lat, lon);
    if (reg) reg.textContent = "REGION: " + ((S.region && (S.region.name || S.region.region_id)) || "—") + "  ·  Z" + (M.getMap() ? M.getMap().getZoom().toFixed(1) : "—");
  };
  function toDMS(lat, lon) {
    function f(v, pos, neg) { var h = v < 0 ? neg : pos; v = Math.abs(v); var d = Math.floor(v), mi = Math.floor((v - d) * 60), s = ((v - d) * 60 - mi) * 60; return d + "°" + String(mi).padStart(2, "0") + "'" + s.toFixed(1) + '"' + h; }
    return f(lat, "N", "S") + " " + f(lon, "E", "W");
  }

  /* ============================================================
     INSTRUCTION / TOAST / FULLSCREEN
     ============================================================ */
  function buildInstruct() { refs.instruct = el("div", "dbm-instruct"); wrap.appendChild(refs.instruct); }
  U.setInstruction = function (txt) { if (!refs.instruct) return; if (txt) { refs.instruct.textContent = txt; refs.instruct.classList.add("show"); } else refs.instruct.classList.remove("show"); };
  function buildToast() { refs.toast = el("div", "dbm-toast"); wrap.appendChild(refs.toast); }
  U.toast = function (msg) { var t = refs.toast; if (!t) return; t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("show"); }, 2200); };
  function buildExitFull() { var b = el("button", "dbm-exit-full", "⧉  EXIT FULLSCREEN"); b.addEventListener("click", function () { T.toggleFull(); }); wrap.appendChild(b); }

})(window.DBMap);
