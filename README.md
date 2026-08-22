# DOOM BOX Dashboard V2

A self-contained field intelligence dashboard for a Raspberry Pi 5. It pulls aircraft, mesh radio, Wi-Fi, weather, and open-source intelligence feeds into one operator interface, serves it over the box's own Wi-Fi access point, and keeps working when there's no internet.

Built and documented by [Mostly Operational](https://youtube.com/@MostlyOperational). This repository is the code companion to the DOOM BOX V2 video series.

> **Status:** running system, actively developed. This is a personal build shared as a reference, not a supported product. Expect to adapt it to your hardware.

---

## What it does

| Tab | What it shows |
|-----|---------------|
| **HOME** | At-a-glance status: feed health, position, battery, link state |
| **MAP** | MapLibre GL map with offline PMTiles basemaps, MIL-STD-2525D symbology, and layered overlays |
| **ADS-B** | Live aircraft tracks from a dedicated RTL-SDR + dump1090 |
| **MESH** | Meshtastic roster, telemetry, and chat over LoRa |
| **SIGINT** | Wi-Fi beacon and probe-request capture in monitor mode |
| **CONFLICT** | GDELT global conflict event tracking, cross-linked to the map |
| **OSINT** | Aggregated open-source feeds |
| **WX** | Current conditions, forecasts, and NWS alerts |
| **MEDIA** | Local file browser and Kiwix offline reference library |
| **AI** | Local language model interface for summarization and triage |
| **SYS** | Host telemetry, battery, network interfaces, service health |

Every tab degrades rather than breaks when its data source is unreachable.

---

## Hardware

The reference platform:

| Component | Part |
|-----------|------|
| Compute | Raspberry Pi 5, 8GB |
| OS | Raspberry Pi OS Bookworm |
| Mesh radio | Heltec running Meshtastic |
| SDR (ADS-B) | RTL-SDR, serial \`adsb\` |
| SDR (scanner) | RTL-SDR, serial \`scanner\` |
| Wi-Fi | ALFA AWUS036ACM — hosts the AP, monitor-mode capable |
| GPS | USB GPS puck via \`gpsd\` |

Nothing here is strictly required. The dashboard reads from HTTP endpoints, so any backend that serves the same shapes will work.

> **RF note:** mounting a GPS puck close to an active Wi-Fi AP and two SDRs will desense it badly enough to prevent a fix. Give it physical separation. This cost the original build weeks of debugging.

---

## Architecture

Node-RED owns all data acquisition, normalization, and caching. This repository is purely the front end: a modular SPA shell (\`index.html\`) plus one directory per tab.

Each tab follows the same split:

- \`<tab>-data.js\` — fetching, polling, normalizing. No DOM.
- \`<tab>.js\` — rendering and interaction. No fetching.
- \`<tab>.css\` — styles scoped to that tab.

Shared design tokens live in \`css/tokens.css\`. Vendored libraries are in \`vendor/\`.

---

## Install

Serve the directory from Node-RED's \`httpStatic\`, or any static web server. Copy \`.env.example\` to \`.env\` and fill in your own feed credentials. Then open \`/dashboard-v2/\` on any device connected to the box.

The fallback map center (used before GPS acquires a fix) is set in \`adsb/adsb-data.js\` and \`map/map-core.js\` — change it to your own area.

---

## Video series

Each video covers one tab in technical depth. Per-tab written documentation lives in [\`docs/\`](docs/).

> Videos reference tagged releases. If you're following along, check out the tag the video names rather than \`main\` — \`main\` moves.

---

## What changed from V1

- **Pelican case → headless container.** No screen; accessed from a phone, tablet, or laptop over the box's AP or Tailscale.
- **Wide-band radio removed.**
- **CONFLICT tracker added.** GDELT event ingestion with map cross-linking.
- **GPS resolved.** Root-caused to self-inflicted RF desense; fixed with physical separation.
- **Modular rewrite.** Every tab split into data/render/style.

---

## Third-party

Vendored in \`vendor/\`, with licenses intact: MapLibre GL JS (BSD-3), milsymbol (MIT), PMTiles (BSD-3), protomaps-themes-base (BSD-3), mgrs (MIT).

Data sources include GDELT, NASA FIRMS, USGS, NOAA/NWS, FAA, and ACLED. Each has its own terms — review them before redistributing derived data.

---

## License

MIT. See [LICENSE](LICENSE).
