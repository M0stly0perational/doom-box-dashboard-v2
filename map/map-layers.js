/* ============================================================
   DOOM BOX V2 — MAP LAYERS  (REAL overlays)
   Crime heatmap + CFS incidents, NWS weather-alert polygons, and
   the 12 POI categories — all from live Node-RED endpoints / local
   GeoJSON+PMTiles. Plus the tactical-overlay registry the layers
   panel renders. Ported from V1 js/map.js (crime) + js/poi.js.
   Attaches to window.DBMap (M.layers, M.LAYERS).
   ============================================================ */
window.DBMap = window.DBMap || {};
(function (M) {
  "use strict";
  var S = M.state;
  var V1 = "/dashboard";
  var ORIGIN = window.location.origin;
  function map() { return M.getMap(); }
  function regionId() { return S.activeId || "lasvegas"; }

  /* ============================================================
     POI category recipes  (port of V1 js/poi.js)
     ============================================================ */
  var SPRITE = V1 + "/sprites/poi/";
  var POI = {
    cell_towers: { label: "Cell towers", icons: ["tower"], layers: [{ kind: "icon", filter: ["==", ["geometry-type"], "Point"], icon: "tower" }] },
    power: { label: "Power infra", icons: ["lightning"], layers: [
      { kind: "fill", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#fee090", "fill-opacity": 0.18, "fill-outline-color": "#fee090" } },
      { kind: "line", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#fee090", "line-width": 1.4, "line-opacity": 0.85, "line-dasharray": [2, 1] } },
      { kind: "icon", filter: ["==", ["geometry-type"], "Point"], icon: "lightning" } ] },
    railroads: { label: "Railroads", icons: [], layers: [{ kind: "line", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#c8d0d6", "line-width": 1.6, "line-dasharray": [3, 2] } }] },
    airports: { label: "Airports & helipads", icons: ["plane", "helipad"], layers: [
      { kind: "fill", filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "aeroway", ["get", "tags"]], "aerodrome"]], paint: { "fill-color": "#7eb8d6", "fill-opacity": 0.10, "fill-outline-color": "#7eb8d6" } },
      { kind: "line", filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "aeroway", ["get", "tags"]], "runway"]], paint: { "line-color": "#f0f0f0", "line-width": 2 } },
      { kind: "icon", filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "aeroway", ["get", "tags"]], "helipad"]], icon: "helipad" },
      { kind: "icon", filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "aeroway", ["get", "tags"]], "aerodrome"]], icon: "plane" } ] },
    military: { label: "Military", icons: [], layers: [{ kind: "fill", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#d73027", "fill-opacity": 0.18, "fill-outline-color": "#d73027" } }] },
    hospitals: { label: "Hospitals", icons: ["cross"], layers: [
      { kind: "fill", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#d73027", "fill-opacity": 0.10, "fill-outline-color": "#d73027" } },
      { kind: "icon", filter: ["==", ["geometry-type"], "Point"], icon: "cross" } ] },
    fire_stations: { label: "Fire stations", icons: ["flame"], layers: [
      { kind: "fill", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#f46d43", "fill-opacity": 0.10, "fill-outline-color": "#f46d43" } },
      { kind: "icon", filter: ["==", ["geometry-type"], "Point"], icon: "flame" } ] },
    police: { label: "Police", icons: ["shield"], layers: [
      { kind: "fill", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#4fa3d0", "fill-opacity": 0.10, "fill-outline-color": "#4fa3d0" } },
      { kind: "icon", filter: ["==", ["geometry-type"], "Point"], icon: "shield" } ] },
    fuel: { label: "Fuel", icons: ["pump"], layers: [{ kind: "icon", filter: ["==", ["geometry-type"], "Point"], icon: "pump", minzoom: 12 }] },
    water: { label: "Water treatment", icons: ["drop"], layers: [
      { kind: "fill", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#6ad27a", "fill-opacity": 0.12, "fill-outline-color": "#6ad27a" } },
      { kind: "icon", filter: ["==", ["geometry-type"], "Point"], icon: "drop" } ] },
    flood_zones: { label: "FEMA flood zones", icons: [], format: "pmtiles", sourceLayer: "flood_zones", minzoom: 6, layers: [
      { kind: "fill", filter: null, sourceLayer: "flood_zones", paint: {
        "fill-color": ["match", ["get", "FLD_ZONE"], ["A", "AE", "AH", "AO", "AR", "A99"], "#4fa3d0", ["V", "VE"], "#8a4fbf", ["X", "D"], "#fbb03b", "#7eb8d6"],
        "fill-opacity": 0.32, "fill-outline-color": "#0b0f10" } }] },
    bridges: { label: "Bridges", icons: [], layers: [{ kind: "line", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#f0f0f0", "line-width": 3, "line-opacity": 0.9 } }] }
  };
  var POI_ORDER = ["cell_towers", "power", "railroads", "airports", "military", "hospitals", "fire_stations", "police", "fuel", "water", "flood_zones", "bridges"];

  /* ============================================================
     LAYER REGISTRY  (drives the layers panel)
     ============================================================ */
  var REG = [
    { id: "self", g: "LIVE TACTICAL", label: "DOOM BOX (Self Position)", src: "GPS / Mesh", kind: "entity" },
    { id: "tak",  g: "LIVE TACTICAL", label: "TAK / ATAK Units", src: "FTS CoT", kind: "entity" },
    { id: "adsb", g: "LIVE TACTICAL", label: "ADS-B Aircraft",   src: "dump1090", kind: "entity" },
    { id: "mesh", g: "LIVE TACTICAL", label: "Mesh Node Positions", src: "Meshtastic", kind: "entity" },
    { id: "crime_heat", g: "INTELLIGENCE / THREAT", label: "Crime Heatmap", src: "LVMPD NIBRS", kind: "crime" },
    { id: "crime_cfs",  g: "INTELLIGENCE / THREAT", label: "Crime Incidents", src: "CFS", kind: "crime" },
    { id: "wx_alerts",  g: "INTELLIGENCE / THREAT", label: "NWS Alert Polygons", src: "NWS", kind: "wx" },
    { id: "gdelt",      g: "GLOBAL INTEL", label: "Battle Arcs",        src: "GDELT v2",   kind: "intel", ctype: "gdelt" },
    { id: "usgs",       g: "GLOBAL INTEL", label: "USGS Earthquakes",   src: "USGS",       kind: "intel", ctype: "usgs" },
    { id: "gdacs",      g: "GLOBAL INTEL", label: "GDACS Disasters",    src: "GDACS",      kind: "intel", ctype: "gdacs" },
    { id: "tfrs",       g: "GLOBAL INTEL", label: "FAA TFRs",           src: "FAA",        kind: "intel", ctype: "tfrs" },
    { id: "satpasses",       g: "GLOBAL INTEL", label: "Sat Passes",            src: "SatNOGS",    kind: "intel", ctype: "satpasses" },
    { id: "firms",           g: "GLOBAL INTEL", label: "FIRMS Active Fires",    src: "NASA FIRMS", kind: "intel", ctype: "firms" },
    { id: "conflict_zones",  g: "GLOBAL INTEL", label: "Conflict Zones",         src: "GDELT v2",  kind: "intel", ctype: "conflict-zones" }
  ];
  POI_ORDER.forEach(function (cid) { REG.push({ id: "poi_" + cid, g: "POINTS OF INTEREST", label: POI[cid].label, src: "OSM / HIFLD", kind: "poi", cid: cid }); });
  M.LAYERS = REG;
  M.layerById = {}; REG.forEach(function (l) { M.layerById[l.id] = l; });

  // active state, persisted; absent = OFF (default-off requirement)
  var active = {};
  REG.forEach(function (l) { active[l.id] = localStorage.getItem("db_map_layer_" + l.id) === "1"; });
  // keep entity active flags in sync with core's own restore
  active.self = S.entity.self; active.tak = S.entity.tak; active.adsb = S.entity.adsb; active.mesh = S.entity.mesh;

  /* ============================================================
     CRIME  (port of V1 addCrimeHeatmap / addCrimeCfsDots)
     ============================================================ */
  var crimeReady = { heat: false, cfs: false };
  function addCrimeHeat() {
    var mp = map(); if (!mp || crimeReady.heat) return;
    // Tiled by crime-fetcher (tippecanoe -> pmtiles) after every refresh — was a
    // single 54MB/124k-feature GeoJSON blob loaded whole on every map load.
    // CFS pins below are unaffected; that source stays small GeoJSON as-is.
    if (!mp.getSource("crime-nibrs")) mp.addSource("crime-nibrs", { type: "vector", url: "pmtiles://" + ORIGIN + V1 + "/data/crime/nibrs.pmtiles" });
    mp.addLayer({
      id: "crime-heatmap", type: "heatmap", source: "crime-nibrs", "source-layer": "crimes", maxzoom: 15, layout: { visibility: "none" },
      paint: {
        "heatmap-weight": ["case", ["==", ["get", "ViolentCrime"], "Yes"], 0.6, 0.3],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.15, 10, 0.30, 13, 0.70, 15, 1.20],
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(11,15,16,0)", 0.30, "#2166ac", 0.55, "#74add1", 0.78, "#fee090", 0.92, "#f46d43", 1.00, "#d73027"],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 5, 2, 10, 6, 12, 14, 15, 30],
        "heatmap-opacity": 0.7
      }
    });
    crimeReady.heat = true;
  }
  function addCrimeCfs() {
    var mp = map(); if (!mp || crimeReady.cfs) return;
    if (!mp.getSource("crime-cfs")) mp.addSource("crime-cfs", { type: "geojson", data: V1 + "/data/crime/cfs-recent.geojson" });
    mp.addLayer({
      id: "crime-cfs-dots", type: "circle", source: "crime-cfs", layout: { visibility: "none" },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 12, 5, 16, 8],
        "circle-color": ["match", ["get", "category"], "shoot", "#d73027", "robbery", "#f46d43", "weapon", "#fee090", "assault", "#4fa3d0", "#8a9499"],
        "circle-stroke-width": 1, "circle-stroke-color": "#0b0f10", "circle-opacity": 0.95
      }
    });
    mp.on("click", "crime-cfs-dots", function (e) {
      var f = e.features && e.features[0]; if (!f) return; var p = f.properties || {};
      var t = p.IncidentDate ? new Date(p.IncidentDate) : null;
      var tStr = t ? (t.toLocaleDateString() + " " + t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) : "—";
      var desc = p.IncidentTypeDescription || p.Classification || "incident";
      new maplibregl.Popup({ offset: 10, closeButton: true }).setLngLat(f.geometry.coordinates)
        .setHTML('<div style="color:#111;min-width:200px;line-height:1.3"><b>' + M.escapeHtml(desc) + '</b><br><small>' + M.escapeHtml(tStr) + '<br>' + M.escapeHtml(p.Address || "") + '</small></div>').addTo(mp);
    });
    mp.on("mouseenter", "crime-cfs-dots", function () { mp.getCanvas().style.cursor = "pointer"; });
    mp.on("mouseleave", "crime-cfs-dots", function () { mp.getCanvas().style.cursor = ""; });
    crimeReady.cfs = true;
  }
  function setCrime(id, on) {
    var mp = map(); if (!mp) return;
    if (id === "crime_heat") { addCrimeHeat(); if (mp.getLayer("crime-heatmap")) mp.setLayoutProperty("crime-heatmap", "visibility", on ? "visible" : "none"); }
    else { addCrimeCfs(); if (mp.getLayer("crime-cfs-dots")) mp.setLayoutProperty("crime-cfs-dots", "visibility", on ? "visible" : "none"); }
  }

  /* ============================================================
     WEATHER ALERT POLYGONS  (from /api/wx/state)
     ============================================================ */
  var wxReady = false;
  var SEV = { Extreme: "#7B0066", Severe: "#d73027", Moderate: "#f46d43", Minor: "#fbb03b", Unknown: "#8a9499" };
  function buildWxFc(state) {
    var feats = [];
    var alerts = (state && state.alerts && state.alerts.active) || [];
    alerts.forEach(function (a) {
      if (!a.geometry) return;   // zone-only alerts have null geometry — skipped in v1
      feats.push({ type: "Feature", geometry: a.geometry, properties: { event: a.event || "Alert", severity: a.severity || "Unknown", headline: a.headline || "", expires: a.expires || "", sev_color: SEV[a.severity] || SEV.Unknown } });
    });
    return { type: "FeatureCollection", features: feats };
  }
  function addWx() {
    var mp = map(); if (!mp || wxReady) return Promise.resolve();
    return fetch("/api/wx/state", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (st) {
      var fc = buildWxFc(st);
      if (!mp.getSource("wx-alerts")) mp.addSource("wx-alerts", { type: "geojson", data: fc });
      mp.addLayer({ id: "wx-alert-fill", type: "fill", source: "wx-alerts", layout: { visibility: "none" }, paint: { "fill-color": ["get", "sev_color"], "fill-opacity": 0.18 } });
      mp.addLayer({ id: "wx-alert-line", type: "line", source: "wx-alerts", layout: { visibility: "none" }, paint: { "line-color": ["get", "sev_color"], "line-width": 1.6 } });
      mp.on("click", "wx-alert-fill", function (e) {
        var f = e.features && e.features[0]; if (!f) return; var p = f.properties || {};
        new maplibregl.Popup({ offset: 8, closeButton: true }).setLngLat(e.lngLat)
          .setHTML('<div style="color:#111;min-width:220px;line-height:1.35"><b>' + M.escapeHtml(p.event) + '</b> <small>(' + M.escapeHtml(p.severity) + ')</small><br><small>' + M.escapeHtml(p.headline || "") + (p.expires ? "<br>expires " + M.escapeHtml(p.expires) : "") + '</small></div>').addTo(mp);
      });
      mp.on("mouseenter", "wx-alert-fill", function () { mp.getCanvas().style.cursor = "pointer"; });
      mp.on("mouseleave", "wx-alert-fill", function () { mp.getCanvas().style.cursor = ""; });
      wxReady = true;
    }).catch(function () {});
  }
  function setWx(on) {
    Promise.resolve(addWx()).then(function () {
      var mp = map(); if (!mp) return;
      ["wx-alert-fill", "wx-alert-line"].forEach(function (lid) { if (mp.getLayer(lid)) mp.setLayoutProperty(lid, "visibility", on ? "visible" : "none"); });
    });
  }

  /* ============================================================
     POI  (port of V1 js/poi.js loadCategory)
     ============================================================ */
  var poiState = {}; POI_ORDER.forEach(function (c) { poiState[c] = { loaded: false, layerIds: [] }; });
  var registeredIcons = new Set();
  function registerIcon(name) {
    var mp = map();
    if (!mp || registeredIcons.has(name) || mp.hasImage("poi-" + name)) { registeredIcons.add(name); return Promise.resolve(); }
    return new Promise(function (resolve) {
      var img = new Image(28, 28);
      img.onload = function () { try { mp.addImage("poi-" + name, img); } catch (e) {} registeredIcons.add(name); resolve(); };
      img.onerror = function () { resolve(); };
      img.src = SPRITE + name + ".svg";
    });
  }
  function poiInsertBefore() {
    var mp = map(); var layers = (mp.getStyle().layers) || [];
    for (var i = 0; i < layers.length; i++) { if (layers[i].id && layers[i].id.indexOf("db-draw-") === 0) return layers[i].id; }
    return undefined;
  }
  function poiPopup(cid, e) {
    var f = e.features && e.features[0]; if (!f) return; var p = f.properties || {};
    var tags = p.tags; if (typeof tags === "string") { try { tags = JSON.parse(tags); } catch (x) { tags = {}; } } tags = tags || {};
    var cdef = POI[cid]; var name = p.name || tags.name || tags.operator || cdef.label;
    var lines = ["<b>" + M.escapeHtml(name) + "</b>", "<small>" + M.escapeHtml(cdef.label) + "</small>"];
    var keys = ["operator", "phone", "website", "addr:street", "voltage", "aeroway", "iata", "icao", "highway", "FLD_ZONE", "fld_zone"];
    var interesting = [];
    keys.forEach(function (k) { var v = tags[k] != null ? tags[k] : p[k]; if (v != null && v !== "") interesting.push([k, v]); });
    if (interesting.length) { lines.push('<hr style="border:0;border-top:1px solid #ccc;margin:6px 0">'); interesting.forEach(function (kv) { lines.push("<small><b>" + M.escapeHtml(kv[0]) + ":</b> " + M.escapeHtml(String(kv[1]).slice(0, 200)) + "</small>"); }); }
    new maplibregl.Popup({ offset: 12, closeButton: true }).setLngLat(e.lngLat)
      .setHTML('<div style="color:#111;min-width:220px;line-height:1.4">' + lines.join("<br>") + "</div>").addTo(map());
  }
  function loadPoi(cid) {
    var mp = map(); var cdef = POI[cid], st = poiState[cid];
    var dataBase = V1 + "/data/poi/" + regionId() + "/";
    return Promise.all((cdef.icons || []).map(registerIcon)).then(function () {
      var sourceId = "poi-" + cid, beforeId = poiInsertBefore();
      if (cdef.format === "pmtiles") {
        var pmt = "pmtiles://" + window.location.origin + dataBase + cid + ".pmtiles";
        if (!mp.getSource(sourceId)) mp.addSource(sourceId, { type: "vector", url: pmt });
        cdef.layers.forEach(function (rec, i) {
          var lid = "poi-" + cid + "-" + rec.kind + "-" + i;
          if (mp.getLayer(lid)) mp.removeLayer(lid);
          var layer = { id: lid, source: sourceId, type: rec.kind === "icon" ? "symbol" : rec.kind, "source-layer": rec.sourceLayer || cdef.sourceLayer || cid, layout: { visibility: "none" }, paint: rec.paint || {} };
          if (rec.filter) layer.filter = rec.filter;
          if (cdef.minzoom != null) layer.minzoom = cdef.minzoom;
          if (rec.minzoom != null) layer.minzoom = rec.minzoom;
          mp.addLayer(layer, beforeId); st.layerIds.push(lid);
          if (rec.kind === "icon" || rec.kind === "fill") { mp.on("click", lid, function (e) { poiPopup(cid, e); }); }
        });
        st.loaded = true; return;
      }
      return fetch(dataBase + cid + ".geojson", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (fc) {
        if (!mp.getSource(sourceId)) mp.addSource(sourceId, { type: "geojson", data: fc }); else mp.getSource(sourceId).setData(fc);
        cdef.layers.forEach(function (rec, i) {
          var lid = "poi-" + cid + "-" + rec.kind + "-" + i;
          if (mp.getLayer(lid)) mp.removeLayer(lid);
          var layer = { id: lid, source: sourceId, filter: rec.filter, layout: { visibility: "none" }, paint: {} };
          if (rec.kind === "fill") { layer.type = "fill"; layer.paint = rec.paint || {}; }
          else if (rec.kind === "line") { layer.type = "line"; layer.layout["line-cap"] = "round"; layer.layout["line-join"] = "round"; layer.paint = rec.paint || {}; }
          else if (rec.kind === "icon") {
            layer.type = "symbol";
            layer.layout["icon-image"] = "poi-" + rec.icon; layer.layout["icon-size"] = 0.85; layer.layout["icon-allow-overlap"] = true;
            layer.layout["text-field"] = ["coalesce", ["get", "name"], ""]; layer.layout["text-font"] = ["Noto Sans Medium"]; layer.layout["text-size"] = 11;
            layer.layout["text-anchor"] = "top"; layer.layout["text-offset"] = [0, 1.0]; layer.layout["text-optional"] = true; layer.layout["text-allow-overlap"] = false;
            layer.paint = { "text-color": "#f0f0f0", "text-halo-color": "#0b0f10", "text-halo-width": 1.4 };
            if (rec.minzoom != null) layer.minzoom = rec.minzoom;
          }
          mp.addLayer(layer, beforeId); st.layerIds.push(lid);
          if (rec.kind === "icon" || rec.kind === "fill") { mp.on("click", lid, function (e) { poiPopup(cid, e); }); }
        });
        st.loaded = true;
      });
    }).catch(function (e) { console.warn("[dbmap] poi load failed " + cid, e); });
  }
  function setPoi(cid, on) {
    var st = poiState[cid];
    var apply = function () { var mp = map(); st.layerIds.forEach(function (lid) { if (mp.getLayer(lid)) mp.setLayoutProperty(lid, "visibility", on ? "visible" : "none"); }); };
    if (on && !st.loaded) loadPoi(cid).then(apply); else if (st.loaded) apply();
  }

  /* ============================================================
     GLOBAL INTEL LAYERS  (GDELT / USGS / GDACS / TFRs / Sat / ACLED / FIRMS)
     ============================================================ */
  var intelState = {};
  ["gdelt","usgs","gdacs","tfrs","satpasses","firms","conflict-zones"].forEach(function(t) {
    intelState[t] = { loaded: false, layerIds: [] };
  });

  function intelPopup(html, lngLat) {
    new maplibregl.Popup({ offset: 10, closeButton: true }).setLngLat(lngLat)
      .setHTML('<div style="color:#111;min-width:200px;line-height:1.3">' + html + "</div>").addTo(map());
  }

  function pushIntelTicker(ctype, features) {
    if (typeof window.DBShell === "undefined" || !window.DBShell.ticker) return;
    var now = Date.now(), items = [];
    if (ctype === "usgs") {
      features.filter(function(f){ return (f.properties.mag||0) >= 4.5; }).slice(0,3).forEach(function(f){
        var p = f.properties;
        items.push({ts: p.time||now, tg:"USGS", c:"#f46d43", x:"M"+((p.mag||0).toFixed(1))+" "+(p.place||"")+" d="+(p.depth_km||"?")+"km"});
      });
    } else if (ctype === "gdacs") {
      features.filter(function(f){ return f.properties.alert_level === "Red"; }).slice(0,3).forEach(function(f){
        var p = f.properties;
        items.push({ts: now, tg:"GDACS", c:"#d73027", x:(p.event_type||"")+" – "+(p.title||"").slice(0,80)});
      });
    } else if (ctype === "firms") {
      var hi = features.filter(function(f){ return f.properties.confidence === "high"; });
      if (hi.length) items.push({ts: now, tg:"FIRMS", c:"#d73027", x:hi.length+" high-confidence fire detections (VIIRS)"});
    } else if (ctype === "satpasses") {
      features.filter(function(f){ var c=f.properties.countdown_s; return c>=0&&c<1800; }).slice(0,3).forEach(function(f){
        var p = f.properties, min = Math.round(p.countdown_s/60);
        items.push({ts: now, tg:"SAT", c:"#b08cf0", x:(p.sat_name||"SAT")+" pass in "+min+" min · el "+p.max_el_deg+"°"});
      });
    } else if (ctype === "gdelt") {
      features.filter(function(f){ return f.properties.severity === "high"; }).slice(0,3).forEach(function(f){
        var p = f.properties;
        items.push({ts: now, tg:"GDELT", c:"#9a9a3c", x:(p.title||"").slice(0,80)});
      });
    } else if (ctype === "tfrs") {
      features.slice(0,3).forEach(function(f){
        var p = f.properties;
        items.push({ts: now, tg:"TFR", c:"#4fa3d0", x:"TFR "+(p.notam_id||"")+" "+(p.location_desc||"").slice(0,60)});
      });
    } else if (ctype === "acled") {
      features.filter(function(f){ return (f.properties.fatalities||0) > 0; }).slice(0,3).forEach(function(f){
        var p = f.properties;
        items.push({ts: now, tg:"ACLED", c:"#d73027", x:(p.event_type||"")+" · "+(p.location||"")+" · "+(p.fatalities||0)+" fatal"});
      });
    }
    if (items.length) window.DBShell.ticker(items);
  }

  /* ── conflict hover tooltip helpers ───────────────── */
  var _cxTip = null;
  function _getCxTip(){
    if(!_cxTip){
      _cxTip = document.createElement("div");
      _cxTip.id = "gdelt-hover-tip";
      document.body.appendChild(_cxTip);
    }
    return _cxTip;
  }
  function _moveCxTip(ev){
    var t = _getCxTip(); if(t.style.display==="none") return;
    var x = ev.clientX+22, y = ev.clientY-180;
    if(x+270 > window.innerWidth) x = ev.clientX-292;
    if(y < 10) y = 10;
    t.style.left = x+"px"; t.style.top = y+"px";
  }
  function _hideCxTip(){
    if(_cxTip) _cxTip.style.display = "none";
  }
  var _MON = ["","JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

  function addIntelGdelt(fc) {
    var mp = map(); if (!mp) return;
    var sid = "intel-gdelt", st = intelState.gdelt, bf = poiInsertBefore();
    if (!mp.getSource(sid)) mp.addSource(sid, { type:"geojson", data:fc, cluster:true, clusterMaxZoom:5, clusterRadius:50 });
    mp.addLayer({ id:"gdelt-clusters", type:"circle", source:sid, filter:["has","point_count"], layout:{visibility:"none"},
      paint:{ "circle-color":["step",["get","point_count"],"#9a9a3c",10,"#f46d43",50,"#d73027"],
              "circle-radius":["step",["get","point_count"],14,10,20,50,28],
              "circle-stroke-width":1, "circle-stroke-color":"#0b0f10" } }, bf);
    mp.addLayer({ id:"gdelt-cluster-count", type:"symbol", source:sid, filter:["has","point_count"], layout:{visibility:"none","text-field":["get","point_count_abbreviated"],"text-font":["Noto Sans Medium"],"text-size":12,"text-allow-overlap":true},
      paint:{ "text-color":"#111" } }, bf);
    mp.addLayer({ id:"gdelt-points", type:"circle", source:sid, filter:["!",["has","point_count"]], layout:{visibility:"none"},
      paint:{ "circle-radius":5,
              "circle-color":["match",["get","severity"],"high","#d73027","medium","#f46d43","#fee090"],
              "circle-stroke-width":1, "circle-stroke-color":"#0b0f10", "circle-opacity":0.9 } }, bf);
    // Click: navigate to CONFLICT tab and pass the event
    mp.on("click","gdelt-points",function(e){
      var f=e.features&&e.features[0]; if(!f) return;
      var p=f.properties||{};
      _hideCxTip();
      if(window.DBConflict) DBConflict.setPending(p);
      if(window.DBShell) DBShell.go("CONFLICT");
    });
    mp.on("click","gdelt-clusters",function(e){ mp.easeTo({center:e.lngLat, zoom:mp.getZoom()+2}); });
    // Hover preview tooltip
    mp.on("mouseenter","gdelt-points",function(e){
      var f=e.features&&e.features[0]; if(!f) return;
      var p=f.properties||{};
      mp.getCanvas().style.cursor="pointer";
      var sc=p.severity==="high"?"#d73027":p.severity==="medium"?"#f46d43":"#fee090";
      var actors=[p.actor1,p.actor2].filter(Boolean).join(" vs ");
      var gs=p.goldstein!==undefined?"GS "+parseFloat(p.goldstein).toFixed(1):"";
      var dateStr="";
      if(p.date&&p.date.length>=8) dateStr=p.date.slice(6,8)+" "+_MON[parseInt(p.date.slice(4,6),10)||0]+" "+p.date.slice(0,4);
      var tip=_getCxTip();
      tip.innerHTML=
        "<div style='color:"+sc+";font-weight:700;font-size:12px;margin-bottom:5px'>"+M.escapeHtml(p.event_type||"Conflict")+"</div>"+
        "<div style='color:#8898AA;font-size:10px;margin-bottom:3px'>"+M.escapeHtml(p.location||p.country||"")+"</div>"+
        (actors?"<div style='font-size:10px;font-style:italic;margin-bottom:3px'>"+M.escapeHtml(actors)+"</div>":"")+
        "<div style='color:#8898AA;font-size:10px;display:flex;justify-content:space-between;gap:12px'>"+
          "<span>"+M.escapeHtml(dateStr)+"</span>"+
          (gs?"<span style='color:"+sc+"'>"+M.escapeHtml(gs)+"</span>":"")+
        "</div>"+
        "<div style='color:"+sc+";font-size:9px;margin-top:8px;letter-spacing:.1em;opacity:.8'>CLICK FOR FULL BREAKDOWN →</div>";
      tip.style.display="block";
      _moveCxTip(e.originalEvent);
    });
    mp.on("mouseleave","gdelt-points",function(){ mp.getCanvas().style.cursor=""; _hideCxTip(); });
    st.layerIds = ["gdelt-clusters","gdelt-cluster-count","gdelt-points"]; st.loaded = true;
  }

  function addIntelUsgs(fc) {
    var mp = map(); if (!mp) return;
    var sid = "intel-usgs", st = intelState.usgs, bf = poiInsertBefore();
    if (!mp.getSource(sid)) mp.addSource(sid, { type:"geojson", data:fc });
    mp.addLayer({ id:"usgs-circles", type:"circle", source:sid, layout:{visibility:"none"},
      paint:{ "circle-radius":["interpolate",["linear"],["get","mag"],2,3,4,5,5,7,6,10,7,14,8,18],
              "circle-color":["case",[">=",["get","mag"],6],"#d73027",[">=",["get","mag"],4.5],"#f46d43","#fee090"],
              "circle-stroke-width":1, "circle-stroke-color":"#0b0f10", "circle-opacity":0.85 } }, bf);
    mp.on("click","usgs-circles",function(e){ var f=e.features&&e.features[0]; if(!f) return; var p=f.properties||{};
      var t=p.time?new Date(p.time).toUTCString():"";
      intelPopup("<b>M"+((p.mag||0).toFixed(1))+"</b> "+M.escapeHtml(p.place||"")+"<br><small>Depth: "+(p.depth_km||"?")+"km&nbsp;·&nbsp;Sig: "+(p.sig||"?")+"<br>"+M.escapeHtml(t)+"</small>", e.lngLat); });
    mp.on("mouseenter","usgs-circles",function(){mp.getCanvas().style.cursor="pointer";});
    mp.on("mouseleave","usgs-circles",function(){mp.getCanvas().style.cursor="";});
    st.layerIds = ["usgs-circles"]; st.loaded = true;
  }

  function addIntelGdacs(fc) {
    var mp = map(); if (!mp) return;
    var sid = "intel-gdacs", st = intelState.gdacs, bf = poiInsertBefore();
    if (!mp.getSource(sid)) mp.addSource(sid, { type:"geojson", data:fc });
    mp.addLayer({ id:"gdacs-circles", type:"circle", source:sid, layout:{visibility:"none"},
      paint:{ "circle-radius":8,
              "circle-color":["match",["get","alert_level"],"Red","#d73027","Orange","#f46d43","Green","#6ad27a","#8a9499"],
              "circle-stroke-width":2, "circle-stroke-color":"#0b0f10", "circle-opacity":0.9 } }, bf);
    mp.on("click","gdacs-circles",function(e){ var f=e.features&&e.features[0]; if(!f) return; var p=f.properties||{};
      intelPopup("<b>"+M.escapeHtml(p.title||"")+"</b><br><small>"+M.escapeHtml(p.event_type||"")+"&nbsp;·&nbsp;"+M.escapeHtml(p.alert_level||"")+"&nbsp;·&nbsp;"+M.escapeHtml(p.country||"")+"</small>", e.lngLat); });
    mp.on("mouseenter","gdacs-circles",function(){mp.getCanvas().style.cursor="pointer";});
    mp.on("mouseleave","gdacs-circles",function(){mp.getCanvas().style.cursor="";});
    st.layerIds = ["gdacs-circles"]; st.loaded = true;
  }

  function addIntelTfrs(fc) {
    var mp = map(); if (!mp) return;
    var sid = "intel-tfrs", st = intelState.tfrs, bf = poiInsertBefore();
    if (!mp.getSource(sid)) mp.addSource(sid, { type:"geojson", data:fc });
    mp.addLayer({ id:"tfrs-circles", type:"circle", source:sid, layout:{visibility:"none"},
      paint:{ "circle-radius":12, "circle-color":"#4fa3d0",
              "circle-stroke-width":2, "circle-stroke-color":"#0b0f10", "circle-opacity":0.65 } }, bf);
    mp.addLayer({ id:"tfrs-labels", type:"symbol", source:sid, layout:{visibility:"none","text-field":["coalesce",["get","notam_id"],"TFR"],"text-font":["Noto Sans Medium"],"text-size":9,"text-anchor":"bottom","text-offset":[0,-1.4],"text-optional":true},
      paint:{ "text-color":"#4fa3d0", "text-halo-color":"#0b0f10", "text-halo-width":1.2 } }, bf);
    mp.on("click","tfrs-circles",function(e){ var f=e.features&&e.features[0]; if(!f) return; var p=f.properties||{};
      intelPopup("<b>TFR "+M.escapeHtml(p.notam_id||"")+"</b><br><small>"+M.escapeHtml(p.type||"")+"&nbsp;·&nbsp;"+M.escapeHtml(p.facility||"")+"<br>"+M.escapeHtml(p.location_desc||"")+"<br>Eff: "+M.escapeHtml(p.effective||"")+"<br>Exp: "+M.escapeHtml(p.expiration||"")+"</small>", e.lngLat); });
    mp.on("mouseenter","tfrs-circles",function(){mp.getCanvas().style.cursor="pointer";});
    mp.on("mouseleave","tfrs-circles",function(){mp.getCanvas().style.cursor="";});
    st.layerIds = ["tfrs-circles","tfrs-labels"]; st.loaded = true;
  }

  function addIntelSatpasses(fc) {
    var mp = map(); if (!mp) return;
    var sid = "intel-satpasses", st = intelState.satpasses, bf = poiInsertBefore();
    if (!mp.getSource(sid)) mp.addSource(sid, { type:"geojson", data:fc });
    mp.addLayer({ id:"satpasses-lines", type:"line", source:sid, layout:{visibility:"none","line-cap":"round","line-join":"round"},
      paint:{ "line-color":["case",["coalesce",["get","in_progress"],false],"#b08cf0","rgba(176,140,240,0.4)"],
              "line-width":["case",["coalesce",["get","in_progress"],false],2.5,1.2],
              "line-dasharray":[5,3] } }, bf);
    mp.on("click","satpasses-lines",function(e){ var f=e.features&&e.features[0]; if(!f) return; var p=f.properties||{};
      var rise=p.rise_ts?new Date(p.rise_ts*1000).toUTCString():"?";
      var eta=p.countdown_s>0?Math.round(p.countdown_s/60)+" min":"in progress";
      intelPopup("<b>"+M.escapeHtml(p.sat_name||"")+"</b><br><small>Rise: "+M.escapeHtml(rise)+"<br>Max el: "+p.max_el_deg+"°&nbsp;·&nbsp;Dur: "+Math.round((p.duration_s||0)/60)+" min<br>ETA: "+eta+"</small>", e.lngLat); });
    mp.on("mouseenter","satpasses-lines",function(){mp.getCanvas().style.cursor="pointer";});
    mp.on("mouseleave","satpasses-lines",function(){mp.getCanvas().style.cursor="";});
    st.layerIds = ["satpasses-lines"]; st.loaded = true;
  }

  function addIntelAcled(fc) {
    var mp = map(); if (!mp) return;
    var sid = "intel-acled", st = intelState.acled, bf = poiInsertBefore();
    if (!mp.getSource(sid)) mp.addSource(sid, { type:"geojson", data:fc, cluster:true, clusterMaxZoom:5, clusterRadius:40 });
    mp.addLayer({ id:"acled-clusters", type:"circle", source:sid, filter:["has","point_count"], layout:{visibility:"none"},
      paint:{ "circle-color":["step",["get","point_count"],"#d73027",10,"#f46d43",50,"#fee090"],
              "circle-radius":["step",["get","point_count"],14,10,20,50,28],
              "circle-stroke-width":1, "circle-stroke-color":"#0b0f10" } }, bf);
    mp.addLayer({ id:"acled-cluster-count", type:"symbol", source:sid, filter:["has","point_count"], layout:{visibility:"none","text-field":["get","point_count_abbreviated"],"text-font":["Noto Sans Medium"],"text-size":12,"text-allow-overlap":true},
      paint:{ "text-color":"#111" } }, bf);
    mp.addLayer({ id:"acled-points", type:"circle", source:sid, filter:["!",["has","point_count"]], layout:{visibility:"none"},
      paint:{ "circle-radius":5,
              "circle-color":["match",["get","severity"],"high","#d73027","medium","#f46d43","#fee090"],
              "circle-stroke-width":1, "circle-stroke-color":"#0b0f10", "circle-opacity":0.9 } }, bf);
    mp.on("click","acled-points",function(e){ var f=e.features&&e.features[0]; if(!f) return; var p=f.properties||{};
      intelPopup("<b>"+M.escapeHtml(p.event_type||"")+"</b><br><small>"+M.escapeHtml(p.location||"")+", "+M.escapeHtml(p.country||"")+"<br>Fatalities: "+(p.fatalities||0)+"<br><i>"+M.escapeHtml((p.notes||"").slice(0,120))+"</i></small>", e.lngLat); });
    mp.on("click","acled-clusters",function(e){ mp.easeTo({center:e.lngLat, zoom:mp.getZoom()+2}); });
    mp.on("mouseenter","acled-points",function(){mp.getCanvas().style.cursor="pointer";});
    mp.on("mouseleave","acled-points",function(){mp.getCanvas().style.cursor="";});
    st.layerIds = ["acled-clusters","acled-cluster-count","acled-points"]; st.loaded = true;
  }

  function addIntelFirms(fc) {
    var mp = map(); if (!mp) return;
    var sid = "intel-firms", st = intelState.firms, bf = poiInsertBefore();
    if (!mp.getSource(sid)) mp.addSource(sid, { type:"geojson", data:fc });
    mp.addLayer({ id:"firms-heat", type:"heatmap", source:sid, maxzoom:14, layout:{visibility:"none"},
      paint:{ "heatmap-weight":["interpolate",["linear"],["get","brightness"],300,0.1,400,0.5,500,1.0],
              "heatmap-intensity":["interpolate",["linear"],["zoom"],0,0.2,12,1.5],
              "heatmap-color":["interpolate",["linear"],["heatmap-density"],0,"rgba(11,15,16,0)",0.2,"#fee090",0.5,"#f46d43",0.8,"#d73027",1,"#7B0066"],
              "heatmap-radius":["interpolate",["linear"],["zoom"],0,2,10,10,14,20],
              "heatmap-opacity":0.75 } }, bf);
    st.layerIds = ["firms-heat"]; st.loaded = true;
  }

  /* ── Conflict Zones — uniform red transparent overlay over affected areas.
     Opacity (not hue) still carries severity, so it reads as one consistent
     "danger" color rather than the old red/orange/yellow per-event grading. ── */
  function addConflictZones(fc) {
    var mp = map(); if (!mp) return;
    var sid = "intel-conflict-zones", st = intelState["conflict-zones"], bf = poiInsertBefore();
    if (!mp.getSource(sid)) mp.addSource(sid, { type:"geojson", data:fc });
    mp.addLayer({ id:"conflict-zones-fill", type:"fill", source:sid, layout:{visibility:"none"},
      paint:{ "fill-color":"#d73027",
              "fill-opacity":["coalesce",["get","opacity"],0.12] } }, bf);
    mp.addLayer({ id:"conflict-zones-line", type:"line", source:sid, layout:{visibility:"none"},
      paint:{ "line-color":"#d73027",
              "line-width":1, "line-opacity":0.5 } }, bf);
    mp.on("click","conflict-zones-fill",function(e){
      var f=e.features&&e.features[0]; if(!f) return; var p=f.properties||{};
      _hideCxTip();
      if(window.DBConflict) DBConflict.applyFilter(p.country||p.location||"");
      if(window.DBShell) DBShell.go("CONFLICT");
    });
    mp.on("mouseenter","conflict-zones-fill",function(e){
      var f=e.features&&e.features[0]; if(!f) return; var p=f.properties||{};
      mp.getCanvas().style.cursor="pointer";
      var sc=p.fill_color||"#d73027";
      var tip=_getCxTip();
      tip.innerHTML=
        "<div style='color:"+sc+";font-weight:700;font-size:12px;margin-bottom:5px'>"+M.escapeHtml(p.event_type||"Conflict Zone")+"</div>"+
        "<div style='color:#8898AA;font-size:10px;margin-bottom:3px'>"+M.escapeHtml(p.location||p.country||"")+"</div>"+
        (p.event_count?"<div style='font-size:10px;color:#b0bec5;margin-bottom:3px'>"+p.event_count+" events · "+M.escapeHtml(p.country||"")+"</div>":"")+
        "<div style='color:"+sc+";font-size:9px;margin-top:8px;letter-spacing:.1em;opacity:.8'>CLICK TO FILTER LIST →</div>";
      tip.style.display="block";
      _moveCxTip(e.originalEvent);
    });
    mp.on("mousemove","conflict-zones-fill",function(e){ _moveCxTip(e.originalEvent); });
    mp.on("mouseleave","conflict-zones-fill",function(){ mp.getCanvas().style.cursor=""; _hideCxTip(); });
    st.layerIds = ["conflict-zones-fill","conflict-zones-line"]; st.loaded = true;
  }

  function setIntel(ctype, on) {
    var st = intelState[ctype]; if (!st) return;
    var apply = function() {
      var mp = map(); if (!mp) return;
      st.layerIds.forEach(function(lid) { if (mp.getLayer(lid)) mp.setLayoutProperty(lid, "visibility", on ? "visible" : "none"); });
    };
    if (on && !st.loaded) {
      // conflict-zones is pre-generated static GeoJSON, not served via /api/intel
      var url = (ctype === "conflict-zones")
        ? "/dashboard/data/intel/" + ctype + ".geojson"
        : "/api/intel/" + ctype;
      fetch(url, { cache: "no-store" })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(fc) {
          if (!fc || !fc.features) return;
          if      (ctype === "gdelt")          addIntelGdelt(fc);
          else if (ctype === "usgs")           addIntelUsgs(fc);
          else if (ctype === "gdacs")          addIntelGdacs(fc);
          else if (ctype === "tfrs")           addIntelTfrs(fc);
          else if (ctype === "satpasses")      addIntelSatpasses(fc);
          else if (ctype === "acled")          addIntelAcled(fc);
          else if (ctype === "firms")          addIntelFirms(fc);
          else if (ctype === "conflict-zones") addConflictZones(fc);
          if (ctype !== "conflict-zones") {
            pushIntelTicker(ctype, fc.features);
          }
          apply();
        }).catch(function(e) { console.warn("[dbmap] intel load failed " + ctype, e); });
    } else if (st.loaded) {
      apply();
    }
  }

  /* ============================================================
     PUBLIC: setActive / activeCount / clearAll / restore
     ============================================================ */
  function dispatch(id, on) {
    var l = M.layerById[id]; if (!l) return;
    if (l.kind === "entity") M.setEntityVisible(id, on);
    else if (l.kind === "crime") setCrime(id, on);
    else if (l.kind === "wx") setWx(on);
    else if (l.kind === "poi") setPoi(l.cid, on);
    else if (l.kind === "intel") setIntel(l.ctype, on);
  }
  M.layers = {
    registry: REG,
    isActive: function (id) { return !!active[id]; },
    setActive: function (id, on) {
      active[id] = !!on;
      localStorage.setItem("db_map_layer_" + id, on ? "1" : "0");
      dispatch(id, on);
      if (M.ui) M.ui.updateLayerCount();
    },
    activeCount: function () { return REG.filter(function (l) { return active[l.id]; }).length; },
    clearAll: function () {
      REG.forEach(function (l) { if (active[l.id]) { active[l.id] = false; localStorage.setItem("db_map_layer_" + l.id, "0"); dispatch(l.id, false); } });
      if (M.ui) M.ui.updateLayerCount();
    }
  };

  // On map ready (initial + after region rebuild), re-apply any persisted-on
  // overlay layers so a reload restores exactly what the operator had on.
  M.onReady(function () {
    REG.forEach(function (l) {
      if (l.kind === "entity") return;        // entity markers handled by core's own restore
      if (active[l.id]) dispatch(l.id, true);
    });
    if (M.ui) M.ui.updateLayerCount();
  });

})(window.DBMap);
