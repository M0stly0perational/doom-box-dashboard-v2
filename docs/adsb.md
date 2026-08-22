# ADS-B

Live aircraft tracking from a local dump1090 receiver, rendered as a sortable
table with a persistent session log. Purely a frontend consumer — all
decoding happens upstream in dump1090 and a Node-RED pipeline; this tab only
polls two JSON endpoints and renders what it's given.

## What it does

- Polls the aircraft feed every 5 seconds and the GPS fix every 5 seconds
  (same interval, parallel requests), independent of which dashboard tab is
  currently visible in the browser.
- Renders a sortable, filterable, column-configurable table of in-range
  aircraft: callsign, ICAO hex, altitude, speed, heading, distance/bearing
  from the operator's own position, squawk, and last-seen age.
- Classifies each aircraft as `MILITARY` (US military ICAO hex block or an
  explicit API flag), `COMMERCIAL` (has a callsign), or `UNKNOWN` (neither).
- Flags emergency squawks (7500 hijack / 7600 radio failure / 7700 general
  emergency) with a highlighted row and a dedicated detail-panel card.
- Pushes a ticker notification the first time a new military contact
  appears in a session.
- Maintains a **session log** — every aircraft ever seen this browser
  session, with first-seen/last-seen times, max altitude, max speed, and
  dwell time — persisted to `localStorage` so it survives a page reload.
  CSV export and a summary/detail side panel (altitude distribution, a
  polar range-coverage plot, a per-aircraft track history canvas) are built
  entirely from this same in-memory/localStorage data.
- "Show on map" / "center on map" buttons switch to the MAP tab and toggle
  its ADS-B + military-air layers on.

## Data sources / API endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/adsb` | GET | Current aircraft list: `{aircraft:[{icao, callsign, altitude, speed, heading, lat, lon, distance, military, last_seen, squawk}], count, now}`. Backed by a Node-RED pipeline reading dump1090's SBS feed (see the project's `CLAUDE.md` for the fetcher-side details — out of scope for this frontend module). |
| `/api/gps` | GET | Own-position reference: `{fix, lat, lon, ...}`. Used only to compute distance/bearing to each aircraft — this tab does not display GPS status itself (see the SYS tab for that). |

Both requests are fired together on every poll (`Promise.all`); a failure
in either one degrades gracefully — a failed `/api/adsb` call yields an
empty aircraft list, and a failed or no-fix `/api/gps` call falls back to a
hardcoded reference point (see **Config options**) rather than blocking the
table.

**Important:** the API's own `distance` field is ignored. Distance and
bearing are computed client-side via Haversine from each aircraft's
`lat`/`lon` against the resolved reference point, specifically so that the
"distance from me" figure reflects the operator's actual GPS position
instead of a server-side-hardcoded coordinate.

## Data flow: `adsb-data.js` → `adsb.js`

- **`adsb-data.js`** (`window.DBAdsb`) is the data/model layer. On each
  `A.refresh()` call it:
  1. Fetches `/api/adsb` and `/api/gps` in parallel.
  2. Resolves the reference point: the live GPS fix if present, otherwise
     a hardcoded Las Vegas centroid.
  3. Upserts each aircraft from the API response into `A._fleetMap` (keyed
     by ICAO hex), computing distance/bearing, tracking max altitude/speed,
     accumulating a short position history (`a.hist`, capped at 40 points,
     used for the detail panel's track canvas), and stamping fields the
     API doesn't actually provide with inert placeholders (see **Known
     limitations**) so the render layer never has to null-check them.
  4. Ages every tracked aircraft: marks it `stale` past 60 seconds since
     last seen, and drops it from the live table past 120 seconds — but the
     session-log record survives with an `exit` timestamp.
  5. Recomputes distance/bearing for the whole fleet against the (possibly
     just-updated) reference point.
  6. Mirrors everything into `A.session` (the persistent log) and writes it
     to `localStorage['og_adsb_session_v2']`.
- **`adsb.js`** (`window.DBAdsb`, same namespace) is the render/interaction
  layer. `A.mount(container)` builds the two-pane UI (sortable table on the
  left, summary/detail panel on the right), starts the 5-second
  `A.refresh()` poll plus an independent 1-second "age tick" for smooth
  last-seen countdowns between polls, and tears both intervals down when
  the container is unmounted. All table/filter/column state lives in a
  module-local `ST` object that is reinitialized on every `mount()` call
  (see **Config options** — this state does not persist).

## Config options

None of the following are exposed in the UI as settings — they're constants
in the source and would need a code change to alter:

- `A.POLL_MS = 5000` — aircraft/GPS poll interval.
- `STALE_S = 60`, `REMOVE_S = 120` — seconds until an aircraft is marked
  stale / removed from the live table (still logged in the session log).
- `VEGAS = {lat: 36.1699, lon: -115.1398}` — fallback reference point used
  whenever `/api/gps` reports no fix.
- `A.isMilHex()` — matches ICAO hex starting with `AE` (the US military
  allocation block), OR'd with the API's own `military` flag.
- Session log cap: 300 records, persisted under the localStorage key
  `og_adsb_session_v2`.

State that resets every time the tab is mounted (not persisted anywhere):
column visibility (`ST.cols`), active filter chip, search text, and sort
column/direction. Only the session log itself survives a reload.

## Known limitations

- **Detail-panel SIGNAL card throws on open.** `renderDetail()` builds a
  card with `a.rssi.toFixed(1)`, but `a.rssi` is unconditionally set to
  `null` in `adsb-data.js` (the API provides no real signal-strength
  value). Opening an aircraft's detail panel (row click, or the ℹ button)
  currently throws a `TypeError` inside that card's construction. This is
  a pre-existing bug in the current code, not a documentation caveat —
  flagging here rather than silently working around it in the docs.
- **`GENERAL` and `HELICOPTER` filter chips never match anything.** The
  data layer only ever assigns `a.cat` one of `MILITARY`, `COMMERCIAL`, or
  `UNKNOWN` — there is no heuristic or data source that produces `GENERAL`
  or `HELICOPTER`, even though both filter chips and their table color
  scale exist in the UI.
- **No real signal, aircraft-type, or route data.** Fields like type,
  operator, registration, year, emitter category, country flag, RSSI, and
  origin/destination are cosmetic placeholders (`'—'` or a generic string
  derived from military/callsign status) because the upstream dump1090 →
  Node-RED pipeline this tab consumes doesn't provide them. They render
  without error but never carry real information.
- **Climb rate is always flat.** `vrate` is hardcoded to `0` (never derived
  from consecutive altitude samples), so the detail panel always shows
  "Level (±0)" regardless of actual aircraft behavior.
- **The alert modal is a non-functional stub.** The per-aircraft "SET
  ALERT" dialog (radius/altitude/squawk/appear/disappear triggers, via
  ticker/notification/mesh) only sets an empty `alertCfg = {}` object on
  save and shows a confirmation toast — nothing in the codebase reads
  `alertCfg` back to actually evaluate or fire an alert.
- **RSSI proxy from the old (V1) dashboard is gone.** An earlier iteration
  of this tab derived a rough signal-strength indicator from how many
  times dump1090 had seen an aircraft in the last 60 seconds; the current
  V2 data layer does not reproduce that, leaving the RSSI column reliant
  on the always-null field above.
