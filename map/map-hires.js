/* ============================================================
   DOOM BOX V2 — MAP HI-RES IMAGERY  (NAIP by ZIP code)
   Self-contained slide-in panel: enter a US ZIP, estimate size,
   download + convert (long-running background job on the Pi —
   ~30-40 min per ZIP, mostly the PMTiles conversion step, not
   the network fetch), list cached archives with expiry countdown
   and a per-archive quota gauge. Once downloaded, an archive is
   selectable as the map's basemap via M.setBasemap("hires", zip).
   Talks to /api/naip/* (naip-region-fetcher.service).
   Attaches to window.DBMap.hires. Exposes .mount(wrap).
   ============================================================ */
window.DBMap = window.DBMap || {};
(function (M) {
  "use strict";
  var wrap, refs = {};
  var pollTimer = null;
  var lastEstimate = null;

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function svg(p, vb) { return '<svg viewBox="' + (vb || "0 0 24 24") + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; }
  var ICON_HIRES = svg('<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 15l5-5 4 4 4-5 5 6"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/>');

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
     MOUNT
     ============================================================ */
  M.hires = M.hires || {};
  M.hires.mount = function (w) {
    wrap = w;
    buildTabButton();
    buildPanel();
    refresh();
  };

  function buildTabButton() {
    var b = el("button", "dbm-panel dbm-hires-tab", ICON_HIRES);
    b.setAttribute("data-tip", "Hi-Res Imagery (NAIP)");
    b.addEventListener("click", function () {
      if (refs.layersPanel) refs.layersPanel.classList.remove("open");
      refs.panel.classList.toggle("open");
      if (refs.panel.classList.contains("open")) refresh();
    });
    wrap.appendChild(b);
    refs.tabBtn = b;
    // If the Layers panel exists (built earlier in map-ui.js's mount order),
    // make opening it close this one — avoids two right-side panels stacked.
    refs.layersPanel = wrap.querySelector(".dbm-rpanel");
    var layersBtn = wrap.querySelector(".dbm-layers-btn");
    if (layersBtn) layersBtn.addEventListener("click", function () { refs.panel.classList.remove("open"); });
  }

  function buildPanel() {
    var p = el("div", "dbm-panel dbm-hpanel");
    var head = el("div", "rp-head"); head.innerHTML = '<span class="dbm-h">Hi-Res Imagery &middot; NAIP</span>';
    var x = el("button", "rp-close", "✕"); head.appendChild(x); p.appendChild(head);
    x.addEventListener("click", function () { p.classList.remove("open"); });

    var body = el("div", "rp-body dbm-hires-body");

    // --- quota gauge ---
    var quota = el("div", "dbm-hires-quota");
    quota.innerHTML = '<div class="q-label">STORAGE <span class="q-txt">— / 20 GB</span></div><div class="q-bar"><i></i></div>';
    body.appendChild(quota); refs.quota = quota;

    // --- ZIP input / estimate / download ---
    var form = el("div", "dbm-hires-form");
    var row1 = el("div", "hf-row");
    var inp = el("input", "hf-zip"); inp.type = "text"; inp.inputMode = "numeric"; inp.maxLength = 5; inp.placeholder = "ZIP code (5 digits)";
    var estBtn = el("button", "hf-btn", "ESTIMATE");
    row1.appendChild(inp); row1.appendChild(estBtn); form.appendChild(row1);

    var estOut = el("div", "hf-estimate"); form.appendChild(estOut); refs.estOut = estOut;

    var dlBtn = el("button", "hf-dlbtn", "DOWNLOAD"); dlBtn.disabled = true; form.appendChild(dlBtn);
    refs.dlBtn = dlBtn; refs.zipInput = inp;

    var prog = el("div", "hf-progress"); prog.style.display = "none"; form.appendChild(prog);
    refs.progress = prog;

    body.appendChild(form);

    // --- cached archives list ---
    var listHead = el("div", "dbm-grp", "— CACHED ARCHIVES —");
    body.appendChild(listHead);
    var list = el("div", "dbm-hires-list"); body.appendChild(list);
    refs.list = list;

    p.appendChild(body); wrap.appendChild(p);
    refs.panel = p;

    estBtn.addEventListener("click", doEstimate);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") doEstimate(); });
    dlBtn.addEventListener("click", doDownload);
    inp.addEventListener("input", function () { inp.value = inp.value.replace(/\D/g, "").slice(0, 5); dlBtn.disabled = true; estOut.innerHTML = ""; lastEstimate = null; });
  }

  /* ============================================================
     ESTIMATE / DOWNLOAD
     ============================================================ */
  function doEstimate() {
    var zip = refs.zipInput.value.trim();
    if (!/^\d{5}$/.test(zip)) { toast("Enter a 5-digit ZIP code"); return; }
    refs.estOut.innerHTML = '<div class="hf-loading">Looking up ' + zip + "…</div>";
    refs.dlBtn.disabled = true;
    api("POST", "/api/naip/estimate", { zip: zip }).then(function (r) {
      if (!r.ok) { refs.estOut.innerHTML = '<div class="hf-err">' + esc(r.error || "estimate failed") + "</div>"; return; }
      lastEstimate = r;
      refs.estOut.innerHTML =
        '<div class="hf-est-row"><span>Area</span><b>' + esc(r.place || zip) + "</b></div>" +
        '<div class="hf-est-row"><span>Imagery</span><b>' + esc(r.acquisition_year) + " &middot; " + (r.resolution_m * 100) + " cm/px</b></div>" +
        '<div class="hf-est-row"><span>Tiles</span><b>' + r.tile_count + "</b></div>" +
        '<div class="hf-est-row"><span>Est. size</span><b>' + fmtGB(r.archive_size_bytes_est) + "</b></div>" +
        '<div class="hf-est-row"><span>Est. time</span><b>' + fmtETA(r.convert_eta_s_est) + " (mostly conversion, runs in background)</b></div>";
      refs.dlBtn.disabled = false;
    }).catch(function (e) { refs.estOut.innerHTML = '<div class="hf-err">' + esc(String(e)) + "</div>"; });
  }

  function doDownload() {
    if (!lastEstimate) return;
    var zip = lastEstimate.zip;
    refs.dlBtn.disabled = true;
    api("POST", "/api/naip/download", { zip: zip }).then(function (r) {
      if (!r.ok) { toast(r.error || "download failed to start"); refs.dlBtn.disabled = false; return; }
      toast("Started — " + zip + " will download + convert in the background (~" + fmtETA(lastEstimate.convert_eta_s_est) + ")");
      startPolling();
    });
  }

  /* ============================================================
     PROGRESS POLLING
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
        refs.zipInput.value = ""; refs.estOut.innerHTML = ""; lastEstimate = null;
        refreshList(); refreshQuota();
        return;
      }
      if (st === "error") {
        stopPolling();
        refs.progress.innerHTML = '<div class="hf-err">' + esc(r.last_error || "job failed") + "</div>";
        return;
      }
      refs.progress.style.display = "";
      var label = { geocoding: "Looking up ZIP…", estimating: "Checking imagery availability…",
                    downloading_tiles: "Downloading source imagery…", converting: "Converting to map tiles (long step — safe to close this panel)…",
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
     LIST / QUOTA
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
      if (!r.archives.length) { list.appendChild(el("div", "dbm-empty", "No hi-res archives cached yet. Enter a ZIP above to download one.")); return; }
      r.archives.forEach(function (a) { list.appendChild(archiveRow(a)); });
    });
  }

  function archiveRow(a) {
    var row = el("div", "dbm-hires-row");
    var active = M.state && M.state.basemap === "hires" && M.state.hiresZip === a.zip;
    if (active) row.classList.add("active");
    row.innerHTML =
      '<div class="hr-top"><b>' + esc(a.zip) + "</b><span class=\"hr-exp" + (a.days_left <= 3 ? " soon" : "") + '">expires in ' + a.days_left + " d</span></div>" +
      '<div class="hr-meta">' + esc(a.acquisition_year) + " &middot; " + (a.resolution_m * 100) + " cm/px &middot; " + fmtGB(a.size_bytes) + "</div>";
    var actions = el("div", "hr-actions");
    var useBtn = el("button", null, active ? "ACTIVE" : "USE AS BASEMAP");
    if (!active) useBtn.addEventListener("click", function () { M.setBasemap("hires", a.zip); refreshList(); toast("Basemap set to NAIP " + a.zip); });
    var delBtn = el("button", "hr-del", "✕");
    delBtn.addEventListener("click", function () { confirmDelete(a.zip); });
    actions.appendChild(useBtn); actions.appendChild(delBtn);
    row.appendChild(actions);
    return row;
  }

  function confirmDelete(zip) {
    if (!window.confirm("Delete cached NAIP imagery for ZIP " + zip + "? This can't be undone — you'd need to re-download (~30-40 min) to get it back.")) return;
    api("DELETE", "/api/naip/region?zip=" + encodeURIComponent(zip) + "&confirm=DELETE").then(function (r) {
      if (!r.ok) { toast(r.error || "delete failed"); return; }
      if (M.state && M.state.hiresZip === zip) { M.setBasemap("vector"); }
      refreshList(); refreshQuota();
      toast("Deleted NAIP " + zip);
    });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(msg) { if (M.ui && M.ui.toast) M.ui.toast(msg); }

})(window.DBMap);
