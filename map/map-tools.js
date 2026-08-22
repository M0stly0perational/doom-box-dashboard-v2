/* ============================================================
   DOOM BOX V2 — MAP TOOLS  (REAL drawing + measurement)
   point / line / polygon / circle / freehand / measure / range-rings
   rendered as a MapLibre GeoJSON overlay. Loads existing annotations
   from GET /api/drawings (read), persists new ones to localStorage,
   and merges+POSTs to /api/drawings on Save. Right-click context menu,
   coordinate copy, fullscreen, search-pulse marker.
   Attaches to window.DBMap (M.tools).
   ============================================================ */
window.DBMap = window.DBMap || {};
(function (M) {
  "use strict";
  var S = M.state, AMBER = "#E8B54A", LS = "db_map_anno";
  function map() { return M.getMap(); }

  var T = M.tools = { current: "pan", annos: [], draft: null, _circleCenter: null, _freehand: false, marker: null, serverFeatures: [], serverRaw: [] };
  var _draftOverlay = null, _lpTimer = null;

  /* ---------------- persistence ---------------- */
  function save() { try { localStorage.setItem(LS, JSON.stringify(T.annos)); } catch (e) {} }
  (function load() { try { var v = localStorage.getItem(LS); if (v) T.annos = JSON.parse(v) || []; } catch (e) { T.annos = []; } })();
  var nid = T.annos.reduce(function (m, a) { return Math.max(m, a.id || 0); }, 0);
  function newId() { return ++nid; }

  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m"; }
  M.fmtDist = fmtDist;
  function centroid(pts) { var x = 0, y = 0; pts.forEach(function (p) { x += p.lat; y += p.lon; }); return { lat: x / pts.length, lon: y / pts.length }; }

  /* ---------------- GeoJSON conversion + render ---------------- */
  function ll(p) { return [p.lon, p.lat]; }
  function ring64(c, rMeters) {
    var out = [], R = 6371000, lat1 = c.lat * Math.PI / 180, lon1 = c.lon * Math.PI / 180, dr = rMeters / R;
    for (var i = 0; i <= 64; i++) {
      var b = (i / 64) * 2 * Math.PI;
      var lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(b));
      var lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2));
      out.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
    }
    return out;
  }
  // anno -> array of render features (rkind: area|stroke|node|label)
  function annoFeatures(a) {
    var col = a.color || AMBER, out = [];
    function F(geom, rkind, extra) { return { type: "Feature", geometry: geom, properties: Object.assign({ rkind: rkind, color: col, anno_id: a.id }, extra || {}) }; }
    if (a.type === "point") {
      out.push(F({ type: "Point", coordinates: ll(a.pts[0]) }, "node"));
      if (a.name) out.push(F({ type: "Point", coordinates: ll(a.pts[0]) }, "label", { text: a.name }));
    } else if (a.type === "line" || a.type === "measure" || a.type === "freehand") {
      out.push(F({ type: "LineString", coordinates: a.pts.map(ll) }, "stroke"));
      a.pts.forEach(function (p) { out.push(F({ type: "Point", coordinates: ll(p) }, "node")); });
      if (a.pts.length >= 2 && a.type !== "freehand") {
        var tot = 0; for (var i = 1; i < a.pts.length; i++) tot += M.haversine(a.pts[i - 1], a.pts[i]);
        var txt = fmtDist(tot);
        if (a.type === "measure") { var brg = M.bearingDeg(a.pts[0], a.pts[a.pts.length - 1]); txt += " · " + String(Math.round(brg)).padStart(3, "0") + "°"; }
        out.push(F({ type: "Point", coordinates: ll(a.pts[a.pts.length - 1]) }, "label", { text: txt }));
      }
    } else if (a.type === "polygon") {
      var rng = a.pts.map(ll); if (rng.length) rng.push(rng[0]);
      out.push(F({ type: "Polygon", coordinates: [rng] }, "area"));
      out.push(F({ type: "LineString", coordinates: rng }, "stroke"));
      if (a.name && a.pts.length >= 3) out.push(F({ type: "Point", coordinates: ll(centroid(a.pts)) }, "label", { text: a.name }));
    } else if (a.type === "circle") {
      var rc = ring64(a.pts[0], a.r);
      out.push(F({ type: "Polygon", coordinates: [rc] }, "area"));
      out.push(F({ type: "LineString", coordinates: rc }, "stroke"));
      out.push(F({ type: "Point", coordinates: ll(a.pts[0]) }, "node"));
      out.push(F({ type: "Point", coordinates: rc[8] }, "label", { text: "R " + fmtDist(a.r) }));
    } else if (a.type === "rings") {
      out.push(F({ type: "Point", coordinates: ll(a.pts[0]) }, "node"));
      (a.radii || []).forEach(function (rm) {
        out.push(F({ type: "LineString", coordinates: ring64(a.pts[0], rm) }, "stroke"));
        out.push(F({ type: "Point", coordinates: ring64(a.pts[0], rm)[16] }, "label", { text: fmtDist(rm) }));
      });
    }
    return out;
  }
  function buildFc() {
    var feats = [];
    T.serverFeatures.forEach(function (f) { feats.push(f); });   // existing saved annotations (read)
    T.annos.forEach(function (a) { annoFeatures(a).forEach(function (f) { feats.push(f); }); });
    // draft preview
    if (T.draft) draftFeatures().forEach(function (f) { feats.push(f); });
    return { type: "FeatureCollection", features: feats };
  }
  function draftFeatures() {
    var d = T.draft, cur = S.cursor.on ? { lat: S.cursor.lat, lon: S.cursor.lon } : null;
    if ((d.type === "line" || d.type === "polygon" || d.type === "measure") && cur) {
      return annoFeatures({ id: -1, type: d.type, pts: d.pts.concat([cur]), color: "rgba(232,181,74,0.7)" });
    }
    if (d.type === "circle" && T._circleCenter && cur) {
      return annoFeatures({ id: -1, type: "circle", pts: [T._circleCenter], r: M.haversine(T._circleCenter, cur), color: "rgba(232,181,74,0.7)" });
    }
    if (d.type === "freehand") return annoFeatures({ id: -1, type: "freehand", pts: d.pts, color: "rgba(232,181,74,0.7)" });
    return [];
  }
  function redraw() { var mp = map(); var src = mp && mp.getSource("db-draw"); if (src) src.setData(buildFc()); updateDraftUI(); }
  M._drawRedraw = redraw;

  /* ---------------- map setup (on ready) ---------------- */
  M.onReady(function (mp) {
    if (!mp.getSource("db-draw")) mp.addSource("db-draw", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    function add(layer) { if (!mp.getLayer(layer.id)) mp.addLayer(layer); }
    add({ id: "db-draw-area", type: "fill", source: "db-draw", filter: ["==", ["get", "rkind"], "area"], paint: { "fill-color": ["coalesce", ["get", "color"], AMBER], "fill-opacity": 0.10 } });
    add({ id: "db-draw-stroke", type: "line", source: "db-draw", filter: ["==", ["get", "rkind"], "stroke"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["coalesce", ["get", "color"], AMBER], "line-width": 1.8 } });
    add({ id: "db-draw-node", type: "circle", source: "db-draw", filter: ["==", ["get", "rkind"], "node"], paint: { "circle-radius": 3.4, "circle-color": ["coalesce", ["get", "color"], AMBER], "circle-stroke-width": 1, "circle-stroke-color": "#0b0f10" } });
    add({ id: "db-draw-label", type: "symbol", source: "db-draw", filter: ["==", ["get", "rkind"], "label"], layout: { "text-field": ["coalesce", ["get", "text"], ""], "text-font": ["Noto Sans Medium"], "text-size": 11, "text-offset": [0, -1.1], "text-anchor": "bottom", "text-allow-overlap": true }, paint: { "text-color": AMBER, "text-halo-color": "#12121e", "text-halo-width": 1.6 } });

    // input handlers
    mp.on("click", onClick);
    mp.on("mousemove", function () { if (T.draft) redraw(); });
    mp.on("contextmenu", onContext);
    mp.getCanvas().addEventListener("contextmenu", function (e) { e.preventDefault(); });

    loadServer();
    redraw();

    // DONE/CANCEL overlay for touch drawing finish
    var mapEl = mp.getContainer();
    _draftOverlay = document.createElement("div");
    _draftOverlay.className = "dbm-draft-actions";
    _draftOverlay.innerHTML =
      '<button class="dbm-draft-btn done" id="dbmDraftDone">✓ DONE</button>'+
      '<button class="dbm-draft-btn cancel" id="dbmDraftCancel">× CANCEL</button>';
    mapEl.appendChild(_draftOverlay);
    _draftOverlay.querySelector("#dbmDraftDone").addEventListener("click", function(e){ e.stopPropagation(); finishDraft(); });
    _draftOverlay.querySelector("#dbmDraftCancel").addEventListener("click", function(e){ e.stopPropagation(); T.cancelDraft(); });

    // Long-press on map canvas (600ms) — equivalent of right-click to finish line/polygon
    mp.getCanvas().addEventListener("touchstart", function(e){
      if(e.touches.length !== 1) return;
      var touch = e.touches[0];
      _lpTimer = setTimeout(function(){
        var rect = mp.getCanvas().getBoundingClientRect();
        try {
          var ll = mp.unproject([touch.clientX - rect.left, touch.clientY - rect.top]);
          onContext({ lngLat: { lat: ll.lat, lng: ll.lng }, originalEvent: e });
        } catch(err) {}
      }, 600);
    }, { passive: true });
    mp.getCanvas().addEventListener("touchmove", function(){ clearTimeout(_lpTimer); _lpTimer = null; }, { passive: true });
    mp.getCanvas().addEventListener("touchend", function(){ clearTimeout(_lpTimer); _lpTimer = null; }, { passive: true });
  });

  function onClick(e) {
    var t = T.current, llp = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    if (!CLICK_TOOLS[t]) { hideContext(); return; }
    if (t === "point") { commit({ type: "point", pts: [llp] }); return; }
    if (t === "rings") { commit({ type: "rings", pts: [llp], radii: [500, 1000, 2000, 5000] }); return; }
    if (t === "circle") {
      if (!T._circleCenter) { T._circleCenter = llp; T.draft = { type: "circle", pts: [llp], r: 0 }; }
      else { commit({ type: "circle", pts: [T._circleCenter], r: M.haversine(T._circleCenter, llp) }); T._circleCenter = null; T.draft = null; }
      redraw(); return;
    }
    if (t === "freehand") {
      if (!T._freehand) { T._freehand = true; T.draft = { type: "freehand", pts: [llp] }; }
      else { T.draft.pts.push(llp); commit(T.draft); T._freehand = false; T.draft = null; }
      redraw(); return;
    }
    if (!T.draft) T.draft = { type: t, pts: [] };
    T.draft.pts.push(llp); redraw();
  }
  function onContext(e) {
    if (T.draft && (T.draft.type === "line" || T.draft.type === "polygon" || T.draft.type === "measure")) { finishDraft(); return; }
    if (M.ui) M.ui.showContext({ lat: e.lngLat.lat, lon: e.lngLat.lng }, e.originalEvent);
  }
  // freehand sampling while active
  M.onReady(function (mp) {
    mp.on("mousemove", function (e) {
      if (!T._freehand || !T.draft) return;
      var cur = { lat: e.lngLat.lat, lon: e.lngLat.lng }, last = T.draft.pts[T.draft.pts.length - 1];
      if (!last || M.haversine(last, cur) > 8) { T.draft.pts.push(cur); redraw(); }
    });
  });

  var CLICK_TOOLS = { point: 1, line: 1, polygon: 1, circle: 1, freehand: 1, measure: 1, rings: 1 };
  var INSTRUCT = {
    line: "TAP TO PLACE POINTS · TAP ✓ DONE OR HOLD TO FINISH · TAP × TO CANCEL",
    polygon: "TAP TO PLACE POINTS · TAP ✓ DONE OR HOLD TO FINISH · TAP × TO CANCEL",
    measure: "TAP TO ADD LEGS · TAP ✓ DONE OR HOLD TO FINISH · TAP × TO CANCEL",
    circle: "TAP CENTER · TAP AGAIN FOR RADIUS · TAP × TO CANCEL",
    freehand: "TAP START · DRAG · RELEASE TO FINISH",
    point: "TAP TO DROP A POINT MARKER · TAP × TO EXIT",
    rings: "TAP TO PLACE RANGE RINGS · TAP × TO EXIT"
  };
  T.setTool = function (name) {
    T.cancelDraft();
    T.current = name;
    var mp = map();
    if (mp) { mp.getCanvas().style.cursor = CLICK_TOOLS[name] ? "crosshair" : ""; mp.boxZoom[ name === "pan" ? "enable" : "disable" ](); }
    if (M.ui) { M.ui.highlightTool(name); M.ui.setInstruction(INSTRUCT[name] || null); }
  };
  T.cancelDraft = function () { T.draft = null; T._circleCenter = null; T._freehand = false; redraw(); if (M.ui) M.ui.setInstruction(INSTRUCT[T.current] || null); };
  function finishDraft() {
    if (!T.draft) return;
    if (T.draft.pts.length < 2) { T.draft = null; redraw(); return; }
    commit(T.draft); T.draft = null;
    if (M.ui) M.ui.setInstruction(INSTRUCT[T.current] || null);
  }
  T.finishDraft = finishDraft;
  function updateDraftUI() {
    if (!_draftOverlay) return;
    var finishable = T.draft && (T.draft.type === "line" || T.draft.type === "polygon" || T.draft.type === "measure");
    _draftOverlay.classList.toggle("visible", !!finishable);
    var doneBtn = _draftOverlay.querySelector("#dbmDraftDone");
    if (doneBtn) doneBtn.disabled = !(finishable && T.draft.pts && T.draft.pts.length >= 2);
  }
  function commit(a) {
    a.id = newId(); a.color = a.color || AMBER; a.name = a.name || defaultName(a);
    T.annos.push(a); save(); redraw();
    if (M.ui) M.ui.refreshAnnos();
  }
  function defaultName(a) {
    var n = T.annos.filter(function (x) { return x.type === a.type; }).length + 1;
    return ({ point: "POINT", line: "LINE", polygon: "AREA", circle: "CIRCLE", freehand: "SKETCH", measure: "MEASURE", rings: "RINGS" }[a.type] || "ANNO") + " " + String(n).padStart(2, "0");
  }

  /* ---------------- context-menu actions ---------------- */
  function hideContext() { if (M.ui) M.ui.hideContext(); }
  T.dropMarker = function (ll) { commit({ type: "point", pts: [ll] }); };
  T.measureFrom = function (ll) { T.setTool("measure"); T.draft = { type: "measure", pts: [ll] }; redraw(); };
  T.ringsFrom = function (ll) { commit({ type: "rings", pts: [ll], radii: [500, 1000, 2000, 5000] }); };
  T.copyCoords = function (ll) {
    var txt = M.mgrsAt(ll.lon, ll.lat, 4) + "  /  " + M.toDec(ll.lat, ll.lon);
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(function () {});
    if (M.ui) M.ui.toast("COPIED · " + txt);
  };
  T.sendMesh = function (ll) { if (M.ui) M.ui.toast("POSITION · " + M.mgrsAt(ll.lon, ll.lat, 4)); };

  /* ---------------- annotation management ---------------- */
  T.undo = function () { T.annos.pop(); save(); redraw(); if (M.ui) M.ui.refreshAnnos(); };
  T.clearAll = function () {
    // Previously this only ever reset T.annos (this browser's own session
    // drawings) and never touched T.serverFeatures or persisted anything to
    // /api/drawings — so shapes saved from any session (including old ones
    // from months back) could never actually be cleared, and the button
    // silently no-op'd whenever there were no new local drawings to wipe.
    // See CLAUDE.md "map drawings not clearing" fix.
    var n = T.annos.length + T.serverRaw.length;
    if (!n) { if (M.ui) M.ui.toast("NOTHING TO CLEAR"); return; }
    if (!window.confirm("Clear ALL " + n + " annotation(s)? This removes drawings saved by every operator/session, not just this one, and cannot be undone.")) return;
    T.annos = []; T.serverRaw = []; T.serverFeatures = []; save(); redraw();
    if (M.ui) { M.ui.refreshAnnos(); M.ui.toast("CLEARING…"); }
    fetch("/api/drawings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "FeatureCollection", features: [] }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (M.ui) M.ui.toast(j && j.ok ? "ALL ANNOTATIONS CLEARED" : "SERVER CLEAR FAILED — reload to check"); })
      .catch(function () { if (M.ui) M.ui.toast("SERVER CLEAR FAILED — reload to check"); });
  };
  T.remove = function (id) { T.annos = T.annos.filter(function (a) { return a.id !== id; }); save(); redraw(); if (M.ui) M.ui.refreshAnnos(); };
  T.rename = function (id, name) { var a = T.annos.filter(function (x) { return x.id === id; })[0]; if (a) { a.name = name; save(); redraw(); } };
  T.setMarker = function (lat, lon) {
    var mp = map(); if (!mp) return; T.clearMarker();
    var el = document.createElement("div");
    el.style.cssText = "width:22px;height:22px;border:2px solid #E8B54A;border-radius:50%;background:rgba(232,181,74,0.18);box-shadow:0 0 12px rgba(232,181,74,0.6);pointer-events:none;animation:dbm-pulse 1.2s ease-out infinite;";
    T.marker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(mp);
  };
  T.clearMarker = function () { if (T.marker) { T.marker.remove(); T.marker = null; } };

  /* ---------------- server drawings (GET load + POST save) ---------------- */
  // T.serverRaw holds the ORIGINAL features exactly as received from
  // /api/drawings — this is what gets round-tripped back on save/delete.
  // T.serverFeatures is a derived, render-only explosion of those (a Polygon
  // becomes both an "area" and a "stroke" sub-feature) for buildFc() to draw;
  // it must never be persisted directly — a previous version of saveServer()
  // did exactly that, which silently duplicated polygons and dropped
  // user_label/user_color on every save. Each render sub-feature carries
  // srv_idx back to its origin in T.serverRaw so per-feature delete works.
  function loadServer() {
    fetch("/api/drawings", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (fc) {
      if (!fc || !Array.isArray(fc.features)) return;
      T.serverRaw = fc.features.filter(function (f) { return f && f.geometry; });
      rebuildServerRender();
      redraw();
      if (M.ui) M.ui.refreshAnnos();
    }).catch(function () {});
  }
  function rebuildServerRender() {
    var out = [];
    T.serverRaw.forEach(function (f, i) {
      var col = (f.properties && (f.properties.user_color || f.properties.color)) || AMBER;
      col = COLORMAP[col] || col;
      var gt = f.geometry.type;
      if (gt === "Point") {
        out.push({ type: "Feature", geometry: f.geometry, properties: { rkind: "node", color: col, srv_idx: i } });
        var lbl = f.properties && (f.properties.user_label || f.properties.label || f.properties.name);
        if (lbl) out.push({ type: "Feature", geometry: f.geometry, properties: { rkind: "label", text: lbl, color: col, srv_idx: i } });
      } else if (gt === "LineString" || gt === "MultiLineString") {
        out.push({ type: "Feature", geometry: f.geometry, properties: { rkind: "stroke", color: col, srv_idx: i } });
      } else if (gt === "Polygon" || gt === "MultiPolygon") {
        out.push({ type: "Feature", geometry: f.geometry, properties: { rkind: "area", color: col, srv_idx: i } });
        out.push({ type: "Feature", geometry: f.geometry, properties: { rkind: "stroke", color: col, srv_idx: i } });
      }
    });
    T.serverFeatures = out;
  }
  var COLORMAP = { red: "#EE4444", orange: "#CC5511", yellow: "#E8D24A", green: "#5DD87A", blue: "#5EB8E8", purple: "#B08CF0", white: "#fff" };
  T.colormap = COLORMAP;
  // POST merged (original server features, unmodified, + our annos as V1-compatible features).
  T.saveServer = function () {
    var feats = T.serverRaw.slice();   // keep existing on disk, UNMODIFIED originals
    T.annos.forEach(function (a) {
      annoFeatures(a).filter(function (f) { return f.properties.rkind !== "label" && f.properties.rkind !== "area"; })
        .forEach(function (f) { f.properties = { user_color: a.color, user_label: a.name, v2: true }; feats.push(f); });
    });
    return fetch("/api/drawings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "FeatureCollection", features: feats }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (M.ui) M.ui.toast(j && j.ok ? "SAVED · " + (j.count != null ? j.count + " features" : "ok") : "SAVE FAILED"); return j; })
      .catch(function () { if (M.ui) M.ui.toast("SAVE FAILED"); });
  };
  // Delete one saved (server-side) feature by its T.serverRaw index, then
  // persist immediately — like clearAll, a no-op deferred to "Save" would
  // just come back on next load.
  T.removeServer = function (idx) {
    if (!T.serverRaw[idx]) return;
    if (!window.confirm("Delete this saved annotation? This removes it for every operator/session and cannot be undone.")) return;
    T.serverRaw.splice(idx, 1);
    rebuildServerRender();
    redraw();
    if (M.ui) M.ui.refreshAnnos();
    T.saveServer();
  };

  /* ---------------- fullscreen + keys ---------------- */
  T.toggleFull = function () {
    document.body.classList.toggle("map-full");
    var on = document.body.classList.contains("map-full");
    setTimeout(function () { var mp = map(); if (mp) mp.resize(); }, 80);
    if (M.ui) M.ui.highlightTool(T.current);
    return on;
  };
  document.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === "Escape") {
      if (document.body.classList.contains("map-full")) { document.body.classList.remove("map-full"); setTimeout(function () { var mp = map(); if (mp) mp.resize(); }, 80); }
      T.cancelDraft(); if (M.ui) { M.ui.hidePopup(); M.ui.hideContext(); }
    }
  });

})(window.DBMap);
