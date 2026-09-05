/* ============================================================
   DOOM BOX V2 — MGRS REGION FETCHER  (NAIP by MGRS coordinate)
   Replaces the old region-switcher bottom bar (buildRegion, removed from
   map-ui.js — see ~/Desktop/CLANKER PLANS.md, "MGRS Region Fetcher" Stage 2).
   Operator types an MGRS grid reference -> client-side MGRS->center
   conversion (reuses M.parseCoord, same lib the map's own coord search
   already uses) -> a 20-mile-radius bbox is computed locally -> sent to
   /api/naip/estimate|download as {bbox, id}. Same self-contained slide-out
   panel shape as map-hires.js (the ZIP-based sibling panel, untouched,
   still available separately) — estimate -> download -> poll -> list ->
   quota -> delete, activation via M.setBasemap("hires", id), the exact
   same safe lazy-raster-layer mechanism map-hires.js already uses (works
   generically for any archive id, ZIP or MGRS-derived — confirmed by
   reading ensureHiresLayer/applyBasemap in map-core.js; NOT M.swapRegion,
   which is for map-region-fetcher's vector PMTiles regions, a different
   subsystem, and would touch the S.region/KNOWN/resolveRegion machinery
   this feature must stay clear of).
   Talks to /api/naip/* (naip-region-fetcher.service, Stage 1 bbox support).
   Attaches to window.DBMap.mgrsFetch. Exposes .mount(wrap).
   ============================================================ */
