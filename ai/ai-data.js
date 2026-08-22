/* ============================================================
   DOOM BOX — AI DATA
   Local models, preset prompts, canned response bank.
   window.DBAi.
   ============================================================ */
window.DBAi = window.DBAi || {};
(function (A) {
  "use strict";

  A.MODELS = [
    { id: 'qwen2.5:1.5b', label: 'qwen2.5:1.5b', speed: '~12-18 tok/s', tps: [12, 18], ctx: 4096 },
    { id: 'qwen2.5:3b', label: 'qwen2.5:3b', speed: '~5-8 tok/s', tps: [5, 8], ctx: 4096 }
  ];

  A.PRESETS = [
    { label: 'Summarize recent OSINT', text: 'Summarize the most significant items from the OSINT feed in the last 60 minutes.' },
    { label: 'Draft a SITREP', text: 'Draft a concise SITREP based on current sensor data: GPS, mesh, ADS-B, weather, and any active alerts.' },
    { label: 'Medical: [describe symptom]', text: 'Medical question: ' },
    { label: 'Radio procedure for [situation]', text: 'What is the correct radio procedure for ' },
    { label: 'Translate: [text]', text: 'Translate the following to English: ' }
  ];

  // canned responses keyed by matched intent. plain[] = paragraph lines.
  // a response may include a code block: {code:'...'}.
  var BANK = [
    {
      keys: ['arterial', 'bleeding', 'hemorrhage', 'blood'],
      body: [
        'Arterial bleeding is the most serious type of external hemorrhage. Key signs:',
        '- Bright red blood (oxygen-rich) rather than dark red.',
        '- Spurting or pulsing flow synchronized with the heartbeat.',
        '- Rapid blood loss; pooling forms quickly.',
        '- Difficult to control with light pressure alone.',
        '',
        'Immediate actions: apply firm direct pressure, pack the wound if deep, and place a tourniquet 5-8 cm above the wound (not on a joint) if pressure fails. Note the time of tourniquet application. Treat for shock and evacuate.'
      ]
    },
    {
      keys: ['sitrep', 'situation report', 'draft a sitrep'],
      body: [
        'SITREP — generated from current sensor picture:',
        '',
        'POSITION: GPS lock, MGRS 18T WL 8364 0481. Own node nominal.',
        'COMMS: mesh network healthy, 154 nodes known, 3 heard in last 5 min. Channel utilization moderate.',
        'AIR: ADS-B tracking 47 aircraft, 2 military (AE-block) contacts noted.',
        'WX: clear, 94°F, wind 190° at 12 kt. No active NWS alerts.',
        'THREAT: 3 CFS events in last hour within local grid. No emergent escalation.',
        '',
        'ASSESSMENT: environment permissive. All systems nominal. Recommend routine monitoring.'
      ]
    },
    {
      keys: ['radio procedure', 'prowords', 'voice procedure', 'comms procedure', 'radio'],
      body: [
        'Standard voice procedure follows a call-up then message format:',
        '- Begin with the called station, then "THIS IS", then your callsign.',
        '- Use prowords: OVER (reply expected), OUT (end, no reply), SAY AGAIN, ROGER, WILCO.',
        '- Spell difficult words with the NATO phonetic alphabet (Alfa, Bravo, Charlie...).',
        '- Keep transmissions short; pause between to allow break-ins.',
        '- For emergencies: MAYDAY (distress) x3 or PAN-PAN (urgency) x3 on the guard frequency.'
      ]
    },
    {
      keys: ['translate'],
      body: [
        'Translation (detected source → English):',
        '',
        '"The convoy will depart at first light. Maintain radio silence until checkpoint three."',
        '',
        'Note: local model translation — verify critical content with a second source where possible.'
      ]
    },
    {
      keys: ['osint', 'summarize recent', 'feed', 'intel'],
      body: [
        'OSINT summary — last 60 minutes:',
        '- ALERT: reported shots fired vicinity Dorchester Ave; units responding.',
        '- CRIME: B&E cluster, 4 incidents within an 0.8 km grid square.',
        '- WX: wind advisory in effect until 1800Z, gusts to 45 kt.',
        '- COMMS: mesh relay RELAY-07 reconnected; integrity nominal.',
        '',
        'Pattern: localized property-crime uptick in the southwest grid. No coordinated threat indicator. Continue passive collection.'
      ]
    },
    {
      keys: ['bash', 'script', 'code', 'shell', 'command', 'python'],
      body: [
        'Here is a short shell loop that watches a log file and prints lines matching a keyword:'
      ],
      code: '#!/bin/bash\nKEYWORD="${1:-ERROR}"\nFILE="${2:-/var/log/doombox.log}"\n\ntail -F "$FILE" | while read -r line; do\n  if echo "$line" | grep -q "$KEYWORD"; then\n    printf "[%s] %s\\n" "$(date -u +%H:%M:%SZ)" "$line"\n  fi\ndone',
      after: ['Run it as: ./watch.sh ALERT /var/log/doombox.log — it follows the file and timestamps each match in Zulu.']
    },
    {
      keys: ['water', 'purif', 'filter', 'drink'],
      body: [
        'Field water purification options, in order of reliability:',
        '- Boiling: rolling boil for 1 minute (3 minutes above 2,000 m). Kills pathogens.',
        '- Chemical: chlorine dioxide or iodine tablets; wait 30 min (4 hrs for crypto).',
        '- Filtration: 0.2 micron filter removes bacteria/protozoa but not viruses.',
        '',
        'Best practice: pre-filter turbid water through cloth, then boil or treat. Combine filtration + chemical for viral protection.'
      ]
    }
  ];

  var DEFAULT = {
    body: [
      'Acknowledged. Operating fully offline on the local model — responses draw only on cached weights, no external lookup.',
      '',
      'I can help with field medicine, radio and comms procedure, SITREP drafting, OSINT summarization, navigation, survival, and short scripting tasks. Rephrase with a specific question and I will give a concise, actionable answer.'
    ]
  };

  A.respondTo = function (prompt) {
    var p = (prompt || '').toLowerCase();
    for (var i = 0; i < BANK.length; i++) {
      var r = BANK[i];
      for (var k = 0; k < r.keys.length; k++) { if (p.indexOf(r.keys[k]) >= 0) return r; }
    }
    return DEFAULT;
  };

  // flatten a response into a token stream (words + code as one block token)
  A.tokenize = function (resp) {
    var tokens = [];
    function pushText(lines) {
      lines.forEach(function (ln, li) {
        if (ln === '') { tokens.push('\n'); return; }
        var words = ln.split(' ');
        words.forEach(function (w, wi) { tokens.push((wi ? ' ' : '') + w); });
        if (li < lines.length - 1) tokens.push('\n');
      });
    }
    pushText(resp.body);
    if (resp.code) { tokens.push({ code: resp.code }); }
    if (resp.after) { tokens.push('\n'); pushText(resp.after); }
    return tokens;
  };

  // rough token estimate for context meter
  A.estTokens = function (str) { return Math.max(1, Math.round(str.length / 4)); };

})(window.DBAi);
