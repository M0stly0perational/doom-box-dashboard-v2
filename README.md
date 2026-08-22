# DOOM BOX Dashboard V2

Next-generation operator dashboard for the DOOM BOX Raspberry Pi 5 portable TAK field
station. Modular SPA shell (`index.html`) + per-tab modules (`map ai adsb media mesh osint
radio sigint sys wx`), served by Node-RED `httpStatic` at `/dashboard-v2/` alongside the
live V1 dashboard at `/dashboard/`.

V2 began as a fully-simulated visual prototype and is being wired to the real Node-RED
`/api/*` endpoints **one tab at a time**, leaving V1 untouched in production.

## Integration status (per tab)

| Tab   | Status | Notes |
|-------|--------|-------|
| HOME  | ✅ live | feeds + status + chips from `/api/system`, `/api/battery`, `/api/mesh/*`, `/api/wx/*` |
| SYS   | ✅ live | `/api/system` + `/api/battery` + `/api/mesh/position` |
| MESH  | ✅ live | `/api/mesh/{state,nodes,messages,events,position}` + `POST /api/mesh/send` (polling) |
| MAP   | ⏳ mock | needs MapLibre + PMTiles + milsymbol + mgrs re-port |
| OSINT | ⏳ mock | |
| WX    | ⏳ mock | |
| ADS-B | ⏳ mock | |
| RADIO | ⏳ mock | |
| SIGINT| ⏳ mock | |
| MEDIA | ⏳ mock | |
| AI    | ⏳ mock | |

## MESH tab (this commit)

Wired to the live meshtastic-bridge data plane via Node-RED:

- `GET /api/mesh/state` — connection status, self identity, channels, node count
- `GET /api/mesh/nodes` — full roster with telemetry (SNR/RSSI/battery/hops/MQTT/GPS)
- `GET /api/mesh/messages?since=` — chat scrollback (rx + own tx), 2 s poll
- `GET /api/mesh/events?since=` — connection/join system events, 3 s poll
- `GET /api/mesh/position` — self GPS
- `POST /api/mesh/send` — channel + DM transmit

Chat rendering preserves the V1 mIRC aesthetic exactly: JetBrains Mono, `[HH:MM:SSZ]`
Zulu timestamps, the verbatim V1 per-callsign HSL color hash, plain left-aligned lines
(no bubbles), auto-scroll-unless-scrolled-up, and dimmer inline system events.

> Note: there is no SSE endpoint for mesh in Node-RED; "real-time incoming messages" is
> delivered by `?since=` polling (the same model V1 uses). True SSE would require a
> Node-RED flow addition.
