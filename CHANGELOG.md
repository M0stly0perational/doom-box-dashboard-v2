# Changelog

DOOM BOX is a from-scratch UI rebuild, not an incremental fork — V2 started
as a fully-simulated visual prototype and was wired to the real backend one
tab at a time. This changelog covers the shape of that transition, not every
commit.

## V2 — current

### Added
- **CONFLICT tab** — global armed-conflict event tracker sourced from GDELT
  v2, with an AI-assisted per-event summary and two dedicated map layers
  (individual event pins, and a translucent affected-area overlay). Not
  present in V1 at all.
- **MAP "Global Intel" layers** — USGS earthquakes, GDACS disasters, FAA
  TFRs, satellite passes, and NASA FIRMS active-fire detections, layered
  onto the tactical map alongside the conflict data above.
- A design-token system (`css/tokens.css`) as the intended single source of
  truth for color/spacing/type scale across tabs, replacing a decade of
  organically-diverged per-tab CSS. (Not yet wired into every tab — see
  `docs/` for which ones still run their own values.)

### Changed
- **Self-position source**: V1 read the operator's own position from the
  Heltec V4 mesh radio's onboard GPS. V2 points every GPS-dependent tab at
  an independent USB GPS receiver via `gpsd` instead, decoupling "where am
  I" from "what's my mesh radio's opinion of where I am." <!-- NEEDS YOUR INPUT:
  you called this "GPS resolution" — if you meant something beyond the
  source change above (e.g. an actual hardware fix restoring a live fix),
  tell me what changed and I'll correct this. -->
- Full visual/interaction rebuild — new shell, new per-tab module structure,
  MIL-STD-2525 symbology throughout, JetBrains Mono / MGRS-first tactical UI.

### Removed
- **RADIO tab** — the wideband scanner tab (RTL-SDR tuner UI embedded in the
  dashboard) was removed from V2's navigation. The underlying radio
  capability wasn't deleted from the field station — it now runs as a
  separate, standalone web SDR service outside this dashboard rather than
  as one of its tabs.
- <!-- NEEDS YOUR INPUT: you mentioned "Pelican to headless" — I have no
  record of a Pelican case, or of a display/headless transition framed this
  way, anywhere in this project's history. What actually changed here? I'd
  rather leave this blank than invent a plausible-sounding entry. -->

## V1

Initial tactical dashboard release: 10 tabs (MAP, OSINT, WX, ADS-B, RADIO,
MESH, SIGINT, MEDIA, AI, SYS), MapLibre GL JS + PMTiles offline vector maps,
Meshtastic mesh integration, ADS-B via dump1090, RTL-SDR scanning, passive
802.11 SIGINT, local Ollama-based AI assist, LVMPD crime heatmap, and NWS
weather — all designed to run fully offline.
