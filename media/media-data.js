/* ============================================================
   DOOM BOX — MEDIA DATA (LIVE)
   Local file browser (~/media-local) + Kiwix ZIM library. Replaces the mock.
   Wires:
     GET /api/media/list?path=<rel>     (Node-RED, same-origin :1880)
     GET /api/media/pmtiles-info?path=  (Node-RED)
     Kiwix on :8888 (CORS *): /catalog/v2/entries, /search?pattern=
   Media files stream from the httpStatic dual-mount at /media/<rel>
   (Range-served — videos seek; never proxied through Node-RED).
   Served from local NVMe (~/media-local -> /media/) since the SanDisk
   drive was fully retired 2026-09-02.
   ============================================================ */
window.DBMedia = window.DBMedia || {};
(function (M) {
  "use strict";

  M.CATS = {
    reference: { label: 'REFERENCE', color: 'var(--blue)' },
    military:  { label: 'MILITARY',  color: '#8A8B3A' },
    medical:   { label: 'MEDICAL',   color: 'var(--red)' },
    technical: { label: 'TECHNICAL', color: 'var(--orange)' },
    geographic:{ label: 'GEOGRAPHIC',color: 'var(--green)' }
  };

  M.kiwixBase = function () { return 'http://' + location.hostname + ':8888'; };
  M.zimViewUrl = function (bookid) { return M.kiwixBase() + '/viewer#' + bookid; };

  /* ---- hidden / noise files filtered client-side (listing returns raw) ---- */
  var HIDDEN = [/^System Volume Information$/i, /^\$RECYCLE\.BIN$/i, /^\.fseventsd$/i, /^\.Trashes$/i, /^\._/, /\.aria2$/i];
  M.isHidden = function (name) { return HIDDEN.some(function (re) { return re.test(name); }); };

  /* ---- server kind -> render type (icon + ft-* color class) ---- */
  // server kinds: folder|video|audio|image|pdf|text|zim|pmtiles|archive|file
  M.typeOf = function (kind) {
    if (kind === 'folder' || kind === 'video' || kind === 'audio' || kind === 'image' || kind === 'zim') return kind;
    return 'doc'; // pdf/text/pmtiles/archive/file -> doc icon/color
  };

  M.fmtSize = function (b) {
    if (b == null) return '—';
    if (b >= 1024 * 1024 * 1024) return (b / 1073741824).toFixed(1) + ' GB';
    if (b >= 1024 * 1024) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
  };
  function dateOf(mtimeMs) { if (!mtimeMs) return ''; try { return new Date(mtimeMs).toISOString().slice(0, 10); } catch (e) { return ''; } }

  /* ============================================================ FETCH */
  M.api = {
    getJSON: function (url) { return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(url + ' -> ' + r.status); return r.json(); }); },
    getText: function (url, opts) { return fetch(url, opts || { cache: 'no-store' }).then(function (r) { if (!r.ok && r.status !== 206) throw new Error(url + ' -> ' + r.status); return r.text(); }); }
  };

  /* ============================================================ FILE LISTING
     normalised entry: {name, kind, type, size, dateMs, date, ext, path, url, hidden} */
  M._dirCache = M._dirCache || {};
  function normEntry(e) {
    return {
      name: e.name, kind: e.kind, type: M.typeOf(e.kind),
      size: e.size, dateMs: e.mtime, date: dateOf(e.mtime), ext: e.ext,
      path: e.path, url: e.url, hidden: M.isHidden(e.name)
    };
  }
  // cwd: '' (root) or '/zim' etc.
  M.listDir = function (cwd, useCache) {
    cwd = cwd || '';
    if (useCache && M._dirCache[cwd]) return Promise.resolve(M._dirCache[cwd]);
    var url = '/api/media/list' + (cwd ? '?path=' + encodeURIComponent(cwd) : '');
    return M.api.getJSON(url).then(function (j) {
      if (!j || j.ok === false) throw new Error((j && (j.err || j.error)) || 'list failed');
      var res = { cwd: cwd, root: j.root, entries: (j.entries || []).map(normEntry) };
      M._dirCache[cwd] = res;
      return res;
    });
  };

  /* ============================================================ KIWIX LIBRARY */
  M.zims = [];
  function catOf(id, tags) {
    var s = (id + ' ' + (tags || '')).toLowerCase();
    if (/armypub|army|milit|usmc|navy|nato|stanag|doctrine|tactical|field.?manual/.test(s)) return 'military';
    if (/mdwiki|wikimed|medic|health|\bwho\b|msf|clinic|nursing|surgery|first.?aid/.test(s)) return 'medical';
    if (/wikivoyage|voyage|factbook|geograph|travel|atlas|gazetteer/.test(s)) return 'geographic';
    if (/stackoverflow|stack.?exchange|devdocs|linux|electronic|programming|gentoo|archlinux|ubuntu|technical|software/.test(s)) return 'technical';
    return 'reference';
  }
  M.catOf = catOf;

  // load the Kiwix OPDS catalog + merge on-disk sizes from the /zim folder.
  M.loadCatalog = function () {
    var pCat = M.api.getText(M.kiwixBase() + '/catalog/v2/entries').then(function (xml) {
      var doc = new DOMParser().parseFromString(xml, 'application/xml');
      var entries = [].slice.call(doc.getElementsByTagName('entry'));
      return entries.map(function (e) {
        function get(t) { var n = e.getElementsByTagName(t)[0]; return n ? n.textContent.trim() : ''; }
        var links = [].slice.call(e.getElementsByTagName('link'));
        var contentLink = links.filter(function (l) { return l.getAttribute('type') === 'text/html'; })[0];
        var href = contentLink ? contentLink.getAttribute('href') : '';
        var bookid = href.replace('/content/', '');
        var thumbLink = links.filter(function (l) { return (l.getAttribute('rel') || '').indexOf('thumbnail') >= 0; })[0];
        var tags = get('tags');
        return {
          id: bookid, title: get('title') || bookid, summary: get('summary'),
          lang: (get('language') || 'eng').slice(0, 2).toUpperCase(),
          articles: parseInt(get('articleCount') || '0', 10) || 0,
          media: parseInt(get('mediaCount') || '0', 10) || 0,
          updated: (get('updated') || '').slice(0, 10),
          tags: tags, cat: catOf(bookid, tags),
          thumb: thumbLink ? (M.kiwixBase() + thumbLink.getAttribute('href')) : '',
          sizeBytes: 0
        };
      }).filter(function (z) { return z.id; });
    });
    var pZim = M.listDir('/zim', true).then(function (d) { return d.entries; }).catch(function () { return []; });
    return Promise.all([pCat, pZim]).then(function (arr) {
      var zims = arr[0], zimDir = arr[1];
      var sizeById = {}, totalBytes = 0, fileCount = 0;
      zimDir.forEach(function (e) {
        if (e.kind === 'zim') { var bid = e.name.replace(/\.zim$/i, ''); sizeById[bid] = e.size; totalBytes += (e.size || 0); fileCount++; }
      });
      zims.forEach(function (z) { z.sizeBytes = sizeById[z.id] || 0; });
      M.zims = zims;
      M.zimOnDisk = { files: fileCount, bytes: totalBytes };
      M.loadedIds = {}; zims.forEach(function (z) { M.loadedIds[z.id] = z; });
      return zims;
    });
  };
  M.zimOnDisk = { files: 0, bytes: 0 };
  M.loadedIds = {};
  M.totalZimBytes = function () { return M.zimOnDisk.bytes || M.zims.reduce(function (a, z) { return a + (z.sizeBytes || 0); }, 0); };
  M.isLoadedZim = function (filename) { return !!M.loadedIds[String(filename).replace(/\.zim$/i, '')]; };
  M.bookIdForFile = function (filename) { return String(filename).replace(/\.zim$/i, ''); };

  /* ---- Kiwix full-text article search (real content, cross-book) ---- */
  M.searchLibraries = function (q, limit) {
    q = (q || '').trim(); if (!q) return Promise.resolve([]);
    var url = M.kiwixBase() + '/search?pattern=' + encodeURIComponent(q) + '&pageLength=' + (limit || 24);
    return M.api.getText(url).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var items = [].slice.call(doc.querySelectorAll('.results li'));
      return items.map(function (li) {
        var a = li.querySelector('a'); if (!a) return null;
        var href = a.getAttribute('href') || '';
        var bookid = (href.match(/\/content\/([^\/]+)/) || [])[1] || '';
        var book = M.loadedIds[bookid];
        var bt = li.querySelector('.book-title');
        var cite = li.querySelector('cite');
        return {
          title: a.textContent.trim(),
          href: M.kiwixBase() + href,
          bookid: bookid,
          zim: book ? book.title : (bt ? bt.textContent.replace(/^from\s+/i, '').trim() : bookid),
          cat: book ? book.cat : catOf(bookid, ''),
          snippet: cite ? cite.textContent.trim().slice(0, 160) : ''
        };
      }).filter(Boolean);
    }).catch(function () { return []; });
  };

  /* ---- bounded recursive filename search across local media ----
     Walks via the list API with hard caps so a huge tree can't freeze
     the browser or storm the endpoint. */
  M.searchFiles = function (q, opts) {
    q = (q || '').trim().toLowerCase(); if (!q) return Promise.resolve([]);
    opts = opts || {};
    var maxDirs = opts.maxDirs || 60, maxResults = opts.maxResults || 50, token = opts.token;
    var out = [], dirsVisited = 0, truncated = false;
    function alive() { return !token || token.live; }
    function walk(cwd) {
      if (out.length >= maxResults || dirsVisited >= maxDirs || !alive()) { if (dirsVisited >= maxDirs) truncated = true; return Promise.resolve(); }
      dirsVisited++;
      return M.listDir(cwd, true).then(function (d) {
        var subdirs = [];
        d.entries.forEach(function (e) {
          if (e.hidden) return;
          if (e.kind === 'folder') subdirs.push(e.path);
          else if (e.name.toLowerCase().indexOf(q) >= 0 && out.length < maxResults) out.push({ file: e, path: cwd || '/' });
        });
        var i = 0;
        function next() {
          if (i >= subdirs.length || out.length >= maxResults || dirsVisited >= maxDirs || !alive()) return Promise.resolve();
          return walk(subdirs[i++]).then(next);
        }
        return next();
      }).catch(function () {});
    }
    return walk('').then(function () { out._truncated = truncated; return out; });
  };

  /* ============================================================ FILE PREVIEW HELPERS */
  M.fileText = function (url) {
    // cap text preview at 1 MiB via Range
    return M.api.getText(url, { headers: { 'Range': 'bytes=0-1048575' }, cache: 'no-store' });
  };
  M.pmtilesInfo = function (relpath) {
    return M.api.getJSON('/api/media/pmtiles-info?path=' + encodeURIComponent(relpath));
  };

})(window.DBMedia);
