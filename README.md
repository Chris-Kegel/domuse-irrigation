# Domuse Irrigation

A Home Assistant custom integration for controlling irrigation pumps and watering schedules.

## Features

- **Sidebar panel** — dedicated configuration page in the HA sidebar
- **Pump management** — add any existing `switch.*` entity as an irrigation pump
- **Watering schedules** — weekday selection, start time, and duration per pump
- **Manual control** — Lovelace card with per-pump toggle switches
- **Auto-scheduling** — HA turns the pump on/off automatically at the scheduled time

---

## Installation

### Manual

1. Copy `custom_components/domuse_irrigation/` into your HA `config/custom_components/` folder.
2. Restart Home Assistant.
3. Go to **Settings → Integrations → Add Integration** and search for **Domuse Irrigation**.
4. Follow the setup wizard (choose whether to show in the sidebar).

### HACS

1. In HACS go to **Integrations → ⋮ → Custom repositories**.
2. Add `https://github.com/Chris-Kegel/domuse-irrigation` with category **Integration**.
3. Install **Domuse Irrigation** and restart HA.

---

## Configuration

After setup, click **Configure** on the integration card in Settings → Integrations:

| Option | Description |
|--------|-------------|
| Show in sidebar | Adds an *Irrigation* entry to the HA sidebar |

---

## Sidebar Panel

### Pumps tab

- Lists all configured pumps with live on/off state
- Toggle each pump manually
- Add a pump by selecting any existing `switch.*` entity
- Remove a pump (does not affect the underlying switch entity)

### Schedules tab

- Create watering schedules: choose a pump, select weekdays, set a start time and duration
- HA turns the pump on at the scheduled time and off after the duration

---

## Lovelace Card

The integration auto-registers the card resource. Add it to any dashboard:

```yaml
type: custom:domuse-irrigation-card
title: Irrigation Control   # optional
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `title` | string | `Irrigation Control` | Card header title |

The card reads the pump list from the integration automatically.

---

## How schedules work

Schedules are stored in `.storage/domuse_irrigation_data`.
At the scheduled time the integration calls `switch.turn_on`, waits for the duration via `async_call_later`, then calls `switch.turn_off`.

> **Note:** If HA restarts while a pump is running it will not be automatically stopped. For safety-critical setups add a HA automation with a maximum-on-time guard.