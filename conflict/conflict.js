/* DOOM BOX V2 — Global Conflict Tab
   Armed conflict focus: CAMEO codes 17(QC4)/18/19/20 only.
   Mounts a stats header + two-panel layout: event list (left) + detail (right).
   Map bubble clicks set DBConflict.pending then navigate here via DBShell.go. */
(function(){
  "use strict";

  /* ── constants ────────────────────────────────────── */
  var SEV_COLOR  = {high:"#d73027", medium:"#f46d43", low:"#fee090"};
  var CAMEO_DESC = {
    "17":"Armed coercion / blockade",
    "18":"Armed assault or bombing",
    "19":"Armed fighting or battle",
    "20":"Mass violence or atrocity"
  };
  var MON = ["","JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

  /* ── state ────────────────────────────────────────── */
  var _container = null;
  var _events    = [];
  var _selected  = null;
  var _filter    = "ALL";
  var _search    = "";
  var _aiAbort   = null;

  /* ── helpers ──────────────────────────────────────── */
  function esc(s){
    return String(s||"").replace(/[&<>"']/g,function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function fmtDate(d){
    if(!d||d.length<8) return d||"—";
    return d.slice(6,8)+" "+MON[parseInt(d.slice(4,6),10)||0]+" "+d.slice(0,4);
  }

  function filteredEvents(){
    return _events.filter(function(ev){
      if(_filter!=="ALL" && (ev.severity||"").toUpperCase()!==_filter) return false;
      if(_search){
        var s=_search.toLowerCase();
        return [(ev.location||""),(ev.country||""),(ev.event_type||""),(ev.actor1||""),(ev.actor2||"")]
          .some(function(x){ return x.toLowerCase().indexOf(s)!==-1; });
      }
      return true;
    });
  }

  /* ── stats computation ────────────────────────────── */
  function computeStats(evs){
    var counts={high:0,medium:0,low:0};
    var countries={};
    (evs||_events).forEach(function(ev){
      counts[ev.severity]=(counts[ev.severity]||0)+1;
      if(ev.country) countries[ev.country]=true;
    });
    return {high:counts.high, medium:counts.medium, low:counts.low, countries:Object.keys(countries).length};
  }

  function renderStats(){
    if(!_container) return;
    var hi  = _container.querySelector("#cxHiCnt");
    var med = _container.querySelector("#cxMedCnt");
    var lo  = _container.querySelector("#cxLoCnt");
    var ctr = _container.querySelector("#cxCtrCnt");
    var s   = computeStats();
    if(hi)  hi.textContent  = s.high;
    if(med) med.textContent = s.medium;
    if(lo)  lo.textContent  = s.low;
    if(ctr) ctr.textContent = s.countries;
  }

  /* ── list render ─────────────────────────────────── */
  function renderList(){
    var body = _container && _container.querySelector("#cxListBody");
    if(!body) return;
    var evs = filteredEvents();
    renderStats();
    updateMeta(evs.length);
    if(!evs.length){
      body.innerHTML='<div class="cx-empty-list">No events match filter</div>';
      return;
    }
    body.innerHTML = evs.map(function(ev,i){
      var sc = SEV_COLOR[ev.severity]||"#fee090";
      var actors = [ev.actor1,ev.actor2].filter(Boolean).join(" vs ");
      var isActive = _selected && _selected.event_id===ev.event_id;
      return '<div class="cx-row'+(isActive?" active":"")+'" data-idx="'+i+'">' +
        '<span class="cx-sev-dot" style="background:'+sc+'"></span>'+
        '<div class="cx-row-body">'+
          '<div class="cx-row-type">'+esc(ev.event_type||"Unclassified Event")+'</div>'+
          '<div class="cx-row-loc">'+esc(ev.location||ev.country||"Unknown")+'</div>'+
          (actors?'<div class="cx-row-actors">'+esc(actors)+'</div>':"")+
          '<div class="cx-row-date">'+fmtDate(ev.date)+'</div>'+
        '</div>'+
        '<span class="cx-row-sev" style="color:'+sc+'">'+esc((ev.severity||"").toUpperCase())+'</span>'+
      '</div>';
    }).join("");

    body.querySelectorAll(".cx-row").forEach(function(row){
      row.addEventListener("click", function(){
        selectEvent(evs[parseInt(row.getAttribute("data-idx"),10)]);
      });
    });
  }

  function updateMeta(shown){
    var el = _container && _container.querySelector("#cxMeta");
    if(el) el.textContent=(shown!==undefined?shown:filteredEvents().length)+" of "+_events.length+" events · 6h window · 15min refresh";
  }

  /* ── Goldstein bar ───────────────────────────────── */
  function gsBar(val){
    val = parseFloat(val)||0;
    var pct = Math.max(0,Math.min(100,((val+10)/20)*100));
    var col = val<-0.05?"#d73027":val>0.05?"#6ad27a":"#8a9499";
    return '<div class="cx-gs-wrap">'+
      '<span class="cx-gs-lbl">−10</span>'+
      '<div class="cx-gs-track"><div class="cx-gs-fill" style="left:'+pct+'%;background:'+col+'"></div></div>'+
      '<span class="cx-gs-val" style="color:'+col+'">'+val.toFixed(1)+'</span>'+
    '</div>';
  }

  /* ── detail render ──────────────────────────────── */
  function renderDetail(ev){
    var panel = _container && _container.querySelector("#cxDetail");
    if(!panel) return;
    if(!ev){
      panel.innerHTML=
        '<div class="cx-empty">'+
          '<div class="cx-empty-icon">⊕</div>'+
          '<div class="cx-empty-text">SELECT AN EVENT<br>'+
            '<span>Click a row in the list or a conflict dot on the map</span>'+
          '</div>'+
        '</div>';
      return;
    }

    var sc      = SEV_COLOR[ev.severity]||"#fee090";
    var actors  = [ev.actor1,ev.actor2].filter(Boolean).join(" vs ");
    var rootDesc= CAMEO_DESC[ev.event_root_code]||ev.event_type||"Unclassified Event";

    panel.innerHTML =
      '<div class="cx-ev">'+
        '<div class="cx-ev-head">'+
          '<span class="cx-sev-badge" style="background:'+sc+';color:'+(ev.severity==="low"?"#111":"#fff")+'">'+
            esc((ev.severity||"").toUpperCase())+
          '</span>'+
          '<div class="cx-ev-title">'+esc(ev.event_type||"Unclassified Event")+'</div>'+
          '<div class="cx-ev-sub">'+
            'CAMEO '+esc(ev.event_code||ev.event_root_code||"—")+
            ' &nbsp;·&nbsp; '+esc(rootDesc)+
          '</div>'+
        '</div>'+

        '<div class="cx-caveat">Automated GDELT classification — not a verified conflict assessment. May include non-military domestic incidents.</div>'+

        '<div class="cx-meta-grid">'+
          '<div class="cx-mk">LOCATION</div>'+
          '<div class="cx-mv">'+esc(ev.location||"—")+
            (ev.country&&ev.country!==ev.location?' <span class="cx-cc">'+esc(ev.country)+'</span>':'')+
          '</div>'+
          (actors?'<div class="cx-mk">ACTORS</div><div class="cx-mv cx-actors">'+esc(actors)+'</div>':'')+
          '<div class="cx-mk">DATE</div><div class="cx-mv">'+fmtDate(ev.date)+'</div>'+
          '<div class="cx-mk">SOURCES</div><div class="cx-mv">'+esc(ev.num_mentions||1)+' news references</div>'+
          '<div class="cx-mk">CATEGORY</div><div class="cx-mv">'+esc(rootDesc)+'</div>'+
          '<div class="cx-mk">TONE</div><div class="cx-mv">'+parseFloat(ev.avg_tone||0).toFixed(2)+'</div>'+
        '</div>'+

        '<div class="cx-section-head">GOLDSTEIN SCALE — CAMEO CODE BASELINE</div>'+
        gsBar(ev.goldstein)+
        '<div class="cx-hint">Fixed per CAMEO sub-code, not computed per event — expect it to repeat across events with the same code.</div>'+

        '<div class="cx-section-head">ARTICLE TONE — VARIES PER EVENT</div>'+
        gsBar(ev.avg_tone)+

        '<div class="cx-section-head">AI ASSESSMENT</div>'+
        '<div class="cx-ai" id="cxAiBox"><span class="cx-ai-spin">Analyzing…</span></div>'+

        (ev.url?
          '<div class="cx-source"><a href="'+esc(ev.url)+'" target="_blank" class="cx-src-link">SOURCE ARTICLE ↗</a></div>':"")+
      '</div>';

    doAiTriage(ev, panel.querySelector("#cxAiBox"));
  }

  /* ── AI triage ───────────────────────────────────── */
  function doAiTriage(ev, aiEl){
    if(!aiEl) return;
    if(_aiAbort){ _aiAbort(); _aiAbort=null; }
    var aborted=false;
    _aiAbort=function(){ aborted=true; };

    var actors  = [ev.actor1,ev.actor2].filter(Boolean).join(" vs ");
    var rootDesc= CAMEO_DESC[ev.event_root_code]||ev.event_type||"Unclassified Event";
    var text = "Automated GDELT news-classification event, NOT a verified conflict report — "
      +"the actors below may be non-military (e.g. police, courts, schools). "
      +rootDesc+" in "+(ev.location||ev.country||"unknown")+"."
      +(actors?" Actors: "+actors+".":"")
      +" CAMEO code "+(ev.event_code||ev.event_root_code||"?")+"."
      +" Goldstein scale "+(ev.goldstein||0)+" (negative=destabilizing)."
      +" "+(ev.num_mentions||1)+" news sources."
      +" Country: "+(ev.country||"unknown")
      +". Date: "+fmtDate(ev.date)+"."
      +" Summarize neutrally without asserting this is confirmed armed conflict.";

    fetch("/api/ai/triage",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({text:text,model:"qwen2.5:1.5b"})
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(aborted) return;
      aiEl.innerHTML = d.ok&&d.summary
        ? '<p class="cx-ai-text">'+esc(d.summary)+'</p>'
        : '<p class="cx-ai-err">AI offline — '+(d.error||"no response")+'</p>';
    })
    .catch(function(){
      if(aborted) return;
      aiEl.innerHTML='<p class="cx-ai-err">AI offline</p>';
    });
  }

  /* ── select ─────────────────────────────────────── */
  function selectEvent(ev){
    _selected=ev;
    renderList();
    renderDetail(ev);
    var row = _container&&_container.querySelector(".cx-row.active");
    if(row) row.scrollIntoView({block:"nearest"});
  }

  /* ── mount ───────────────────────────────────────── */
  function mount(container){
    _container=container;
    container.style.padding="0";
    container.style.overflow="hidden";

    container.innerHTML=
      /* stats header */
      '<div class="cx-header">'+
        '<div class="cx-stat-chip cx-stat-high">'+
          '<span class="cx-stat-label">HIGH</span>'+
          '<span class="cx-stat-count" id="cxHiCnt">—</span>'+
        '</div>'+
        '<div class="cx-stat-chip cx-stat-med">'+
          '<span class="cx-stat-label">MED</span>'+
          '<span class="cx-stat-count" id="cxMedCnt">—</span>'+
        '</div>'+
        '<div class="cx-stat-chip cx-stat-low">'+
          '<span class="cx-stat-label">LOW</span>'+
          '<span class="cx-stat-count" id="cxLoCnt">—</span>'+
        '</div>'+
        '<div class="cx-stat-div"></div>'+
        '<div class="cx-stat-chip cx-stat-ctr">'+
          '<span class="cx-stat-label">COUNTRIES</span>'+
          '<span class="cx-stat-count" id="cxCtrCnt">—</span>'+
        '</div>'+
        '<div class="cx-header-title">GDELT CONFLICT SIGNALS</div>'+
        '<div class="cx-header-sub">Automated GDELT v2 classification · unverified · may include non-military incidents</div>'+
      '</div>'+
      /* two-panel body */
      '<div class="cx-wrap">'+
        '<div class="cx-list">'+
          '<div class="cx-list-head">'+
            '<div class="cx-filters">'+
              '<button class="cx-flt active" data-f="ALL">ALL</button>'+
              '<button class="cx-flt" data-f="HIGH">HIGH</button>'+
              '<button class="cx-flt" data-f="MEDIUM">MED</button>'+
              '<button class="cx-flt" data-f="LOW">LOW</button>'+
            '</div>'+
            '<input class="cx-search" placeholder="Location, actor, event type…" />'+
            '<div class="cx-list-meta" id="cxMeta">Loading…</div>'+
          '</div>'+
          '<div class="cx-list-body" id="cxListBody"></div>'+
        '</div>'+
        '<div class="cx-detail" id="cxDetail">'+
          '<div class="cx-empty">'+
            '<div class="cx-empty-icon">⊕</div>'+
            '<div class="cx-empty-text">SELECT AN EVENT<br>'+
              '<span>Click a row in the list or a conflict dot on the map</span>'+
            '</div>'+
          '</div>'+
        '</div>'+
      '</div>';

    /* filter buttons */
    container.querySelectorAll(".cx-flt").forEach(function(btn){
      btn.addEventListener("click",function(){
        _filter=btn.getAttribute("data-f");
        container.querySelectorAll(".cx-flt").forEach(function(b){ b.classList.toggle("active",b===btn); });
        renderList();
      });
    });

    /* search */
    container.querySelector(".cx-search").addEventListener("input",function(e){
      _search=e.target.value.trim();
      renderList();
    });
    container.querySelector(".cx-search").value = _search;

    /* load events */
    var data = window.DBConflict;
    if(data&&data.load){
      data.load(function(evs){
        _events=evs;
        renderStats();
        renderList();
        var pending = data.takePending&&data.takePending();
        if(pending){
          var match = _events.filter(function(e){ return e.event_id===pending.event_id; })[0]||pending;
          selectEvent(match);
        } else if(_selected){
          var resel = _events.filter(function(e){ return e.event_id===_selected.event_id; })[0];
          if(resel) selectEvent(resel); else renderDetail(null);
        }
      });
    }
  }

  /* ── listen for map-originated selections ─────────── */
  window.addEventListener("db:conflict-select",function(e){
    if(!_container) return;
    var ev=e.detail||{};
    var match=_events.filter(function(x){ return x.event_id===ev.event_id; })[0]||ev;
    selectEvent(match);
  });

  /* ── extend DBConflict ────────────────────────────── */
  var pub = window.DBConflict||{};
  pub.mount        = mount;
  pub.selectEvent  = selectEvent;
  pub.getSelected  = function(){ return _selected; };
  pub.applyFilter  = function(search){
    _search = search||"";
    if(_container){
      _container.querySelector(".cx-search").value = _search;
      renderList();
    }
  };
  window.DBConflict = pub;
})();
