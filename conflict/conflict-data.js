/* DOOM BOX V2 — Conflict tab data module
   Fetches GDELT events from /api/intel/gdelt and manages the pending-selection
   set by a map bubble click before the tab is mounted. */
(function(){
  "use strict";

  var _events  = [];
  var _pending = null; // set by map click; consumed on tab mount

  function load(cb){
    fetch("/api/intel/gdelt")
      .then(function(r){ return r.json(); })
      .then(function(d){
        _events = (d.features || []).map(function(f){ return f.properties || {}; });
        if(cb) cb(_events);
      })
      .catch(function(){
        _events = [];
        if(cb) cb(_events);
      });
  }

  var pub = window.DBConflict || {};
  pub.load       = load;
  pub.events     = function(){ return _events; };
  pub.setPending = function(ev){ _pending = ev; };
  pub.takePending= function(){ var p=_pending; _pending=null; return p; };
  window.DBConflict = pub;
})();
