/* ============================================================
   DOOM BOX V2 — MAP CORE  (REAL MapLibre GL JS engine)
   Replaces the canvas mock. Owns the MapLibre map lifecycle,
   PMTiles vector basemap (LOCAL files only), satellite raster
   overlay, MIL-STD-2525 symbols, coordinate readouts (top-bar +
   cursor), region resolution, and the live entity markers
   (TAK / ADS-B / Mesh / self-GPS).  Ported from V1 js/map.js +
   js/symbols.js, adapted to the V2 shell's DBMap.ui.mount flow.
   Attaches to window.DBMap.
   ============================================================ */
window.DBMap = window.DBMap || {};
(function (M) {
  "use strict";

  /* ---------------- config ---------------- */
  var VEGAS  = { lat: 36.1699, lon: -115.1398 };   // default operating area
  var CENTER = [VEGAS.lon, VEGAS.lat];             // MapLibre = [lon, lat]
  var ZOOM = 10, MINZ = 2, MAXZ = 17;
  var ORIGIN = window.location.origin;
  // Shared heavy assets (PMTiles regions, glyphs, sprites, POI data) live under
  // V1's static root and are served by the same Node-RED httpStatic mount. We
  // reference them absolutely — NEVER an external tile URL.
  var V1 = "/dashboard";

  // Known regions — hardcoded fallback so the basemap resolves even when
  // map-region-fetcher.service is stopped (its /api/maps/regions then 5xx's).
  // Enriched from /api/maps/regions when the daemon is up.
  var KNOWN = {
    lasvegas:  { region_id: "lasvegas",  name: "LAS VEGAS",   serve_url: V1 + "/maps/lasvegas.pmtiles",
                 bbox: [-115.7, 35.5, -114.5, 36.8], minzoom: 0, maxzoom: 15, size_bytes: 40724181, target: "nvme" },
    southwest: { region_id: "southwest", name: "SOUTHWEST US", serve_url: V1 + "/maps/southwest.pmtiles",
                 bbox: [-115.5, 30, -93, 37.5],      minzoom: 0, maxzoom: 15, size_bytes: 1949110523, target: "nvme" },
    world:     { region_id: "world",     name: "WORLD",        serve_url: V1 + "/maps/world.pmtiles",
                 bbox: [-180, -85, 180, 85],          minzoom: 0, maxzoom: 6,  size_bytes: 45154026, target: "nvme" }
  };

  // Synchronously read the persisted active region so CENTER/ZOOM are correct
  // before the async resolveRegion() completes.
  var _cachedId = (function () {
    try { return localStorage.getItem("og_active_region_v2") || "lasvegas"; } catch (e) { return "lasvegas"; }
  })();
  // regionHome: returns {center, zoom} — world shows 0,0 z2; locals show Vegas z10.
  function regionHome(id) {
    if (id === "world") return { center: [0, 0], zoom: 2 };
    return { center: CENTER, zoom: ZOOM };
  }

  var S = M.state = {
    region: KNOWN[_cachedId] || KNOWN.lasvegas,
    activeId: _cachedId,
    regions: [KNOWN.lasvegas, KNOWN.southwest, KNOWN.world],
    basemap: localStorage.getItem("db_map_basemap") || "vector",   // vector | satellite | hires
    satSource: localStorage.getItem("db_map_sat_src") || "esri",   // usgs | esri — esri reaches z19 nationwide (USGS 404s past z16 outside select project areas; confirmed 2026-08-05 for the tx-nm-snv operating area)
    hiresZip: localStorage.getItem("db_map_hires_zip") || null,     // active NAIP hi-res archive (ZIP code) when basemap === "hires"
    worldBm: localStorage.getItem("db_map_worldbm") !== "0",        // GIBS BlueMarble offline world backdrop (style underlay) — default ON
    usImagery: localStorage.getItem("db_map_us_imagery") !== "0",   // USGS CONUS imagery underlay z7-9 (Tier 2, above world-bm) — default ON
    regionDfw: localStorage.getItem("db_map_region_dfw") !== "0",     // NAIP z10-16 regional imagery — DFW metro (Tier 3, above us-z9) — default ON
    regionVegas: localStorage.getItem("db_map_region_vegas") !== "0", // NAIP z10-16 regional imagery — Las Vegas metro (Tier 3, above us-z9) — default ON
    entity: {
      tak:  localStorage.getItem("db_map_layer_tak")  === "1",
      adsb: localStorage.getItem("db_map_layer_adsb") === "1",
      mesh: localStorage.getItem("db_map_layer_mesh") === "1",
      self: localStorage.getItem("db_map_layer_self") !== "0"
    },
    // og_gps_visible_v1: display-only redaction flag for the self marker + top-bar
    // MGRS/dot readout. Kept in sync with entity.self (the single user-facing
    // "DOOM BOX (Self Position)" layer toggle drives both). GPS/mesh keep
    // running underneath regardless — this only blanks the UI.
    gpsVisible: localStorage.getItem("og_gps_visible_v1") !== "0",
    self: { fix: false, lat: null, lon: null, alt_m: null, accuracy_m: null, sats: null, age_s: null },
    cursor: { lat: VEGAS.lat, lon: VEGAS.lon, on: false },
    mounted: false
  };
  // Reconcile: entity.self (the existing layer toggle) is the single
  // user-facing switch; force gpsVisible to match it on load so a stale
  // localStorage value from before this flag existed can't diverge.
  S.gpsVisible = S.entity.self;
  localStorage.setItem("og_gps_visible_v1", S.gpsVisible ? "1" : "0");

  // Back-compat: the mock had S.active['<id>']=true as the layer-enable path.
  // Other tabs still do `DBMap.state.active['nws']=true; DBMap.ui.updateLayerCount()`
  // to "show on map". Proxy those writes onto the real layer toggles.
  var MOCK2REAL = { nws: "wx_alerts", crime_inc: "crime_cfs", crime_heat: "crime_heat", crime_cfs: "crime_cfs", adsb: "adsb", mil_air: "adsb", mesh_pos: "mesh", mesh: "mesh", tak: "tak", wx_alerts: "wx_alerts" };
  S.active = new Proxy({}, {
    set: function (t, k, v) {
      t[k] = v;
      var real = MOCK2REAL[k];
      if (real && v && M.layers && typeof M.layers.setActive === "function") { try { M.layers.setActive(real, true); } catch (e) {} }
      return true;
    }
  });

  /* register pmtiles:// protocol once */
  if (!M._protoReg) {
    try {
      var _proto = new pmtiles.Protocol();
      maplibregl.addProtocol("pmtiles", _proto.tile);
      M._protoReg = true;
    } catch (e) { console.error("[dbmap] pmtiles protocol registration failed", e); }
  }

  /* ============================================================
     SYMBOLS — MIL-STD-2525 / APP-6 via milsymbol  (port of V1 symbols.js)
     ============================================================ */
  var SIDC = {
    self:            "SFGPUH----***",  // Friend Ground HQ
    tak:             "SFGPU-----***",  // Friend Ground Unit (generic)
    mesh:            "SFGPESR---***",  // Friend Ground Equip — Sensor Radar
    adsb_unknown:    "SUAP------***",  // Unknown Air
    adsb_military:   "SHAPMF----***",  // Hostile Air — Military Fixed-Wing
    adsb_commercial: "SNAPCF----***"   // Neutral Air — Civil Fixed-Wing
  };
  var SYM = M.symbols = {
    ok: (typeof window.ms !== "undefined" && typeof ms.Symbol === "function"),
    sidcFor: function (kind) { return SIDC[kind] || SIDC.tak; },
    render: function (sidc, opts) {
      opts = opts || {};
      if (!SYM.ok) return null;
      try {
        var sym = new ms.Symbol(sidc, { size: opts.size || 28, fill: true, strokeWidth: opts.strokeWidth || 4 });
        var dim = sym.getSize(), anc = sym.getAnchor();
        var wrap = document.createElement("div");
        wrap.style.cssText = "width:" + dim.width + "px;height:" + dim.height + "px;cursor:pointer;line-height:0;" +
          "filter:drop-shadow(0 0 3px rgba(0,0,0,0.85));";
        wrap.innerHTML = sym.asSVG();
        return { el: wrap, offset: [(dim.width / 2) - anc.x, (dim.height / 2) - anc.y] };
      } catch (e) { return null; }
    }
  };
  if (!SYM.ok) console.warn("[dbmap] milsymbol not loaded — entity markers will fall back to dots");

  /* ============================================================
     MATH + COORD HELPERS
     ============================================================ */
  var D2R = Math.PI / 180;
  M.haversine = function (a, b) {
    var R = 6371000, dla = (b.lat - a.lat) * D2R, dlo = (b.lon - a.lon) * D2R;
    var la1 = a.lat * D2R, la2 = b.lat * D2R;
    var h = Math.sin(dla / 2) * Math.sin(dla / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) * Math.sin(dlo / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  M.bearingDeg = function (a, b) {
    var la1 = a.lat * D2R, la2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
    var y = Math.sin(dl) * Math.cos(la2);
    var x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
    return (Math.atan2(y, x) / D2R + 360) % 360;
  };
  // MGRS string → spaced ("11SQA12345678" → "11S QA 1234 5678")
  M.fmtMgrs = function (s) {
    if (!s || s.length < 5) return "—";
    var gzd = s.slice(0, 3), sq = s.slice(3, 5), rest = s.slice(5);
    if (!rest.length) return gzd + " " + sq;
    var half = rest.length / 2;
    return gzd + " " + sq + " " + rest.slice(0, half) + " " + rest.slice(half);
  };
  M.mgrsAt = function (lon, lat, acc) {
    if (!window.mgrs || !window.mgrs.forward) return "—";
    try { return M.fmtMgrs(window.mgrs.forward([lon, lat], acc == null ? 4 : acc)); }
    catch (e) { return "—"; }
  };
  M.toDec = function (lat, lon) {
    var NS = lat >= 0 ? "N" : "S", EW = lon >= 0 ? "E" : "W";
    return Math.abs(lat).toFixed(5) + "° " + NS + "  " + Math.abs(lon).toFixed(5) + "° " + EW;
  };
  // Back-compat: the mock exposed M.toMGRS(lat, lon). Other tabs (sys/osint/
  // adsb/mesh/wx) call it — keep the (lat, lon) signature.
  M.toMGRS = function (lat, lon) { return M.mgrsAt(lon, lat, 4); };
  // Parse MGRS / decimal / DMS — returns {lon, lat, fmt} or null
  M.parseCoord = function (raw) {
    var s = (raw || "").trim();
    if (!s) return null;
    var mg = s.replace(/\s+/g, "").toUpperCase();
    if (/^\d{1,2}[C-X][A-HJ-NP-Z]{2}(\d{2}|\d{4}|\d{6}|\d{8}|\d{10})$/.test(mg) && window.mgrs && window.mgrs.toPoint) {
      try { var p = window.mgrs.toPoint(mg); return { lon: p[0], lat: p[1], fmt: "MGRS" }; } catch (e) {}
    }
    var dec = s.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (dec) {
      var la = parseFloat(dec[1]), lo = parseFloat(dec[2]);
      if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) return { lon: lo, lat: la, fmt: "DEC" };
    }
    var dms = s.match(/^\s*(\d+)\s*[°d]\s*(\d+)\s*[''m]\s*([\d.]+)?\s*["s]?\s*([NS])\s*[,\s]?\s*(\d+)\s*[°d]\s*(\d+)\s*[''m]\s*([\d.]+)?\s*["s]?\s*([EW])\s*$/i);
    if (dms) {
      var lat = (+dms[1] + (+dms[2]) / 60 + (+(dms[3] || 0)) / 3600) * (dms[4].toUpperCase() === "S" ? -1 : 1);
      var lon = (+dms[5] + (+dms[6]) / 60 + (+(dms[7] || 0)) / 3600) * (dms[8].toUpperCase() === "W" ? -1 : 1);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lon: lon, lat: lat, fmt: "DMS" };
    }
    return null;
  };
  M.escapeHtml = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function fmtAge(secs) {
    if (secs == null) return "—";
    if (secs < 60) return Math.round(secs) + "s";
    if (secs < 3600) return Math.round(secs / 60) + "m";
    if (secs < 86400) return Math.round(secs / 3600) + "h";
    return Math.round(secs / 86400) + "d";
  }
  M.fmtAge = fmtAge;

  /* ============================================================
     REGION RESOLUTION
     Reads /api/maps/active (file read — always up) and, when the
     map-region-fetcher daemon is running, enriches the region list
     from /api/maps/regions. Falls back to the hardcoded KNOWN set.
     ============================================================ */
  M.resolveRegion = function () {
    return fetch("/api/maps/active", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (a) {
        if (a && a.ok && a.region_id) { S.activeId = a.region_id; }
        S.region = KNOWN[S.activeId] || KNOWN.lasvegas;
        try { localStorage.setItem("og_active_region_v2", S.activeId); } catch (e) {}
        return fetch("/api/maps/regions", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
      })
      .then(function (list) {
        // Always include the hardcoded KNOWN regions (including WORLD) in the list.
        var base = [KNOWN.lasvegas, KNOWN.southwest, KNOWN.world];
        if (list && list.ok && Array.isArray(list.regions) && list.regions.length) {
          var mapped = list.regions.map(function (rg) {
            return {
              region_id: rg.region_id, name: (rg.name || rg.region_id).toUpperCase(),
              serve_url: rg.serve_url || (V1 + "/maps/" + rg.region_id + ".pmtiles"),
              bbox: rg.bbox, minzoom: rg.minzoom, maxzoom: rg.maxzoom,
              size_bytes: rg.size_bytes, target: rg.target
            };
          });
          // Merge: daemon list may omit WORLD (not managed by map-region-fetcher); add any KNOWN entries missing from daemon list.
          var ids = mapped.map(function (r) { return r.region_id; });
          base.forEach(function (k) { if (ids.indexOf(k.region_id) < 0) mapped.push(k); });
          S.regions = mapped;
          var hit = S.regions.filter(function (r) { return r.region_id === S.activeId; })[0];
          if (hit) S.region = hit;
        } else {
          S.regions = base;
        }
        return S.region;
      })
      .catch(function () { S.region = KNOWN[S.activeId] || KNOWN.lasvegas; return S.region; });
  };

  /* ============================================================
     STYLE BUILDER  (PMTiles vector + protomaps dark + satellite raster)
     ============================================================ */
  // Satellite tiles routed through the local NR proxy so AP-connected tablets
  // don't need a direct internet path (the Pi fetches on their behalf).
  var SAT_USGS = ORIGIN + "/proxy/tiles/usgs/{z}/{y}/{x}";
  var SAT_ESRI = ORIGIN + "/proxy/tiles/esri/{z}/{y}/{x}";

  M._fillIds = []; M._symbolIds = []; M._allVecIds = [];
  function buildStyle(region) {
    var PMT = "pmtiles://" + ORIGIN + region.serve_url;
    var proto = protomaps_themes_base.default("protomaps", "dark");
    var bgIdx = proto.findIndex(function (l) { return l.type === "background"; });
    var bg   = bgIdx >= 0 ? proto.slice(0, bgIdx + 1) : [];
    var rest = bgIdx >= 0 ? proto.slice(bgIdx + 1)    : proto;
    M._fillIds   = rest.filter(function (l) { return l.type !== "symbol"; }).map(function (l) { return l.id; });
    M._symbolIds = rest.filter(function (l) { return l.type === "symbol"; }).map(function (l) { return l.id; });
    M._allVecIds = rest.map(function (l) { return l.id; });
    return {
      version: 8,
      glyphs: ORIGIN + V1 + "/glyphs/{fontstack}/{range}.pbf",
      sprite: ORIGIN + V1 + "/sprites/dark",
      sources: {
        protomaps: { type: "vector", url: PMT, attribution: '© <a href="https://openstreetmap.org" target="_blank">OpenStreetMap</a> via Protomaps' },
        sat_usgs: { type: "raster", tileSize: 256, tiles: [SAT_USGS], maxzoom: 16, attribution: 'Imagery © USGS — The National Map' },
        sat_esri: { type: "raster", tileSize: 256, tiles: [SAT_ESRI], maxzoom: 19, attribution: 'Tiles © Esri — Maxar, Earthstar Geographics, USGS' },
        // Offline world backdrop — local BlueMarble PMTiles raster, never an external URL.
        world_bm: { type: "raster", tileSize: 256, maxzoom: 6, url: "pmtiles://" + ORIGIN + V1 + "/basemaps/world-bm.pmtiles", attribution: 'Blue Marble — NASA Earth Observatory / GIBS' },
        // Tier-2 CONUS imagery underlay — local USGS ImageryOnly PMTiles raster (z7-9), never an external URL.
        us_z9: { type: "raster", tileSize: 256, maxzoom: 9, url: "pmtiles://" + ORIGIN + V1 + "/basemaps/us-z9.pmtiles", attribution: 'Imagery © USGS — The National Map (NAIP)' },
        // Tier-3 regional NAIP imagery (z10-16) — local PMTiles rasters on the NVMe,
        // served the same way as world_bm/us_z9 above, never an external URL.
        // DFW and Vegas don't overlap geographically, so both sources can stay active —
        // each only has tiles over its own bbox, transparent/absent elsewhere.
        region_dfw: { type: "raster", tileSize: 256, minzoom: 10, maxzoom: 16, url: "pmtiles://" + ORIGIN + V1 + "/basemaps/dfw.pmtiles", attribution: "NAIP / USDA — public domain" },
        region_vegas: { type: "raster", tileSize: 256, minzoom: 10, maxzoom: 16, url: "pmtiles://" + ORIGIN + V1 + "/basemaps/vegas.pmtiles", attribution: "NAIP / USDA — public domain" }
      },
      // world-bm-tiles is the lowest layer above the opaque background: vector
      // fills cover it where the archive has data (dark map unchanged); it shows
      // through where the archive has none (zoomed-out / off-region void).
      // us-z9-tiles sits just above it — CONUS imagery for the z7-9 gap between
      // the world backdrop (z0-6) and the regional vector archives.
      // region-{dfw,vegas}-tiles sit above us-z9 and below the vector layers —
      // Tier 3: sharp z10-16 NAIP imagery over their own metro bboxes, handing off
      // from the us-z9 z7-9 CONUS underlay as the operator zooms in.
      layers: bg.concat([
        { id: "world-bm-tiles", type: "raster", source: "world_bm", layout: { visibility: S.worldBm ? "visible" : "none" } },
        { id: "us-z9-tiles", type: "raster", source: "us_z9", layout: { visibility: S.usImagery ? "visible" : "none" } },
        { id: "region-dfw-tiles", type: "raster", source: "region_dfw", layout: { visibility: S.regionDfw ? "visible" : "none" } },
        { id: "region-vegas-tiles", type: "raster", source: "region_vegas", layout: { visibility: S.regionVegas ? "visible" : "none" } },
        { id: "sat-usgs-tiles", type: "raster", source: "sat_usgs", layout: { visibility: "none" } },
        { id: "sat-esri-tiles", type: "raster", source: "sat_esri", layout: { visibility: "none" } }
      ], rest)
    };
  }

  /* ============================================================
     MAP LIFECYCLE  (persistent instance, re-parented on mount)
     ============================================================ */
  var _map = null, _mapEl = null, _readyCbs = [], _ready = false;

  M.getMap = function () { return _map; };
  M.onReady = function (cb) {
    _readyCbs.push(cb);
    if (_ready && _map) { try { cb(_map); } catch (e) {} }
  };
  function fireReady() {
    _ready = true;
    _readyCbs.forEach(function (cb) { try { cb(_map); } catch (e) { console.error("[dbmap] onReady cb", e); } });
  }

  // create the MapLibre instance into the persistent element
  function createMap() {
    if (!_mapEl) {
      _mapEl = document.createElement("div");
      _mapEl.className = "dbm-maplibre";
      _mapEl.style.cssText = "position:absolute;inset:0;";
    }
    _ready = false;
    var _home = regionHome(S.activeId);
    _map = new maplibregl.Map({
      container: _mapEl,
      style: buildStyle(S.region),
      center: _home.center, zoom: _home.zoom, maxZoom: MAXZ, minZoom: MINZ,
      attributionControl: { compact: true }
    });
    // Top-right, but CSS (.maplibregl-ctrl-top-right) offsets the container down
    // below the LAYERS button so the zoom-in control is never obscured.
    _map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), "top-right");
    _map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "nautical" }), "bottom-left");

    _map.on("load", function () {
      applyBasemap();
      // For local regions, snap to GPS if we already have a fix.
      // For WORLD, stay at 0,0 zoom 2 (GPS snap would be confusing at world scale).
      if (S.activeId !== "world" && S.self.fix && S.self.lat != null) {
        try { _map.jumpTo({ center: [S.self.lon, S.self.lat], zoom: Math.max(_map.getZoom(), 13) }); } catch (e) {}
      }
      fireReady();
      updateTopbarReadout();
    });
    _map.on("moveend", updateTopbarReadout);
    _map.on("mousemove", onMouseMove);
    _map.on("mouseout", function () { S.cursor.on = false; if (M.ui) M.ui.onCursor(null); });
    // Touch-move MGRS cursor readout — lets tablets see coords while panning/drawing
    _mapEl.addEventListener("touchmove", function (e) {
      if (!e.touches.length) return;
      var t = e.touches[0];
      var rect = _mapEl.getBoundingClientRect();
      try {
        var ll = _map.unproject([t.clientX - rect.left, t.clientY - rect.top]);
        onMouseMove({ lngLat: { lat: ll.lat, lng: ll.lng } });
      } catch (err) {}
    }, { passive: true });
    _map.on("error", function (e) { /* swallow tile errors (sat offline handled separately) */ });
  }

  // ensureMap(wrap): create on first use, attach the persistent element into wrap, resize.
  M.ensureMap = function (wrap) {
    if (!_map) createMap();
    if (_mapEl.parentNode !== wrap) wrap.appendChild(_mapEl);
    // a couple of resize ticks — the container was just (re)attached
    requestAnimationFrame(function () { if (_map) _map.resize(); });
    setTimeout(function () { if (_map) _map.resize(); }, 80);
    return _map;
  };

  // Region swap — POST active pointer then reload (SPA restores MAP tab).
  // All regions (including "world") go through the POST so active.json is
  // updated before the reload; resolveRegion() then reads back the correct value.
  M.swapRegion = function (regionId) {
    if (!regionId || regionId === S.activeId) return Promise.resolve({ ok: true });
    try { localStorage.setItem("og_active_region_v2", regionId); } catch (e) {}
    // POST active.json for all regions (including "world") so resolveRegion() reads
    // back the correct value after reload and doesn't revert to the previous region.
    return fetch("/api/maps/active", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ region_id: regionId })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok) {
          // Still reload using the localStorage-cached value so the UI updates.
          localStorage.setItem("db_tab", "MAP");
          location.reload();
          return j || { ok: false };
        }
        localStorage.setItem("db_tab", "MAP");
        location.reload();
        return j;
      }).catch(function (e) { return { ok: false, error: String(e) }; });
  };

  /* ============================================================
     BASEMAP / SATELLITE / HI-RES (downloaded NAIP PMTiles)
     ============================================================ */
  // Lazily add a raster source+layer for a downloaded NAIP archive the first
  // time it's selected. Local file, served by the NVMe httpStatic dual-mount
  // (~/media-local -> /media/) — no proxy needed, unlike the
  // live satellite tiles, since this is fully local data.
  var _hiresLayers = {};   // zip -> true once its source/layer exist
  function ensureHiresLayer(zip) {
    if (!_map || _hiresLayers[zip]) return;
    var lid = "hires-" + zip + "-tiles", sid = "hires-" + zip;
    var pmt = "pmtiles://" + ORIGIN + "/media/naip-cache/" + zip + ".pmtiles";
    if (!_map.getSource(sid)) _map.addSource(sid, { type: "raster", url: pmt, attribution: "USDA NAIP (public domain)" });
    if (!_map.getLayer(lid)) _map.addLayer({ id: lid, type: "raster", source: sid, layout: { visibility: "none" } });
    _hiresLayers[zip] = true;
  }
  function applyBasemap() {
    if (!_map || !_map.getStyle()) return;
    var sat = S.basemap === "satellite";
    var hires = S.basemap === "hires" && S.hiresZip;
    if (hires) ensureHiresLayer(S.hiresZip);
    if (sat || hires) {
      M._fillIds.forEach(function (id) { if (_map.getLayer(id)) _map.setLayoutProperty(id, "visibility", "none"); });
      M._symbolIds.forEach(function (id) { if (_map.getLayer(id)) _map.setLayoutProperty(id, "visibility", "visible"); });
    } else {
      M._allVecIds.forEach(function (id) { if (_map.getLayer(id)) _map.setLayoutProperty(id, "visibility", "visible"); });
    }
    _map.setLayoutProperty("sat-usgs-tiles", "visibility", sat && S.satSource === "usgs" ? "visible" : "none");
    _map.setLayoutProperty("sat-esri-tiles", "visibility", sat && S.satSource === "esri" ? "visible" : "none");
    // World backdrop underlay — driven purely by its own toggle, independent of basemap mode.
    if (_map.getLayer("world-bm-tiles")) _map.setLayoutProperty("world-bm-tiles", "visibility", S.worldBm ? "visible" : "none");
    if (_map.getLayer("us-z9-tiles")) _map.setLayoutProperty("us-z9-tiles", "visibility", S.usImagery ? "visible" : "none");
    // Tier-3 regional imagery underlays — driven purely by their own toggles, independent of basemap mode.
    if (_map.getLayer("region-dfw-tiles")) _map.setLayoutProperty("region-dfw-tiles", "visibility", S.regionDfw ? "visible" : "none");
    if (_map.getLayer("region-vegas-tiles")) _map.setLayoutProperty("region-vegas-tiles", "visibility", S.regionVegas ? "visible" : "none");
    // Hide every known hi-res layer, then show only the active one (if any) —
    // the operator may have viewed several cached ZIPs across the session.
    Object.keys(_hiresLayers).forEach(function (z) {
      var lid = "hires-" + z + "-tiles";
      if (_map.getLayer(lid)) _map.setLayoutProperty(lid, "visibility", (hires && z === S.hiresZip) ? "visible" : "none");
    });
  }
  M.setBasemap = function (which, satSourceOrZip) {
    S.basemap = (which === "satellite" || which === "hires") ? which : "vector";
    if (S.basemap === "satellite" && satSourceOrZip) S.satSource = satSourceOrZip;
    if (S.basemap === "hires" && satSourceOrZip) S.hiresZip = satSourceOrZip;
    localStorage.setItem("db_map_basemap", S.basemap);
    localStorage.setItem("db_map_sat_src", S.satSource);
    if (S.hiresZip) localStorage.setItem("db_map_hires_zip", S.hiresZip);
    applyBasemap();
  };
  // Toggle the GIBS BlueMarble world backdrop underlay (default ON, persisted).
  M.setWorldBm = function (on) {
    S.worldBm = !!on;
    localStorage.setItem("db_map_worldbm", on ? "1" : "0");
    applyBasemap();
  };
  // Toggle the USGS CONUS imagery underlay (Tier 2, default ON, persisted).
  M.setUsImagery = function (on) {
    S.usImagery = !!on;
    localStorage.setItem("db_map_us_imagery", on ? "1" : "0");
    applyBasemap();
  };
  // Toggle the DFW regional NAIP imagery underlay (Tier 3, z10-16, default ON, persisted).
  M.setRegionDfw = function (on) {
    S.regionDfw = !!on;
    localStorage.setItem("db_map_region_dfw", on ? "1" : "0");
    applyBasemap();
  };
  // Toggle the Las Vegas regional NAIP imagery underlay (Tier 3, z10-16, default ON, persisted).
  M.setRegionVegas = function (on) {
    S.regionVegas = !!on;
    localStorage.setItem("db_map_region_vegas", on ? "1" : "0");
    applyBasemap();
  };
  // Public: list of ZIPs that currently have a lazily-created layer this session.
  M.hiresLayersLoaded = function () { return Object.keys(_hiresLayers); };

  /* ============================================================
     READOUTS  (top-bar #mgrs / #latlon / .gps-dot  +  cursor)
     ============================================================ */
  function updateTopbarReadout() {
    var mEl = document.getElementById("mgrs");
    var llEl = document.getElementById("latlon");
    var dot = document.querySelector(".topbar .gps-dot") || document.querySelector(".gps-dot");
    if (!S.gpsVisible) {
      // Display-only redaction (GPS keeps running, mesh keeps reporting —
      // this only blanks the top-bar readout). Full redaction: MGRS text,
      // lat/lon text, AND the fix-status dot. visibility:hidden (not
      // display:none) so the row keeps its footprint — no layout jump.
      if (mEl) { mEl.textContent = "---"; mEl.title = "own position hidden"; }
      if (llEl) { llEl.textContent = "---"; llEl.title = "own position hidden"; }
      if (dot) { dot.style.visibility = "hidden"; }
      return;
    }
    if (dot) { dot.style.visibility = "visible"; }
    var useSelf = S.self && S.self.fix && S.self.lat != null && S.self.lon != null;
    var lon, lat;
    if (useSelf) { lon = S.self.lon; lat = S.self.lat; }
    else if (_map) { var c = _map.getCenter(); lon = c.lng; lat = c.lat; }
    else { return; }
    if (mEl) { mEl.textContent = M.mgrsAt(lon, lat, 4); mEl.title = useSelf ? "own GPS position (10 m)" : "map center (10 m) — no GPS fix"; }
    if (llEl) { var NS = lat >= 0 ? "N" : "S", EW = lon >= 0 ? "E" : "W"; llEl.textContent = Math.abs(lat).toFixed(4) + NS + " " + (Math.abs(lon).toFixed(4).padStart(8, "0")) + EW; }
    if (dot) { dot.style.background = useSelf ? "var(--green, #5DD87A)" : "var(--text-2, #6C7C87)"; dot.style.boxShadow = useSelf ? "0 0 6px var(--green, #5DD87A)" : "none"; }
  }
  M.updateTopbarReadout = updateTopbarReadout;

  function onMouseMove(e) {
    S.cursor.lat = e.lngLat.lat; S.cursor.lon = e.lngLat.lng; S.cursor.on = true;
    if (M.ui) M.ui.onCursor(e.lngLat);
  }

  /* ============================================================
     ENTITY MARKERS — TAK / ADS-B / MESH  (ported from V1 map.js)
     ============================================================ */
  var takMarkers = new Map();   // name -> { marker, lat, lon }
  var adsbMarkers = new Map();  // hex  -> { marker, svg }
  var meshMarkers = new Map();  // id   -> { marker, el, stale }
  M._takMarkers = takMarkers; M._adsbMarkers = adsbMarkers; M._meshMarkers = meshMarkers;

  function classicEl(css, inner) {
    var el = document.createElement("div"); el.style.cssText = css; if (inner) el.innerHTML = inner; return el;
  }
  function makeTakEl() {
    var r = SYM.render(SYM.sidcFor("tak"), { size: 28 });
    if (r) return r;
    return { el: classicEl("width:14px;height:14px;background:#80C8FF;border:2px solid #0A0E12;border-radius:50%;box-shadow:0 0 6px rgba(128,200,255,.85);cursor:pointer;"), offset: [0, 0] };
  }
  function adsbKind(a) {
    var hex = (a.hex || "").toLowerCase();
    if (hex.indexOf("ae") === 0 || a.military) return "adsb_military";
    if (a.callsign && a.callsign.trim()) return "adsb_commercial";
    return "adsb_unknown";
  }
  function makeAdsbEl(a) {
    var r = SYM.render(SYM.sidcFor(adsbKind(a)), { size: 32 });
    if (r) { var inner = r.el.querySelector("svg"); if (inner) inner.style.transition = "transform 200ms linear"; return { el: r.el, svg: inner, offset: r.offset }; }
    var el = classicEl("width:24px;height:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;");
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "22"); svg.setAttribute("height", "22");
    svg.style.transition = "transform 200ms linear";
    svg.innerHTML = '<path d="M12 2 L13.6 11 L22 13 L13.6 14.5 L13 22 L11 22 L10.4 14.5 L2 13 L10.4 11 Z" fill="#e8b54a" stroke="#0b0f10" stroke-width="0.8" stroke-linejoin="round"/>';
    el.appendChild(svg); return { el: el, svg: svg, offset: [0, 0] };
  }
  function makeMeshEl(stale) {
    var r = SYM.render(SYM.sidcFor("mesh"), { size: 24 });
    if (r) { if (stale) r.el.style.opacity = "0.45"; return { el: r.el, offset: r.offset }; }
    var el = classicEl("width:18px;height:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;");
    var stroke = stale ? "#8a9499" : "#4fa3d0";
    el.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><polygon points="12,2 22,7 22,17 12,22 2,17 2,7" fill="rgba(0,0,0,0.35)" stroke="' + stroke + '" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="' + stroke + '"/></svg>';
    return { el: el, offset: [0, 0] };
  }

  function takPopup(u) { return '<div class="dbm-mlpop"><b>' + M.escapeHtml(u.name) + '</b><br><small>' + M.escapeHtml(u.layer || "TAK / CoT") + '</small></div>'; }
  function adsbPopup(a) {
    var cs = (a.callsign || a.hex || "").trim() || a.hex;
    var alt = a.alt_ft != null ? a.alt_ft.toLocaleString() + " ft" : (a.altitude != null ? a.altitude.toLocaleString() + " ft" : "—");
    var spd = a.speed_kts != null ? Math.round(a.speed_kts) + " kts" : (a.speed != null ? Math.round(a.speed) + " kts" : "—");
    var trk = a.track_deg != null ? Math.round(a.track_deg) + "°" : (a.heading != null ? Math.round(a.heading) + "°" : "—");
    return '<div class="dbm-mlpop"><b>' + M.escapeHtml(cs) + '</b><br><small>hex ' + M.escapeHtml(a.hex || "") + '<br>' + alt + ' · ' + spd + ' · ' + trk + '</small></div>';
  }
  function meshPopup(n) {
    var u = n.user || {}, dm = n.deviceMetrics || {};
    var cs = u.longName || u.shortName || n.id;
    var bat = dm.batteryLevel == null ? "—" : (dm.batteryLevel === 101 ? "USB" : dm.batteryLevel + "%");
    var snr = n.snr != null ? n.snr.toFixed(1) + " dB" : "—";
    var hops = n.hopsAway != null ? n.hopsAway : "—";
    var ageS = n.lastHeard ? Math.max(0, Math.floor(Date.now() / 1000 - n.lastHeard)) : null;
    return '<div class="dbm-mlpop"><b>' + M.escapeHtml(cs) + '</b><br><small>' + M.escapeHtml(n.id) + ' · ' + M.escapeHtml(u.hwModel || "") +
      '<br>bat ' + bat + ' · snr ' + snr + ' · ' + hops + ' hop · ' + fmtAge(ageS) + ' ago</small></div>';
  }
  function mlPopup(html) { return new maplibregl.Popup({ offset: 14, closeButton: false, className: "dbm-mlpopup" }).setHTML(html); }

  function pollUnits() {
    if (!_map) return;
    fetch("/api/units", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      if (!data) return;
      var seen = new Set();
      (data.units || []).forEach(function (u) {
        if (typeof u.lat !== "number" || typeof u.lon !== "number") return;
        if (u.lat === 0 && u.lon === 0) return;
        if (typeof u.name === "string" && u.name.indexOf("Meshtastic-") === 0) return;
        seen.add(u.name);
        var rec = takMarkers.get(u.name);
        if (!rec) {
          var m = makeTakEl();
          var mk = new maplibregl.Marker({ element: m.el, offset: m.offset }).setLngLat([u.lon, u.lat]).setPopup(mlPopup(takPopup(u)));
          if (S.entity.tak) mk.addTo(_map);
          takMarkers.set(u.name, { marker: mk, lat: u.lat, lon: u.lon });
        } else { rec.marker.setLngLat([u.lon, u.lat]); rec.marker.getPopup().setHTML(takPopup(u)); }
      });
      takMarkers.forEach(function (rec, name) { if (!seen.has(name)) { rec.marker.remove(); takMarkers.delete(name); } });
      if (M.ui) M.ui.onEntityCount("tak", seen.size);
    }).catch(function () {});
  }
  function pollAdsb() {
    if (!_map) return;
    fetch("/api/adsb", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      if (!data) return;
      var seen = new Set();
      (data.aircraft || []).forEach(function (a) {
        if (typeof a.lat !== "number" || typeof a.lon !== "number") return;
        seen.add(a.hex);
        var rec = adsbMarkers.get(a.hex);
        if (!rec) {
          var m = makeAdsbEl(a);
          var mk = new maplibregl.Marker({ element: m.el, offset: m.offset }).setLngLat([a.lon, a.lat]).setPopup(mlPopup(adsbPopup(a)));
          if (S.entity.adsb) mk.addTo(_map);
          rec = { marker: mk, svg: m.svg }; adsbMarkers.set(a.hex, rec);
        } else { rec.marker.setLngLat([a.lon, a.lat]); rec.marker.getPopup().setHTML(adsbPopup(a)); }
        var trk = (a.track_deg != null) ? a.track_deg : (a.heading != null ? a.heading : 0);
        if (rec.svg) rec.svg.style.transform = "rotate(" + trk + "deg)";
      });
      adsbMarkers.forEach(function (rec, hex) { if (!seen.has(hex)) { rec.marker.remove(); adsbMarkers.delete(hex); } });
      if (M.ui) M.ui.onEntityCount("adsb", seen.size);
    }).catch(function () {});
  }
  function pollMesh() {
    if (!_map) return;
    fetch("/api/mesh/nodes", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
      if (!data) return;
      var seen = new Set(), nowS = Math.floor(Date.now() / 1000);
      (data.nodes || []).forEach(function (n) {
        var p = n.position;
        if (!p || typeof p.lat !== "number" || typeof p.lon !== "number") return;
        if (p.lat === 0 && p.lon === 0) return;
        seen.add(n.id);
        var stale = !n.lastHeard || (nowS - n.lastHeard) > 1800;
        var rec = meshMarkers.get(n.id);
        if (!rec) {
          var m = makeMeshEl(stale);
          var mk = new maplibregl.Marker({ element: m.el, offset: m.offset }).setLngLat([p.lon, p.lat]).setPopup(mlPopup(meshPopup(n)));
          if (S.entity.mesh) mk.addTo(_map);
          meshMarkers.set(n.id, { marker: mk, el: m.el, stale: stale, lat: p.lat, lon: p.lon });
        } else {
          rec.marker.setLngLat([p.lon, p.lat]); rec.marker.getPopup().setHTML(meshPopup(n)); rec.lat = p.lat; rec.lon = p.lon;
          if (rec.stale !== stale) {
            var m2 = makeMeshEl(stale);
            rec.marker.getElement().replaceWith(m2.el); rec.marker._element = m2.el; rec.stale = stale;
          }
        }
      });
      meshMarkers.forEach(function (rec, id) { if (!seen.has(id)) { rec.marker.remove(); meshMarkers.delete(id); } });
      if (M.ui) M.ui.onEntityCount("mesh", seen.size);
      document.dispatchEvent(new CustomEvent("og:mesh-nodes", { detail: data }));
    }).catch(function () {});
  }
  // expose for click-to-center from mesh tab parity / region rebuild
  M.setEntityVisible = function (kind, on) {
    S.entity[kind] = !!on;
    localStorage.setItem("db_map_layer_" + kind, on ? "1" : "0");
    if (kind === "self") {
      S.gpsVisible = !!on;
      localStorage.setItem("og_gps_visible_v1", on ? "1" : "0");
      updateTopbarReadout();
      if (!on) { if (selfMarker) { selfMarker.remove(); selfMarker = null; selfPopup = null; } }
      else pollSelf();
      return;
    }
    var coll = kind === "tak" ? takMarkers : kind === "adsb" ? adsbMarkers : meshMarkers;
    coll.forEach(function (rec) { if (on) rec.marker.addTo(_map); else rec.marker.remove(); });
  };

  /* ----- self-GPS "DOOM BOX" marker ----- */
  var selfMarker = null, selfPopup = null, selfHasFix = null;
  var FALLBACK = [VEGAS.lon, VEGAS.lat];  // Vegas centre when no GPS fix

  function selfEl(hasFix) {
    var col  = hasFix ? "#E8B54A" : "#6C7C87";
    var glow = hasFix ? "rgba(232,181,74,0.55)" : "rgba(108,124,135,0.30)";
    var haloBox = hasFix
      ? "0 0 0 1px rgba(0,0,0,0.6) inset,0 0 8px 1px rgba(232,181,74,0.45)"
      : "0 0 0 1px rgba(0,0,0,0.6) inset,0 0 4px 1px rgba(108,124,135,0.25)";
    var wrap = document.createElement("div");
    wrap.style.cssText = "cursor:pointer;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 0 6px " + glow + ");";
    var ring = document.createElement("div");
    ring.style.cssText = "position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;";
    var halo = document.createElement("div");
    halo.style.cssText = "position:absolute;inset:0;border:2px solid " + col + ";border-radius:50%;box-shadow:" + haloBox + ";";
    ring.appendChild(halo);
    var offset = [0, 0];
    var r = SYM.render(SYM.sidcFor("self"), { size: 30 });
    if (r) {
      r.el.style.filter = "drop-shadow(0 0 2px rgba(0,0,0,0.85))" + (hasFix ? "" : " grayscale(1) opacity(0.55)");
      ring.appendChild(r.el); offset = r.offset;
    } else {
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "22"); svg.setAttribute("height", "22");
      svg.innerHTML = '<polygon points="12,2 14.6,9 22,9 16,13.5 18.3,21 12,16.5 5.7,21 8,13.5 2,9 9.4,9" fill="' + col + '" stroke="#0b0f10" stroke-width="0.8"/>';
      ring.appendChild(svg);
    }
    wrap.appendChild(ring);
    var lbl = document.createElement("div"); lbl.textContent = "DOOM BOX";
    lbl.style.cssText = "margin-top:2px;padding:1px 6px;font-family:var(--font-mono,monospace);font-size:10px;font-weight:700;letter-spacing:.08em;color:" + col + ";background:rgba(11,15,16,0.85);border:1px solid " + col + ";border-radius:2px;white-space:nowrap;";
    wrap.appendChild(lbl);
    if (!hasFix) {
      var nf = document.createElement("div"); nf.textContent = "NO FIX";
      nf.style.cssText = "margin-top:2px;padding:1px 5px;font-family:var(--font-mono,monospace);font-size:9px;letter-spacing:.10em;color:#6C7C87;background:rgba(11,15,16,0.9);border:1px solid #2a3540;border-radius:2px;white-space:nowrap;";
      wrap.appendChild(nf);
    }
    return { el: wrap, offset: offset };
  }

  function selfPopupHtml(p) {
    var hasFix = !!(p.fix && p.lat != null);
    var lat = hasFix ? p.lat : VEGAS.lat, lon = hasFix ? p.lon : VEGAS.lon;
    var mg = "—";
    try { if (window.mgrs) mg = M.fmtMgrs(window.mgrs.forward([lon, lat], 4)); } catch (e) {}
    var fixBadge = hasFix
      ? '<span style="color:#6ad27a">&#9679; GPS FIX</span>'
      : '<span style="color:#b05050">&#9679; NO FIX &mdash; FALLBACK (Vegas)</span>';
    var alt = p.alt_m != null ? p.alt_m.toFixed(0) + " m" : "—";
    var acc = p.accuracy_m != null ? "±" + p.accuracy_m + " m" : "—";
    return '<div class="dbm-mlpop"><b>DOOM BOX</b> <small>(self)</small><br>' + fixBadge +
      '<br><small><b>MGRS</b> ' + M.escapeHtml(mg) +
      '<br>' + lat.toFixed(5) + ', ' + lon.toFixed(5) +
      '<br><b>alt</b> ' + alt + ' &middot; <b>acc</b> ' + acc +
      '<br><b>sats</b> ' + (p.sats != null ? p.sats : "—") +
      ' &middot; ' + (p.age_s != null ? fmtAge(p.age_s) + " ago" : "live") + '</small></div>';
  }

  function pollSelf() {
    fetch("/api/gps", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
      if (!p) return;
      S.self = p;
      document.dispatchEvent(new CustomEvent("og:self-pos", { detail: p }));
      updateTopbarReadout();
      if (!_map) return;
      // respect layer toggle
      if (!S.entity.self) { if (selfMarker) { selfMarker.remove(); selfMarker = null; selfPopup = null; selfHasFix = null; } return; }
      var hasFix = !!(p.fix && p.lat != null && p.lon != null);
      var lat = hasFix ? p.lat : VEGAS.lat, lon = hasFix ? p.lon : VEGAS.lon;
      // recreate marker when fix state changes (different visual style)
      if (selfMarker && selfHasFix !== hasFix) { selfMarker.remove(); selfMarker = null; selfPopup = null; selfHasFix = null; }
      if (!selfMarker) {
        var m = selfEl(hasFix);
        selfPopup = new maplibregl.Popup({ offset: 26, closeButton: true, className: "dbm-mlpopup" }).setHTML(selfPopupHtml(p));
        selfMarker = new maplibregl.Marker({ element: m.el, offset: m.offset, anchor: "top" })
          .setLngLat([lon, lat]).setPopup(selfPopup).addTo(_map);
        selfHasFix = hasFix;
        m.el.addEventListener("click", function () { selfMarker.togglePopup(); });
      } else { selfMarker.setLngLat([lon, lat]); if (selfPopup) selfPopup.setHTML(selfPopupHtml(p)); }
    }).catch(function () {});
  }

  /* ----- start pollers (continuous, like V1) ----- */
  if (!M._pollersStarted) {
    M._pollersStarted = true;
    pollSelf(); setInterval(pollSelf, 30000);
    setInterval(pollUnits, 2000);
    setInterval(pollAdsb, 3000);
    setInterval(pollMesh, 5000);
    // initial entity polls fire once the map exists
    M.onReady(function () { pollUnits(); pollAdsb(); pollMesh(); });
  }

  /* ----- view helpers used by UI ----- */
  M.flyTo = function (lat, lon, z) { if (_map) _map.flyTo({ center: [lon, lat], zoom: z || Math.max(_map.getZoom(), 13), speed: 1.6 }); };
  M.recenter = function () { if (_map) _map.flyTo({ center: CENTER, zoom: ZOOM, speed: 1.4 }); };
  M.fitRegion = function () { if (_map && S.region.bbox) try { _map.fitBounds([[S.region.bbox[0], S.region.bbox[1]], [S.region.bbox[2], S.region.bbox[3]]], { padding: 40 }); } catch (e) {} };
  M.zoomBy = function (d) { if (_map) _map.easeTo({ zoom: _map.getZoom() + d, duration: 200 }); };
  M.resetBearing = function () { if (_map) _map.easeTo({ bearing: 0, pitch: 0, duration: 400 }); };

})(window.DBMap);