window.DBMap = window.DBMap || {};
(function (M) {
  "use strict";
  var wrap, refs = {};
  var pollTimer = null;
  var lastEstimate = null;

  var RADIUS_MI = 20.0;

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function svg(p, vb) { return '<svg viewBox="' + (vb || "0 0 24 24") + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; }
  var ICON_MGRS = svg('<circle cx="12" cy="12" r="9"/><path d="M12 3v3 M12 18v3 M3 12h3 M18 12h3"/><circle cx="12" cy="12" r="2" fill="currentColor"/>');

  function fmtMB(bytes) { return bytes ? (bytes / 1048576).toFixed(0) + " MB" : "—"; }
  function fmtGB(bytes) { return bytes ? (bytes / 1073741824).toFixed(2) + " GB" : "0 GB"; }
  function fmtETA(s) {
    if (!s || s <= 0) return "—";
    var m = Math.round(s / 60);
    return m < 60 ? m + " min" : (m / 60).toFixed(1) + " hr";
  }

  function api(method, path, body) {
    var opts = { method: method, headers: {}, cache: "no-store" };
    if (body != null) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(path, opts).then(function (r) { return r.json().catch(function () { return { ok: false, error: "bad response" }; }); });
  }

  /* ============================================================
     MGRS -> 20-mile-radius bbox  (client-side; reuses M.parseCoord,
     same MGRS lib the map's own coordinate search already loads —
     no new dependency, matches the reuse-what's-on-the-box instruction)
     ============================================================ */
  function mgrsToPatch(raw) {
    var mg = String(raw || "").replace(/\s+/g, "").toUpperCase();
    if (!mg) return { ok: false, error: "enter an MGRS grid reference" };
    var pc = M.parseCoord(mg);
    if (!pc || pc.fmt !== "MGRS") return { ok: false, error: "not a valid MGRS grid reference" };
    var radiusKm = RADIUS_MI * 1.609344;
    var dLat = radiusKm / 111.32;
    var dLon = radiusKm / (111.32 * Math.cos(pc.lat * Math.PI / 180));
    var bbox = [pc.lon - dLon, pc.lat - dLat, pc.lon + dLon, pc.lat + dLat];
    // MGRS strings are already alphanumeric starting with a digit (zone),
    // so the stripped/uppercased string satisfies the daemon's id slug
    // pattern (^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$) with no further sanitizing.
    return { ok: true, id: mg.slice(0, 40), lon: pc.lon, lat: pc.lat, bbox: bbox };
  }

  /* ============================================================
     MOUNT
     ============================================================ */
  M.mgrsFetch = M.mgrsFetch || {};
  M.mgrsFetch.mount = function (w) {
    wrap = w;
    buildTabButton();
    buildPanel();
    refresh();
  };

  function buildTabButton() {
    var b = el("button", "dbm-panel dbm-mgrsfetch-tab", ICON_MGRS);
    b.setAttribute("data-tip", "NAIP by MGRS");
    b.addEventListener("click", function () {
      [".dbm-rpanel", ".dbm-hpanel"].forEach(function (sel) {
        var p = wrap.querySelector(sel); if (p) p.classList.remove("open");
      });
      refs.panel.classList.toggle("open");
      if (refs.panel.classList.contains("open")) refresh();
    });
    wrap.appendChild(b);
    refs.tabBtn = b;
  }

  function buildPanel() {
    var p = el("div", "dbm-panel dbm-hpanel dbm-mgrsfetch-panel");
    var head = el("div", "rp-head"); head.innerHTML = '<span class="dbm-h">NAIP by MGRS &middot; ' + RADIUS_MI + '-mi radius</span>';
    var x = el("button", "rp-close", "✕"); head.appendChild(x); p.appendChild(head);
    x.addEventListener("click", function () { p.classList.remove("open"); });

    var body = el("div", "rp-body dbm-hires-body");

    var quota = el("div", "dbm-hires-quota");
    quota.innerHTML = '<div class="q-label">STORAGE <span class="q-txt">— / 20 GB</span></div><div class="q-bar"><i></i></div>';
    body.appendChild(quota); refs.quota = quota;

    var form = el("div", "dbm-hires-form");
    var row1 = el("div", "hf-row");
    var inp = el("input", "hf-zip"); inp.type = "text"; inp.placeholder = "MGRS grid ref (e.g. 11SQA1234567890)";
    var estBtn = el("button", "hf-btn", "ESTIMATE");
    row1.appendChild(inp); row1.appendChild(estBtn); form.appendChild(row1);

    var estOut = el("div", "hf-estimate"); form.appendChild(estOut); refs.estOut = estOut;

    var dlBtn = el("button", "hf-dlbtn", "DOWNLOAD"); dlBtn.disabled = true; form.appendChild(dlBtn);
    refs.dlBtn = dlBtn; refs.mgrsInput = inp;

    var prog = el("div", "hf-progress"); prog.style.display = "none"; form.appendChild(prog);
    refs.progress = prog;

    body.appendChild(form);

    var listHead = el("div", "dbm-grp", "— CACHED ARCHIVES —");
    body.appendChild(listHead);
    var list = el("div", "dbm-hires-list"); body.appendChild(list);
    refs.list = list;

    p.appendChild(body); wrap.appendChild(p);
    refs.panel = p;

    estBtn.addEventListener("click", doEstimate);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") doEstimate(); });
    dlBtn.addEventListener("click", doDownload);
    inp.addEventListener("input", function () { dlBtn.disabled = true; estOut.innerHTML = ""; lastEstimate = null; });
  }

  /* ============================================================
     ESTIMATE / DOWNLOAD
     ============================================================ */
  function doEstimate() {
    var patch = mgrsToPatch(refs.mgrsInput.value);
    if (!patch.ok) { toast(patch.error); return; }
    refs.estOut.innerHTML = '<div class="hf-loading">Querying NAIP coverage for ' + esc(patch.id) + " (this can take ~1-2 min for a 20-mi radius — many more tiles than a ZIP-sized area)…</div>";
    refs.dlBtn.disabled = true;
    api("POST", "/api/naip/estimate", { bbox: patch.bbox, id: patch.id }).then(function (r) {
      if (!r.ok) { refs.estOut.innerHTML = '<div class="hf-err">' + esc(r.error || "estimate failed") + "</div>"; return; }
      lastEstimate = r;
      refs.estOut.innerHTML =
        '<div class="hf-est-row"><span>Patch</span><b>' + esc(patch.id) + "</b></div>" +
        '<div class="hf-est-row"><span>Center</span><b>' + patch.lat.toFixed(4) + ", " + patch.lon.toFixed(4) + "</b></div>" +
        '<div class="hf-est-row"><span>Imagery</span><b>' + esc(r.acquisition_year) + " &middot; " + (r.resolution_m * 100) + " cm/px (overview-read)</b></div>" +
        '<div class="hf-est-row"><span>Tiles</span><b>' + r.tile_count + "</b></div>" +
        '<div class="hf-est-row"><span>Est. transfer</span><b>' + fmtGB(r.raw_size_bytes_est) + " (vs " + fmtGB(r.raw_size_bytes_est_fullres) + " full-res)</b></div>" +
        '<div class="hf-est-row"><span>Est. archive size</span><b>' + fmtMB(r.archive_size_bytes_est) + "</b></div>" +
        '<div class="hf-est-row"><span>Est. time</span><b>' + fmtETA(r.convert_eta_s_est) + " (mostly conversion, runs in background)</b></div>";
      refs.dlBtn.disabled = false;
    }).catch(function (e) { refs.estOut.innerHTML = '<div class="hf-err">' + esc(String(e)) + "</div>"; });
  }

  function doDownload() {
    if (!lastEstimate) return;
    var id = lastEstimate.id;
    refs.dlBtn.disabled = true;
    api("POST", "/api/naip/download", { bbox: lastEstimate.bbox, id: id }).then(function (r) {
      if (!r.ok) { toast(r.error || "download failed to start"); refs.dlBtn.disabled = false; return; }
      toast("Started — " + id + " will download + convert in the background (~" + fmtETA(lastEstimate.convert_eta_s_est) + ")");
      startPolling();
    });
  }

  /* ============================================================
     PROGRESS POLLING  (tile-count-based pct, per Stage 1's overview-read
     fetch loop — the same /api/naip/download/status endpoint map-hires.js
     polls; both panels share one daemon job slot, so only one fetch of
     EITHER kind can run at a time — same single-concurrent-job design the
     daemon has always had)
     ============================================================ */
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollStatus, 2000);
    pollStatus();
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function pollStatus() {
    api("GET", "/api/naip/download/status").then(function (r) {
      if (!r.ok) return;
      var st = r.state;
      if (st === "idle") {
        stopPolling();
        refs.progress.style.display = "none";
        refs.mgrsInput.value = ""; refs.estOut.innerHTML = ""; lastEstimate = null;
        refreshList(); refreshQuota();
        return;
      }
      if (st === "error") {
        stopPolling();
        refs.progress.innerHTML = '<div class="hf-err">' + esc(r.last_error || "job failed") + "</div>";
        return;
      }
      refs.progress.style.display = "";
      var label = { geocoding: "Resolving patch…", estimating: "Checking imagery availability…",
                    downloading_tiles: "Fetching overview imagery (tile " + (r.pct != null ? Math.round(r.pct * (r.tile_count || 1) / 100) : "?") + ")…",
                    converting: "Converting to map tiles (long step — safe to close this panel)…",
                    finalizing: "Finalizing…" }[st] || st;
      var barPct = st === "downloading_tiles" ? (r.pct || 0) : (st === "converting" || st === "finalizing" ? 100 : 5);
      refs.progress.innerHTML =
        '<div class="hf-phase">' + esc(r.zip || "") + " &middot; " + esc(label) + "</div>" +
        '<div class="hf-bar"><i style="width:' + barPct + '%"></i></div>' +
        '<div class="hf-meta">' + esc(r.last_log_line || "") + " &middot; " + fmtElapsed(r.elapsed_s) + " elapsed</div>";
    }).catch(function () {});
  }
  function fmtElapsed(s) { if (!s) return "0s"; var m = Math.floor(s / 60), sec = s % 60; return m ? (m + "m " + sec + "s") : (sec + "s"); }

  /* ============================================================
     LIST / QUOTA  (shared cache with map-hires.js — a ZIP archive and an
     MGRS archive are just two rows in the same list, distinguished below
     by id shape; same /api/naip/list|quota endpoints, no daemon changes
     needed for this — delete/list/quota were already generic over any id)
     ============================================================ */
  function refresh() { refreshList(); refreshQuota(); pollStatus(); }

  function refreshQuota() {
    api("GET", "/api/naip/quota").then(function (r) {
      if (!r.ok || !refs.quota) return;
      refs.quota.querySelector(".q-txt").textContent = fmtGB(r.used_bytes) + " / " + Math.round(r.quota_bytes / 1073741824) + " GB";
      var bar = refs.quota.querySelector(".q-bar i");
      bar.style.width = Math.min(100, r.pct) + "%";
      bar.style.background = r.pct > 90 ? "var(--red, #d73027)" : "var(--accent)";
    });
  }

  function refreshList() {
    api("GET", "/api/naip/list").then(function (r) {
      if (!r.ok || !refs.list) return;
      var list = refs.list; list.innerHTML = "";
      var mgrsArchives = r.archives.filter(function (a) { return !/^\d{5}$/.test(a.zip || ""); });
      if (!mgrsArchives.length) { list.appendChild(el("div", "dbm-empty", "No MGRS patches cached yet. Enter a grid reference above to fetch one.")); return; }
      mgrsArchives.forEach(function (a) { list.appendChild(archiveRow(a)); });
    });
  }

  function archiveRow(a) {
    var id = a.zip || a.id;
    var row = el("div", "dbm-hires-row");
    var active = M.state && M.state.basemap === "hires" && M.state.hiresZip === id;
    if (active) row.classList.add("active");
    row.innerHTML =
      '<div class="hr-top"><b>' + esc(id) + "</b><span class=\"hr-exp" + (a.days_left <= 3 ? " soon" : "") + '">expires in ' + a.days_left + " d</span></div>" +
      '<div class="hr-meta">' + esc(a.acquisition_year) + " &middot; " + (a.resolution_m * 100) + " cm/px &middot; " + fmtGB(a.size_bytes) + "</div>";
    var actions = el("div", "hr-actions");
    var useBtn = el("button", null, active ? "ACTIVE" : "USE AS BASEMAP");
    // Same activation path as map-hires.js: M.setBasemap lazily adds a raster
    // source/layer keyed by id (ensureHiresLayer/applyBasemap in map-core.js
    // are generic over any id string) — no reload, no S.region touch.
    if (!active) useBtn.addEventListener("click", function () { M.setBasemap("hires", id); refreshList(); toast("Basemap set to NAIP " + id); });
    var delBtn = el("button", "hr-del", "✕");
    delBtn.addEventListener("click", function () { confirmDelete(id); });
    actions.appendChild(useBtn); actions.appendChild(delBtn);
    row.appendChild(actions);
    return row;
  }

  function confirmDelete(id) {
    if (!window.confirm("Delete cached NAIP imagery for " + id + "? This can't be undone — you'd need to re-fetch to get it back.")) return;
    api("DELETE", "/api/naip/region?id=" + encodeURIComponent(id) + "&confirm=DELETE").then(function (r) {
      if (!r.ok) { toast(r.error || "delete failed"); return; }
      if (M.state && M.state.hiresZip === id) { M.setBasemap("vector"); }
      refreshList(); refreshQuota();
      toast("Deleted NAIP " + id);
    });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(msg) { if (M.ui && M.ui.toast) M.ui.toast(msg); }

})(window.DBMap);
