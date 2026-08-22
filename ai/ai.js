/* ============================================================
   DOOM BOX — AI UI
   Local-model mIRC chat: model selector, token streaming,
   code blocks, context meter, presets, persistence.
   DBAi.mount().
   ============================================================ */
window.DBAi = window.DBAi || {};
(function (A) {
  "use strict";
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function zulu() { var d = new Date(); return '[' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + 'Z]'; }

  var KEY = 'db_ai_history', MAX_EXCH = 50;
  var ST, wrap, refs;
  A._timers = A._timers || [];

  A.mount = function (container) {
    A._timers.forEach(clearTimeout); A._timers = [];
    ['.ai-toast'].forEach(function (s) { [].forEach.call(document.querySelectorAll(s), function (e) { e.remove(); }); });
    ST = { model: A.MODELS[1], status: 'loaded', streaming: false, sessionTokens: 0, scrolledUp: false, presetsOpen: true, history: load(), lastResponse: '', stopFlag: false };
    container.style.padding = '0'; container.style.position = 'relative'; container.style.overflow = 'hidden';
    container.innerHTML = ''; wrap = el('div', 'ai'); container.appendChild(wrap); refs = {};
    buildTop(); buildChat(); buildPresets(); buildInput(); buildToast();
    renderHistory(); updateContextMeter(); updateTokens();
    // simulate brief model load then ready
    setStatus('loading'); A._timers.push(setTimeout(function () { if (wrap.isConnected) setStatus('loaded'); }, 700));
  };

  /* ============================================================ TOP BAR */
  function buildTop() {
    var t = el('div', 'ai-top'); wrap.appendChild(t);
    t.innerHTML =
      '<div class="ai-top-l">' +
      '<div class="ai-modelsel"><div class="cur"><span class="nm"></span><span class="sp"></span><span class="ar">▾</span></div><div class="ai-modeldrop"></div></div>' +
      '<div class="ai-status"><span class="d"></span><span class="lbl">LOADED</span></div>' +
      '<div class="ai-speed idle">0.0 tok/s</div></div>' +
      '<div class="ai-top-r">' +
      '<button class="ai-btn amber" data-a="clear">CLEAR CHAT</button>' +
      '<button class="ai-btn" data-a="copy">COPY LAST RESPONSE</button>' +
      '<span class="ai-tok"><b>0</b> tokens this session</span>' +
      '<span class="ai-ollama"><span class="d"></span>localhost:11434 CONNECTED</span></div>';
    refs.modelCur = t.querySelector('.cur'); refs.modelNm = t.querySelector('.cur .nm'); refs.modelSp = t.querySelector('.cur .sp');
    refs.modelDrop = t.querySelector('.ai-modeldrop');
    refs.status = t.querySelector('.ai-status'); refs.statusLbl = t.querySelector('.ai-status .lbl');
    refs.speed = t.querySelector('.ai-speed'); refs.tok = t.querySelector('.ai-tok');
    // model dropdown
    refs.modelDrop.innerHTML = A.MODELS.map(function (m) { return '<div class="opt" data-id="' + m.id + '"><div class="nm">' + m.label + '</div><div class="ds">' + m.speed + ' · ctx ' + m.ctx + '</div></div>'; }).join('');
    refs.modelCur.addEventListener('click', function (e) { e.stopPropagation(); refs.modelDrop.classList.toggle('show'); syncModelDrop(); });
    document.addEventListener('click', closeDrop);
    [].forEach.call(refs.modelDrop.querySelectorAll('.opt'), function (o) {
      o.addEventListener('click', function () { ST.model = A.MODELS.filter(function (m) { return m.id === o.getAttribute('data-id'); })[0]; refs.modelDrop.classList.remove('show'); renderModel(); updateContextMeter(); setStatus('loading'); A._timers.push(setTimeout(function () { if (wrap.isConnected) setStatus('loaded'); }, 600)); });
    });
    t.querySelector('[data-a="clear"]').addEventListener('click', clearChat);
    t.querySelector('[data-a="copy"]').addEventListener('click', copyLast);
    renderModel();
  }
  function closeDrop(e) { if (refs && refs.modelDrop && !e.target.closest('.ai-modelsel')) refs.modelDrop.classList.remove('show'); }
  function syncModelDrop() { [].forEach.call(refs.modelDrop.querySelectorAll('.opt'), function (o) { o.classList.toggle('on', o.getAttribute('data-id') === ST.model.id); }); }
  function renderModel() { refs.modelNm.textContent = ST.model.label; refs.modelSp.textContent = ST.model.speed; syncModelDrop(); }
  function setStatus(s) { ST.status = s; refs.status.className = 'ai-status' + (s === 'loading' ? ' loading' : s === 'unavail' ? ' unavail' : ''); refs.statusLbl.textContent = s === 'loading' ? 'LOADING' : s === 'unavail' ? 'UNAVAILABLE' : 'LOADED'; }
  function updateTokens() { refs.tok.innerHTML = '<b>' + ST.sessionTokens.toLocaleString() + '</b> tokens this session'; }

  /* ============================================================ CHAT */
  function buildChat() {
    var cw = el('div', 'ai-chatwrap'); wrap.appendChild(cw);
    refs.chat = el('div', 'ai-chat'); cw.appendChild(refs.chat);
    refs.chat.addEventListener('scroll', function () { ST.scrolledUp = refs.chat.scrollHeight - refs.chat.scrollTop - refs.chat.clientHeight > 50; refs.jump.classList.toggle('show', ST.scrolledUp && ST.streaming); });
    refs.jump = el('div', 'ai-jump', '↓ new content'); refs.jump.addEventListener('click', function () { ST.scrolledUp = false; scrollBottom(); }); cw.appendChild(refs.jump);
  }
  function lineEl(cls, html) { var l = el('div', 'ai-l ' + cls); l.innerHTML = html; return l; }
  function addUser(text) { refs.chat.appendChild(lineEl('user', '<span class="z">' + zulu() + '</span> <span class="nick">&lt;operator&gt;</span> ' + esc(text))); }
  function addSys(text) { refs.chat.appendChild(lineEl('sys', '<span class="z">' + zulu() + '</span> --- ' + esc(text) + ' ---')); }
  function addErr(text) { refs.chat.appendChild(lineEl('err', '<span class="z">' + zulu() + '</span> --- ' + esc(text) + ' ---')); }

  function renderHistory() {
    refs.chat.innerHTML = '';
    if (!ST.history.length) { addSys('local AI ready · qwen2.5 loaded · no data leaves this device'); scrollBottom(); return; }
    ST.history.forEach(function (ex) {
      addUser(ex.q);
      var head = lineEl('ai', '<span class="z">' + ex.z + '</span> <span class="nick">&lt;' + esc(ex.model) + '&gt;</span> ');
      refs.chat.appendChild(head);
      renderStatic(head, ex.resp);
      addSys('response complete (' + ex.tokens + ' tokens, ' + ex.secs + 's)');
    });
    scrollBottom();
  }
  // render a stored response (with code blocks) without streaming
  function renderStatic(headLine, resp) {
    var first = true;
    function emitText(lines) {
      lines.forEach(function (ln) {
        if (first) { headLine.insertAdjacentText('beforeend', ln); first = false; }
        else refs.chat.appendChild(lineEl('cont', esc(ln) || '&nbsp;'));
      });
    }
    emitText(resp.body);
    if (resp.code) addCodeBlock(resp.code);
    if (resp.after) emitText(resp.after);
  }

  function addCodeBlock(code) {
    var box = el('div', 'ai-code'); box.innerHTML = '<button class="copy">COPY</button><pre>' + esc(code) + '</pre>';
    box.querySelector('.copy').addEventListener('click', function () { if (navigator.clipboard) navigator.clipboard.writeText(code).catch(function () {}); toast('copied code block'); });
    refs.chat.appendChild(box); return box;
  }
  function scrollBottom() { if (!ST.scrolledUp) { refs.chat.scrollTop = refs.chat.scrollHeight; refs.jump.classList.remove('show'); } }

  /* ============================================================ PRESETS */
  function buildPresets() {
    var p = el('div', 'ai-presets'); wrap.appendChild(p); refs.presets = p;
    p.innerHTML = '<div class="ai-presets-h"><span class="ar">▾</span>PRESET PROMPTS</div><div class="ai-chips"></div>';
    var chips = p.querySelector('.ai-chips');
    A.PRESETS.forEach(function (pr) { var b = el('button', 'ai-chip', pr.label); b.addEventListener('click', function () { refs.ta.value = pr.text; refs.ta.focus(); autoGrow(); updateContextMeter(); }); chips.appendChild(b); });
    p.querySelector('.ai-presets-h').addEventListener('click', function () { ST.presetsOpen = !ST.presetsOpen; p.classList.toggle('collapsed', !ST.presetsOpen); });
  }

  /* ============================================================ INPUT */
  function buildInput() {
    var iw = el('div', 'ai-input-wrap'); wrap.appendChild(iw);
    iw.innerHTML = '<div class="ai-input-row"><textarea class="ai-textarea" rows="3" placeholder="Query the local AI..."></textarea><button class="ai-send">SEND</button></div>' +
      '<div class="ai-ctx"><div class="meter"><div class="lbl"><span>CONTEXT</span><span><b class="cv">0</b> / <span class="cmax">' + ST.model.ctx + '</span> tokens</span></div><div class="track"><i></i></div></div>' +
      '<span class="note">Model will forget earlier context when full</span><span class="hint">Enter sends · Shift+Enter newline</span></div>';
    refs.ta = iw.querySelector('.ai-textarea'); refs.send = iw.querySelector('.ai-send');
    refs.meterFill = iw.querySelector('.track i'); refs.meterVal = iw.querySelector('.cv'); refs.meterMax = iw.querySelector('.cmax');
    refs.ta.addEventListener('input', function () { autoGrow(); updateContextMeter(); });
    refs.ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } });
    refs.send.addEventListener('click', function () { if (ST.streaming) stopStream(); else onSend(); });
  }
  function autoGrow() { var ta = refs.ta; ta.style.height = 'auto'; ta.style.height = Math.min(170, Math.max(62, ta.scrollHeight)) + 'px'; }

  function historyTokens() {
    var t = 0; ST.history.forEach(function (ex) { t += A.estTokens(ex.q) + ex.tokens; });
    return t;
  }
  function updateContextMeter() {
    var used = historyTokens() + A.estTokens(refs.ta ? refs.ta.value : '');
    var max = ST.model.ctx, pct = Math.min(100, used / max * 100);
    if (refs.meterFill) { refs.meterFill.style.width = pct + '%'; refs.meterFill.classList.toggle('warn', pct > 80); }
    if (refs.meterVal) { refs.meterVal.textContent = used.toLocaleString(); }
    if (refs.meterMax) { refs.meterMax.textContent = max; }
  }

  /* ============================================================ STREAMING ENGINE (simulated SSE) */
  function onSend() {
    var text = refs.ta.value.trim(); if (!text || ST.streaming) return;
    if (ST.status !== 'loaded') { addErr('ERROR: model not loaded, retry?'); scrollBottom(); return; }
    refs.ta.value = ''; autoGrow(); updateContextMeter();
    addUser(text); scrollBottom();
    var resp = A.respondTo(text);
    streamResponse(text, resp);
  }
  function streamResponse(prompt, resp) {
    ST.streaming = true; ST.stopFlag = false; refs.send.textContent = 'STOP'; refs.send.classList.add('stop');
    var tps = ST.model.tps[0] + Math.random() * (ST.model.tps[1] - ST.model.tps[0]);
    var liveTps = tps;
    addSys('generating at ' + tps.toFixed(1) + ' tok/s');
    var head = lineEl('ai', '<span class="z">' + zulu() + '</span> <span class="nick">&lt;' + esc(ST.model.label) + '&gt;</span> ');
    refs.chat.appendChild(head);
    var cursor = el('span', 'ai-cursor'); head.appendChild(cursor);
    var curLine = head; // current text destination
    var tokens = A.tokenize(resp); var ti = 0, tokCount = 0, start = Date.now();
    var plainText = '';

    function step() {
      if (!wrap.isConnected) { ST.streaming = false; return; }
      if (ST.stopFlag) { finish(true); return; }
      if (ti >= tokens.length) { finish(false); return; }
      var tk = tokens[ti++];
      if (typeof tk === 'object' && tk.code) {
        if (cursor.parentNode) cursor.remove();
        addCodeBlock(tk.code); plainText += '\n' + tk.code + '\n';
        // new continuation line for following text, re-attach cursor
        curLine = lineEl('cont', ''); refs.chat.appendChild(curLine); curLine.appendChild(cursor);
        tokCount += A.estTokens(tk.code);
      } else if (tk === '\n') {
        if (cursor.parentNode) cursor.remove();
        curLine = lineEl('cont', ''); refs.chat.appendChild(curLine); curLine.appendChild(cursor);
        plainText += '\n';
      } else {
        cursor.insertAdjacentText('beforebegin', tk);
        plainText += tk; tokCount++;
      }
      // live speed jitter
      liveTps = Math.max(2, tps + (Math.random() - 0.5) * 2);
      refs.speed.classList.remove('idle'); refs.speed.textContent = liveTps.toFixed(1) + ' tok/s';
      ST.sessionTokens++; updateTokens();
      scrollBottom();
      var delay = 1000 / liveTps;
      A._timers.push(setTimeout(step, delay));
    }
    function finish(stopped) {
      if (cursor.parentNode) cursor.remove();
      ST.streaming = false; refs.send.textContent = 'SEND'; refs.send.classList.remove('stop');
      refs.speed.classList.add('idle'); refs.speed.textContent = '0.0 tok/s';
      var secs = ((Date.now() - start) / 1000).toFixed(1);
      if (stopped) addSys('generation stopped by operator (' + tokCount + ' tokens)');
      else addSys('response complete (' + tokCount + ' tokens, ' + secs + 's)');
      ST.lastResponse = plainText.trim();
      if (!stopped) { pushHistory(prompt, resp, tokCount, secs); }
      updateContextMeter(); scrollBottom();
    }
    step();
  }
  function stopStream() { ST.stopFlag = true; }

  /* ============================================================ PERSISTENCE */
  function pushHistory(q, resp, tokens, secs) {
    ST.history.push({ q: q, resp: { body: resp.body, code: resp.code, after: resp.after }, model: ST.model.label, z: zulu(), tokens: tokens, secs: secs });
    if (ST.history.length > MAX_EXCH) ST.history = ST.history.slice(-MAX_EXCH);
    save();
  }
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(ST.history)); } catch (e) {} }
  function clearChat() {
    ST.history = []; ST.sessionTokens = 0; ST.lastResponse = ''; save(); updateTokens();
    refs.chat.innerHTML = ''; addSys('chat cleared · context reset'); updateContextMeter(); scrollBottom();
  }
  function copyLast() {
    if (!ST.lastResponse) { toast('no response to copy'); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(ST.lastResponse).catch(function () {});
    toast('last response copied');
  }

  /* ============================================================ TOAST */
  function buildToast() { refs.toast = el('div', 'ai-toast'); document.body.appendChild(refs.toast); }
  function toast(msg) { var t = refs.toast; t.className = 'ai-toast show'; t.textContent = '✓ ' + msg; clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, 2200); }

})(window.DBAi);
