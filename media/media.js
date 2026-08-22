/* ============================================================
   DOOM BOX — MEDIA UI (LIVE)
   Kiwix library + SanDisk browser (grid/list, virtual scroll),
   REAL media overlays, ZIM->Kiwix, unified search (files + ZIM
   article content). DBMedia.mount(). Driven by /api/media/* +
   Kiwix :8888. Media served from /media/<rel> (Range static).
   ============================================================ */
window.DBMedia = window.DBMedia || {};
(function (M) {
  "use strict";
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function svg(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }

  var ICON = {
    folder: svg('<path d="M3 6 H9 L11 8 H21 V19 H3 Z"/>'),
    video: svg('<rect x="3" y="5" width="18" height="14"/><path d="M10 9 L15 12 L10 15 Z" fill="currentColor" stroke="none"/>'),
    audio: svg('<path d="M3 12 H5 L8 7 V17 L11 12 H13"/><path d="M16 8 a5 5 0 0 1 0 8 M18.5 5.5 a8.5 8.5 0 0 1 0 13"/>'),
    image: svg('<rect x="3" y="4" width="18" height="16"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 18 L9 13 L13 16 L16 13 L20 17"/>'),
    doc: svg('<path d="M6 3 H14 L19 8 V21 H6 Z"/><path d="M14 3 V8 H19"/><path d="M9 13 H16 M9 16.5 H16"/>'),
    zim: svg('<path d="M5 4 H17 a2 2 0 0 1 2 2 V20 H7 a2 2 0 0 1-2-2 Z"/><path d="M5 18 a2 2 0 0 1 2-2 H19"/>'),
    book: svg('<path d="M5 4 H17 a2 2 0 0 1 2 2 V20 H7 a2 2 0 0 1-2-2 Z"/><path d="M5 18 a2 2 0 0 1 2-2 H19"/>'),
    cross: svg('<rect x="4" y="4" width="16" height="16"/><path d="M12 8 V16 M8 12 H16"/>'),
    star: svg('<path d="M12 3 L14.5 9 L21 9.5 L16 14 L17.5 20.5 L12 17 L6.5 20.5 L8 14 L3 9.5 L9.5 9 Z"/>'),
    wrench: svg('<path d="M14 6 a4 4 0 0 0-5.5 4.5 L4 15 L6 17 L10.5 12.5 A4 4 0 0 0 15 7 L12.5 9.5 L11 8 L13 6 Z"/>'),
    globe: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12 H20.5 M12 3.5 C15 6.5 15 17.5 12 20.5 C9 17.5 9 6.5 12 3.5 Z"/>'),
    play: svg('<path d="M7 5 L19 12 L7 19 Z" fill="currentColor" stroke="none"/>'),
    map: svg('<path d="M9 4 L3 6 V20 L9 18 L15 20 L21 18 V4 L15 6 Z"/><path d="M9 4 V18 M15 6 V20"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16 L21 21"/>')
  };
  var CATICON = { reference: 'book', military: 'star', medical: 'cross', technical: 'wrench', geographic: 'globe' };

  var ST, wrap, refs;
  var ROW_H = 30, BUF = 6;

  function alive() { return wrap && wrap.isConnected; }

  M.mount = function (container) {
    ['.med-overlay', '.med-dialog', '.med-toast'].forEach(function (s) { [].forEach.call(document.querySelectorAll(s), function (e) { e.remove(); }); });
    ST = { libCat: 'all', libSearch: '', cwd: '', view: 'list', sort: 'name', dir: 1, filter: 'all', _entries: [], _images: [], _uToken: null, _libToken: null, _navSeq: 0 };
    container.style.padding = '0'; container.style.position = 'relative'; container.style.overflow = 'hidden';
    container.innerHTML = ''; wrap = el('div', 'med'); container.appendChild(wrap); refs = {};
    var body = el('div', 'med-body'); wrap.appendChild(body);
    buildLib(body); buildFB(body); buildUnified(); buildOverlay(); buildDialog(); buildToast();
    // initial live loads
    renderLibLoading();
    M.loadStorage().then(function () { if (alive()) { renderStorage(refs.libStore); renderStorage(refs.fbStore); } });
    M.loadCatalog().then(function () { if (alive()) renderLib(); }).catch(function () { if (alive()) renderLibError(); });
    loadCwd('');
  };

  /* ============================================================ LIBRARY */
  function buildLib(body) {
    var lib = el('div', 'med-lib med-brk'); body.appendChild(lib); refs.lib = lib;
    var head = el('div', 'med-lib-head');
    head.innerHTML = '<div class="top"><span class="med-sec-h">OFFLINE LIBRARY</span></div><div class="sub"></div>' +
      '<div class="med-libsearch"><span class="ic">' + ICON.search + '</span><input placeholder="Search article content across all ZIMs…"><span class="tag">FULL-TEXT · KIWIX :8888</span></div>';
    lib.appendChild(head); refs.libSub = head.querySelector('.sub');
    refs.libSearchInput = head.querySelector('input');
    refs.libSearchInput.addEventListener('input', function () { ST.libSearch = this.value; scheduleLibSearch(); });
    var cats = el('div', 'med-cats'); lib.appendChild(cats); refs.cats = cats;
    var catList = [['all', 'ALL', '']].concat(Object.keys(M.CATS).map(function (k) { return [k, M.CATS[k].label, M.CATS[k].color]; }));
    catList.forEach(function (c) {
      var b = el('button', 'med-cat' + (c[0] === 'all' ? ' on' : ''), (c[2] ? '<span class="dt" style="background:' + c[2] + '"></span>' : '') + c[1]);
      b.addEventListener('click', function () { ST.libCat = c[0]; [].forEach.call(cats.children, function (n) { n.classList.remove('on'); }); b.classList.add('on'); renderZims(); });
      cats.appendChild(b);
    });
    refs.zimWrap = el('div', 'med-zimwrap'); lib.appendChild(refs.zimWrap);
    var foot = el('div', 'med-lib-foot'); foot.innerHTML = '<div class="med-sec-h">SANDISK STORAGE</div><div class="med-storage" id="medLibStore"></div>'; lib.appendChild(foot);
    refs.libStore = foot.querySelector('#medLibStore');
  }
  function renderLibLoading() { refs.libSub.textContent = 'Loading Kiwix catalog…'; refs.zimWrap.innerHTML = '<div class="med-empty">Loading offline library…</div>'; }
  function renderLibError() { refs.libSub.textContent = 'Kiwix catalog unavailable'; refs.zimWrap.innerHTML = '<div class="med-empty">Could not reach Kiwix on :8888</div>'; }
  function renderLib() {
    var gb = (M.totalZimBytes() / 1073741824).toFixed(1);
    refs.libSub.innerHTML = '<b>' + M.zims.length + '</b> libraries loaded · <b>' + M.zimOnDisk.files + '</b> ZIM files · <b>' + gb + ' GB</b> on disk';
    renderZims();
  }
  function fmtCount(n) { return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(0) + 'K' : n; }

  var libSearchTimer = null;
  function scheduleLibSearch() { clearTimeout(libSearchTimer); libSearchTimer = setTimeout(renderZims, 320); }
  function renderZims() {
    var w = refs.zimWrap; var q = ST.libSearch.trim();
    if (q) {
      w.innerHTML = '<div class="med-empty">Searching Kiwix…</div>';
      var tok = ST._libToken = {}; var myq = q;
      M.searchLibraries(q, 30).then(function (hits) {
        if (!alive() || ST._libToken !== tok) return;
        w.innerHTML = '';
        if (!hits.length) { w.appendChild(el('div', 'med-empty', 'No articles match “' + esc(myq) + '”')); return; }
        hits.forEach(function (h) {
          var color = (M.CATS[h.cat] || M.CATS.reference).color;
          var row = el('div', 'med-zim'); row.style.setProperty('--cat', color); row.style.cursor = 'pointer';
          row.innerHTML = '<div class="zt"><div class="zicon">' + ICON.doc + '</div><div class="zmeta"><div class="ztitle">' + esc(h.title) + '</div>' +
            '<div class="zsub">article · <b style="color:' + color + '">' + esc(h.zim) + '</b></div>' +
            (h.snippet ? '<div class="zstats" style="display:block;line-height:1.4">' + esc(h.snippet) + '…</div>' : '') + '</div></div>';
          row.addEventListener('click', function () { openKiwix(h.href, h.title); });
          w.appendChild(row);
        });
      });
      return;
    }
    w.innerHTML = '';
    var list = M.zims.filter(function (z) { return ST.libCat === 'all' || z.cat === ST.libCat; });
    if (!list.length) { w.appendChild(el('div', 'med-empty', 'No libraries in this category')); return; }
    list.forEach(function (z) {
      var color = (M.CATS[z.cat] || M.CATS.reference).color;
      var card = el('div', 'med-zim'); card.style.setProperty('--cat', color);
      card.innerHTML =
        '<div class="zt"><div class="zicon">' + (ICON[CATICON[z.cat]] || ICON.book) + '</div>' +
        '<div class="zmeta"><div class="ztitle">' + esc(z.title) + '</div>' +
        '<div class="zsub">' + (M.CATS[z.cat] || M.CATS.reference).label + '<span class="zlang">' + esc(z.lang) + '</span></div>' +
        (z.summary ? '<div class="zsub" style="color:var(--text-2);margin-top:5px">' + esc(z.summary) + '</div>' : '') +
        '<div class="zstats"><span>' + M.fmtSize(z.sizeBytes) + '</span><span><b>' + fmtCount(z.articles) + '</b> articles</span>' + (z.media ? '<span><b>' + fmtCount(z.media) + '</b> media</span>' : '') + '</div></div></div>' +
        '<div class="zfoot"><button class="zopen">OPEN ▸</button>' + (z.updated ? '<span class="zdate">updated ' + esc(z.updated) + '</span>' : '') + '</div>';
      card.querySelector('.zopen').addEventListener('click', function () { openKiwix(M.zimViewUrl(z.id), z.title); });
      w.appendChild(card);
    });
  }
  function openKiwix(url, title) { window.open(url, '_blank', 'noopener'); toast('ok', 'Opening in Kiwix :8888 — ' + (title || '')); }

  function renderStorage(node) {
    if (!node) return;
    var s = M.STORAGE; if (!s.total) { node.innerHTML = '<div class="track"><i style="width:0%"></i></div><div class="lbl"><span>loading…</span></div>'; return; }
    var pct = s.used / s.total * 100;
    node.innerHTML = '<div class="track"><i style="width:' + pct.toFixed(1) + '%"></i></div><div class="lbl"><span><b>' + M.fmtSize(s.used) + '</b> used</span><span>' + M.fmtSize(s.free) + ' free of ' + M.fmtSize(s.total) + '</span></div>';
  }

  /* ============================================================ FILE BROWSER */
  function buildFB(body) {
    var fb = el('div', 'med-fb med-brk'); body.appendChild(fb); refs.fb = fb;
    var head = el('div', 'med-fb-head');
    head.innerHTML = '<div class="top"><span class="med-sec-h">SANDISK 1TB</span><div class="med-storage" id="medFbStore"></div></div>' +
      '<div class="med-toolbar"><div class="med-crumb" id="medCrumb"></div>' +
      '<div class="med-tb-group" id="medView"><button data-v="grid">▦ GRID</button><button data-v="list" class="on">≣ LIST</button></div>' +
      '<select class="med-select" id="medSort"><option value="name">NAME</option><option value="date">DATE</option><option value="size">SIZE</option><option value="type">TYPE</option></select>' +
      '<select class="med-select" id="medFilter"><option value="all">ALL TYPES</option><option value="folder">FOLDERS</option><option value="video">VIDEO</option><option value="audio">AUDIO</option><option value="image">IMAGES</option><option value="doc">DOCS</option><option value="zim">ZIM</option></select></div>';
    fb.appendChild(head);
    refs.fbStore = head.querySelector('#medFbStore'); refs.crumb = head.querySelector('#medCrumb');
    head.querySelector('#medView').addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (!b) return; ST.view = b.getAttribute('data-v'); [].forEach.call(this.children, function (n) { n.classList.toggle('on', n === b); }); renderFiles(); });
    head.querySelector('#medSort').addEventListener('change', function () { ST.sort = this.value; renderFiles(); });
    head.querySelector('#medFilter').addEventListener('change', function () { ST.filter = this.value; renderFiles(); });
    refs.files = el('div', 'med-files list'); fb.appendChild(refs.files);
    refs.files.addEventListener('scroll', function () { if (ST._virtual) renderVirtual(); });
  }
  function navTo(cwd) { loadCwd(cwd); }
  function loadCwd(cwd) {
    ST.cwd = cwd; renderCrumb();
    var seq = ++ST._navSeq;
    refs.files.className = 'med-files ' + ST.view;
    refs.files.innerHTML = '<div class="med-empty">Loading ' + (cwd ? esc(cwd) : '/') + ' …</div>'; ST._virtual = false;
    M.listDir(cwd, true).then(function (d) {
      if (!alive() || seq !== ST._navSeq) return;
      ST._rawEntries = d.entries; renderFiles();
    }).catch(function (e) {
      if (!alive() || seq !== ST._navSeq) return;
      refs.files.innerHTML = '<div class="med-empty">Could not list ' + esc(cwd || '/') + '<br><span style="font-size:.6rem">' + esc(e.message || e) + '</span></div>';
    });
  }
  function renderCrumb() {
    var c = refs.crumb; c.innerHTML = '';
    var segs = ST.cwd ? ST.cwd.replace(/^\//, '').split('/') : [];
    var root = el('span', 'seg' + (segs.length === 0 ? ' cur' : ''), 'SANDISK');
    root.addEventListener('click', function () { navTo(''); });
    c.appendChild(root);
    var acc = '';
    segs.forEach(function (s, i) {
      acc += '/' + s; var target = acc;
      c.appendChild(el('span', 'sep', '/'));
      var seg = el('span', 'seg' + (i === segs.length - 1 ? ' cur' : ''), esc(s));
      seg.addEventListener('click', function () { navTo(target); });
      c.appendChild(seg);
    });
  }
  function currentEntries() {
    var items = (ST._rawEntries || []).filter(function (e) { return !e.hidden; });
    if (ST.filter !== 'all') items = items.filter(function (x) { return x.type === ST.filter; });
    var k = ST.sort;
    items.sort(function (a, b) {
      if (a.kind === 'folder' && b.kind !== 'folder') return -1;
      if (b.kind === 'folder' && a.kind !== 'folder') return 1;
      if (k === 'size') return (b.size || 0) - (a.size || 0);
      if (k === 'date') return (b.dateMs || 0) - (a.dateMs || 0);
      if (k === 'type') return (a.type).localeCompare(b.type) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return items;
  }
  function renderFiles() {
    var items = currentEntries();
    ST._items = items;
    ST._images = items.filter(function (x) { return x.kind === 'image'; });
    refs.files.className = 'med-files ' + ST.view;
    if (!items.length) { refs.files.innerHTML = '<div class="med-empty">EMPTY FOLDER</div>'; ST._virtual = false; return; }
    if (ST.view === 'list' && items.length > 80) { setupVirtual(items); return; }
    ST._virtual = false;
    var grid = el('div', 'med-grid');
    if (ST.view === 'list') grid.appendChild(listHead());
    items.forEach(function (it) { grid.appendChild(tileEl(it)); });
    refs.files.innerHTML = ''; refs.files.appendChild(grid);
  }
  function listHead() { return el('div', 'med-listhead', '<span></span><span>NAME</span><span>SIZE</span><span>TYPE</span><span>MODIFIED</span>'); }
  function metaText(it) { return it.kind === 'folder' ? 'DIR' : M.fmtSize(it.size); }
  function tileEl(it) {
    var icon = ICON[it.type] || ICON.doc;
    var tile = el('div', 'med-tile');
    if (ST.view === 'grid') {
      tile.innerHTML = '<div class="thumb"><span class="ft-' + it.type + '">' + icon + '</span></div>' +
        '<div class="nm">' + esc(it.name) + '</div><div class="mt">' + metaText(it) + '</div>';
    } else {
      tile.innerHTML = '<span class="thumb"><span class="ft-' + it.type + '">' + icon + '</span></span>' +
        '<span class="nm">' + esc(it.name) + '</span>' +
        '<span class="mt">' + metaText(it) + '</span>' +
        '<span class="ltype">' + esc(it.kind) + '</span>' +
        '<span class="mt">' + (it.date || '—') + '</span>';
    }
    tile.addEventListener('click', function () { openEntry(it); });
    return tile;
  }
  function setupVirtual(items) {
    ST._virtual = true; refs.files.innerHTML = '';
    var head = listHead(); head.style.position = 'sticky'; head.style.top = '0'; head.style.zIndex = '3'; head.style.background = 'var(--bg-primary)';
    refs.files.appendChild(head);
    var spacer = el('div'); spacer.style.height = (items.length * ROW_H) + 'px'; spacer.style.position = 'relative';
    refs.vport = el('div'); refs.vport.style.position = 'absolute'; refs.vport.style.left = '0'; refs.vport.style.right = '0'; refs.vport.style.top = '0';
    spacer.appendChild(refs.vport); refs.files.appendChild(spacer); renderVirtual();
  }
  function renderVirtual() {
    var items = ST._items, scroll = refs.files.scrollTop;
    var start = Math.max(0, Math.floor(scroll / ROW_H) - BUF);
    var visible = Math.ceil(refs.files.clientHeight / ROW_H) + BUF * 2;
    var end = Math.min(items.length, start + visible);
    refs.vport.style.transform = 'translateY(' + (start * ROW_H) + 'px)';
    refs.vport.innerHTML = '';
    for (var i = start; i < end; i++) { var t = tileEl(items[i]); t.style.height = ROW_H + 'px'; refs.vport.appendChild(t); }
  }

  function openEntry(it) {
    if (it.kind === 'folder') { navTo(it.path); refs.files.scrollTop = 0; return; }
    if (it.kind === 'zim') { openZimDialog(it); return; }
    if (it.kind === 'pmtiles') { openPmtiles(it); return; }
    openOverlay(it);
  }

  /* ============================================================ OVERLAY (real players) */
  function buildOverlay() {
    var ov = el('div', 'med-overlay'); refs.overlay = ov; document.body.appendChild(ov);
    ov.innerHTML = '<div class="med-ov-panel"><div class="med-ov-head"><span class="ot"></span><span class="op"></span><button class="ox">✕</button></div><div class="med-ov-body"></div></div>';
    refs.ovTitle = ov.querySelector('.ot'); refs.ovMeta = ov.querySelector('.op'); refs.ovBody = ov.querySelector('.med-ov-body');
    ov.querySelector('.ox').addEventListener('click', closeOverlay);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeOverlay(); });
    document.addEventListener('keydown', overlayKeys);
  }
  function overlayKeys(e) {
    if (!refs.overlay || !refs.overlay.classList.contains('show')) return;
    if (e.key === 'Escape') return closeOverlay();
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && refs._imgIdx != null) { stepImage(e.key === 'ArrowRight' ? 1 : -1); }
  }
  function openOverlay(it) {
    refs.ovTitle.textContent = it.name;
    refs.ovMeta.textContent = M.fmtSize(it.size) + (it.date ? ' · ' + it.date : '');
    var b = refs.ovBody; b.className = 'med-ov-body'; b.innerHTML = ''; refs._imgIdx = null;
    if (it.kind === 'video') {
      var v = el('video'); v.controls = true; v.autoplay = true; v.preload = 'metadata'; v.src = it.url;
      b.appendChild(v); refs.ovMeta.textContent += ' · HTML5 video (Range)';
    } else if (it.kind === 'audio') {
      b.className = 'med-ov-body audio';
      var a = el('audio'); a.controls = true; a.autoplay = true; a.src = it.url; a.style.width = 'min(560px,74vw)';
      b.appendChild(a);
    } else if (it.kind === 'image') {
      refs._imgIdx = ST._images.indexOf(it);
      var img = el('img'); img.src = it.url; img.alt = it.name; b.appendChild(img);
      if (ST._images.length > 1) refs.ovMeta.textContent += ' · ' + (refs._imgIdx + 1) + '/' + ST._images.length + ' · ←/→';
    } else if (it.kind === 'pdf') {
      var f = el('iframe'); f.src = it.url; f.style.cssText = 'width:min(900px,86vw);height:80vh;border:none;background:#fff'; b.appendChild(f);
    } else if (it.kind === 'text') {
      b.innerHTML = '<div class="med-empty">Loading…</div>';
      M.fileText(it.url).then(function (txt) {
        if (!refs.overlay.classList.contains('show')) return;
        var trunc = txt.length >= 1048576;
        var pre = el('pre'); pre.textContent = txt + (trunc ? '\n\n— truncated at 1 MiB —' : '');
        pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono);font-size:.66rem;color:var(--text-1);padding:18px;max-width:min(820px,86vw);max-height:74vh;overflow:auto;margin:0;text-align:left';
        b.innerHTML = ''; b.appendChild(pre);
      }).catch(function () { b.innerHTML = downloadCard(it, 'Could not load text'); });
    } else {
      b.innerHTML = downloadCard(it, 'No inline preview for this file type');
    }
    refs.overlay.classList.add('show');
  }
  function downloadCard(it, msg) {
    return '<div style="display:grid;place-items:center;gap:14px;padding:50px 40px;color:var(--orange)">' + ICON.doc +
      '<div style="font-family:var(--font-mono);font-size:.64rem;color:var(--text-2);text-align:center">' + esc(msg) + '<br>' + esc(it.name) + ' · ' + M.fmtSize(it.size) + '</div>' +
      '<a href="' + it.url + '" download style="font-family:var(--font-mono);font-size:.6rem;letter-spacing:.08em;padding:8px 16px;border:1px solid var(--accent);color:var(--accent);text-decoration:none">⬇ DOWNLOAD</a></div>';
  }
  function stepImage(dir) {
    if (refs._imgIdx == null || !ST._images.length) return;
    refs._imgIdx = (refs._imgIdx + dir + ST._images.length) % ST._images.length;
    var it = ST._images[refs._imgIdx];
    refs.ovTitle.textContent = it.name;
    refs.ovMeta.textContent = M.fmtSize(it.size) + (it.date ? ' · ' + it.date : '') + ' · ' + (refs._imgIdx + 1) + '/' + ST._images.length + ' · ←/→';
    refs.ovBody.innerHTML = ''; var img = el('img'); img.src = it.url; img.alt = it.name; refs.ovBody.appendChild(img);
  }
  function closeOverlay() { refs.overlay.classList.remove('show'); refs.ovBody.innerHTML = ''; refs._imgIdx = null; }

  /* ---- pmtiles inspector ---- */
  function openPmtiles(it) {
    refs.ovTitle.textContent = it.name;
    refs.ovMeta.textContent = M.fmtSize(it.size) + ' · PMTiles archive';
    var b = refs.ovBody; b.className = 'med-ov-body'; b.innerHTML = '<div class="med-empty">Inspecting archive…</div>'; refs._imgIdx = null;
    refs.overlay.classList.add('show');
    M.pmtilesInfo(it.path).then(function (r) {
      if (!refs.overlay.classList.contains('show')) return;
      if (r && r.ok && (r.raw || r.info || r.output)) {
        var pre = el('pre'); pre.textContent = r.raw || r.info || r.output;
        pre.style.cssText = 'white-space:pre-wrap;font-family:var(--font-mono);font-size:.66rem;color:var(--text-1);padding:18px;max-width:min(820px,86vw);max-height:74vh;overflow:auto;margin:0;text-align:left';
        b.innerHTML = ''; b.appendChild(pre);
      } else {
        b.innerHTML = '<div style="display:grid;place-items:center;gap:14px;padding:46px 40px;color:var(--orange);text-align:center">' + ICON.map +
          '<div style="font-family:var(--font-mono);font-size:.64rem;color:var(--text-2)">PMTiles archive could not be read<br>' + esc((r && (r.err || r.error)) || 'incomplete or corrupt (e.g. partial .aria2 download)') + '</div>' +
          '<a href="' + it.url + '" download style="font-family:var(--font-mono);font-size:.6rem;padding:8px 16px;border:1px solid var(--accent);color:var(--accent);text-decoration:none">⬇ DOWNLOAD</a></div>';
      }
    }).catch(function () { if (refs.overlay.classList.contains('show')) b.innerHTML = downloadCard(it, 'PMTiles inspector error'); });
  }

  /* ============================================================ ZIM CONFIRM DIALOG */
  function buildDialog() {
    var d = el('div', 'med-dialog'); refs.dialog = d; document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d) d.classList.remove('show'); });
  }
  function openZimDialog(it) {
    var bookid = M.bookIdForFile(it.name), loaded = M.isLoadedZim(it.name);
    var bodyHtml, footHtml;
    if (loaded) {
      bodyHtml = 'This is a ZIM archive loaded by Kiwix. Open it in the reader on :8888?<div class="p">' + esc(it.name) + '<br>' + M.fmtSize(it.size) + ' · book id ' + esc(bookid) + '</div>';
      footHtml = '<button class="med-db" data-x="cancel">CANCEL</button><button class="med-db amber" data-x="open">OPEN IN KIWIX</button>';
    } else {
      bodyHtml = 'This ZIM is on disk but <b>not loaded by Kiwix</b> (likely an incomplete / truncated download). It can\'t be opened in the reader.<div class="p">' + esc(it.name) + '<br>' + M.fmtSize(it.size) + '</div>';
      footHtml = '<button class="med-db" data-x="cancel">CANCEL</button><a class="med-db amber" href="' + it.url + '" download style="text-decoration:none">DOWNLOAD FILE</a>';
    }
    refs.dialog.innerHTML = '<div class="med-dialog-p"><div class="med-dialog-h">' + (loaded ? 'OPEN IN KIWIX?' : 'ZIM NOT LOADED') + '</div>' +
      '<div class="med-dialog-b">' + bodyHtml + '</div><div class="med-dialog-f">' + footHtml + '</div></div>';
    refs.dialog.querySelector('[data-x="cancel"]').addEventListener('click', function () { refs.dialog.classList.remove('show'); });
    var ob = refs.dialog.querySelector('[data-x="open"]');
    if (ob) ob.addEventListener('click', function () { refs.dialog.classList.remove('show'); openKiwix(M.zimViewUrl(bookid), it.name); });
    var dl = refs.dialog.querySelector('a[download]'); if (dl) dl.addEventListener('click', function () { refs.dialog.classList.remove('show'); });
    refs.dialog.classList.add('show');
  }

  /* ============================================================ UNIFIED SEARCH */
  function buildUnified() {
    var u = el('div', 'med-unified'); wrap.appendChild(u);
    u.innerHTML = '<div class="med-results" id="medResults"></div><div class="row"><span class="ic">' + ICON.search + '</span>' +
      '<input placeholder="Unified search — files on SanDisk + article content across all Kiwix libraries…"><span class="hint">FILES + LIBRARIES</span></div>';
    refs.results = u.querySelector('#medResults'); refs.uInput = u.querySelector('input');
    refs.uInput.addEventListener('input', function () { scheduleUnified(this.value); });
    refs.uInput.addEventListener('focus', function () { if (this.value.trim()) scheduleUnified(this.value); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.med-unified')) refs.results.classList.remove('show'); });
  }
  var uTimer = null;
  function scheduleUnified(q) { clearTimeout(uTimer); uTimer = setTimeout(function () { runUnified(q); }, 330); }
  function runUnified(q) {
    q = q.trim();
    if (!q) { refs.results.classList.remove('show'); return; }
    if (ST._uToken) ST._uToken.live = false;
    var token = ST._uToken = { live: true };
    refs.results.innerHTML = '<div class="med-empty" style="padding:18px">Searching files + libraries…</div>'; refs.results.classList.add('show');
    Promise.all([
      M.searchFiles(q, { token: token, maxResults: 30 }),
      M.searchLibraries(q, 24)
    ]).then(function (arr) {
      if (!token.live || !alive()) return;
      var files = arr[0] || [], arts = arr[1] || [];
      if (!files.length && !arts.length) { refs.results.innerHTML = '<div class="med-empty" style="padding:18px">No files or articles match “' + esc(q) + '”</div>'; return; }
      var html = '';
      if (files.length) {
        html += '<div class="med-res-sec"><div class="rh">FILE BROWSER<span class="ct">' + files.length + (files._truncated ? '+' : '') + ' files</span></div>';
        files.forEach(function (f, i) {
          html += '<div class="med-res" data-file="' + i + '"><span class="ft-' + f.file.type + '">' + (ICON[f.file.type] || ICON.doc) + '</span><span class="rt">' + esc(f.file.name) + '</span><span class="rpath">' + esc(f.path) + '</span><span class="rsrc file">FILE</span></div>';
        });
        html += '</div>';
      }
      if (arts.length) {
        html += '<div class="med-res-sec"><div class="rh">OFFLINE LIBRARIES<span class="ct">' + arts.length + ' articles</span></div>';
        arts.forEach(function (a, i) {
          html += '<div class="med-res" data-art="' + i + '"><span style="color:' + (M.CATS[a.cat] || M.CATS.reference).color + '">' + ICON.doc + '</span><span class="rt">' + esc(a.title) + '</span><span class="rpath">' + esc(a.zim) + '</span><span class="rsrc lib">LIBRARY</span></div>';
        });
        html += '</div>';
      }
      refs.results.innerHTML = html;
      [].forEach.call(refs.results.querySelectorAll('[data-file]'), function (row) {
        row.addEventListener('click', function () { var f = files[+row.getAttribute('data-file')]; refs.results.classList.remove('show'); refs.uInput.value = ''; navTo(f.path === '/' ? '' : f.path); setTimeout(function () { openEntry(f.file); }, 40); });
      });
      [].forEach.call(refs.results.querySelectorAll('[data-art]'), function (row) {
        row.addEventListener('click', function () { var a = arts[+row.getAttribute('data-art')]; refs.results.classList.remove('show'); openKiwix(a.href, a.title); });
      });
    });
  }

  /* ============================================================ TOAST */
  function buildToast() { refs.toast = el('div', 'med-toast'); document.body.appendChild(refs.toast); }
  function toast(kind, msg) { var t = refs.toast; t.className = 'med-toast ' + kind + ' show'; t.textContent = (kind === 'ok' ? '✓ ' : '⚠ ') + msg; clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 2600); }

})(window.DBMedia);
