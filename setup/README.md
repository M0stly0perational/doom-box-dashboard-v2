# Setup reference

Reference copies of the host-level configuration this dashboard depends on.
None of this is installed by cloning the repo — it documents what the field
station's OS-level setup looks like. Paths and the service account name
(`doombox`) are placeholders; substitute your own.

## `udev/70-gps-heltec.rules`

Stable device symlinks for two USB serial devices, both matched by USB
vendor/product ID (and, for the GPS puck, its exact serial — the vendor:product
pair alone is a generic Prolific bridge chip shared by unrelated hardware):

- GPS puck → `/dev/gps0`
- Heltec V4 (Meshtastic LoRa node) → `/dev/heltec0`

Both are tagged `ID_MM_DEVICE_IGNORE=1` so ModemManager never probes them —
without this, ModemManager can grab the port before your own service does.

**The two SDR dongles have no udev rule.** Their `adsb` / `scanner` identities
are programmed directly into each dongle's EEPROM with `rtl_eeprom`, and read
by name at runtime (`rtl_sdr -d adsb`, `dump1090-fa`'s `RECEIVER_SERIAL=adsb`
config value below) — there's no device file to symlink. If you're setting
this up fresh with your own RTL-SDR dongles:
```bash
rtl_eeprom -d 0 -s adsb      # or whatever index rtl_test shows for each dongle
rtl_eeprom -d 1 -s scanner
```
Bus/device numbers shift on every replug; the EEPROM serial is what stays
stable, which is why every fetcher/daemon here targets dongles by serial, not
by index.

## `systemd/`

One directory per functional area. `nodered.service` is the only hard
dependency for the dashboard to load at all; everything else backs a specific
tab's live data and degrades gracefully (empty/stale data, not a crash) if
its service isn't running.

| Unit | Feeds | Notes |
|---|---|---|
| `nodered.service` | everything | serves the dashboard's static files and every `/api/*` endpoint |
| `meshtastic-bridge.service` | MESH | exclusive owner of the Heltec's serial port |
| `sigint-controller.service` | SIGINT | disabled at boot by design — operator starts it manually |
| `ollama.service` | AI | local-only, no network exposure |
| `map-region-fetcher.service` | MAP | long-running PMTiles download supervisor |
| `wx-fetcher.service` + `.timer` | WX | every 5 min |
| `poi-fetcher.service` + `.timer` | MAP (POI layers) | weekly |
| `crime-fetcher.service` + `.timer` | OSINT | hourly |
| `news-fetcher.service` + `.timer` | OSINT | every 15 min |
| `gdelt-fetcher.service` + `.timer` | CONFLICT, MAP | every 15 min |
| `usgs-fetcher.service` + `.timer` | MAP | every 10 min |
| `gdacs-fetcher.service` + `.timer` | MAP | every 30 min |
| `tfr-fetcher.service` + `.timer` | MAP | every 15 min |
| `satellite-fetcher.service` + `.timer` | MAP | hourly |
| `firms-fetcher.service` + `.timer` | CONFLICT, MAP | hourly — needs `NASA_FIRMS_*` from `.env.example` |
| `acled-fetcher.service` + `.timer` | CONFLICT (currently unused) | disabled — see `.env.example` |
| `conflict-zones-gen.service` + `.timer` | CONFLICT | every 15 min, runs after the GDELT fetch |

`systemd/vendor-reference/dump1090-fa.*` are the **stock, unmodified**
apt-packaged unit and its `/etc/default` config, included only to show the
`RECEIVER_SERIAL=adsb` line that ties it to the EEPROM-programmed dongle
above — not something this project authored.

All of these are systemwide (`/etc/systemd/system/`) except where the fetcher
itself needs no special privileges, in which case they still run as the
`doombox` service account, never root, with `ProtectSystem=full` /
`ProtectHome=read-only` sandboxing.
