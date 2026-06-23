"""Domuse Irrigation — Home Assistant Integration."""
from __future__ import annotations

import logging
import os
import uuid

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.persistent_notification import async_create as pn_create
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_call_later, async_track_time_change
from homeassistant.helpers.storage import Store

from .const import (
    CARD_URL,
    CONF_SHOW_IN_SIDEBAR,
    DOMAIN,
    PANEL_URL,
    STATIC_PATH,
    STORAGE_KEY,
    STORAGE_VERSION,
)

_LOGGER = logging.getLogger(__name__)
_WS_REGISTERED = False


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    global _WS_REGISTERED
    if not _WS_REGISTERED:
        _register_ws_commands(hass)
        _WS_REGISTERED = True
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    data = await store.async_load() or {"pumps": [], "schedules": []}

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {"store": store, "data": data, "timers": {}}

    www_path = os.path.join(os.path.dirname(__file__), "www")
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_PATH, www_path, cache_headers=False)]
    )

    if entry.options.get(CONF_SHOW_IN_SIDEBAR, True):
        await _register_panel(hass)

    _schedule_card_resource(hass)
    await _setup_schedules(hass, entry.entry_id)
    entry.async_on_unload(entry.add_update_listener(_async_reload_listener))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    domain_data = hass.data[DOMAIN].pop(entry.entry_id, {})
    for unsub in domain_data.get("timers", {}).values():
        unsub()
    return True


async def _async_reload_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def _register_panel(hass: HomeAssistant) -> None:
    from homeassistant.components import panel_custom
    try:
        await panel_custom.async_register_panel(
            hass,
            webcomponent_name="domuse-irrigation-panel",
            frontend_url_path="domuse-irrigation",
            module_url=PANEL_URL,
            sidebar_title="Irrigation",
            sidebar_icon="mdi:water-pump",
            config={},
            require_admin=False,
            trust_external=False,
        )
    except ValueError:
        pass


def _schedule_card_resource(hass: HomeAssistant) -> None:
    async def _do_register(_event=None) -> None:
        try:
            from homeassistant.components.lovelace import DOMAIN as LOVELACE_DOMAIN
            lovelace = hass.data.get(LOVELACE_DOMAIN)
            resources = getattr(lovelace, "resources", None)
            if resources is None:
                _LOGGER.warning("domuse_irrigation: Lovelace resources not available")
                _show_manual_resource_notification(hass)
                return
            try:
                await resources.async_load()
            except Exception:
                pass
            try:
                items = resources.async_items()
            except AttributeError:
                items = list(getattr(resources, "data", {}).values())
            for item in items:
                if item.get("url") == CARD_URL:
                    return
            await resources.async_create_item({"res_type": "module", "url": CARD_URL})
            _LOGGER.info("domuse_irrigation: registered Lovelace card resource %s", CARD_URL)
        except Exception as err:
            _LOGGER.warning("domuse_irrigation: card resource registration failed (%s)", err)
            _show_manual_resource_notification(hass)

    if hass.is_running:
        hass.async_create_task(_do_register())
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _do_register)


def _show_manual_resource_notification(hass: HomeAssistant) -> None:
    pn_create(
        hass,
        (
            "The Irrigation card could not be auto-registered as a Lovelace resource.\n\n"
            "Add it manually:\n"
            "**Settings -> Dashboards -> three-dot menu -> Resources -> Add Resource**\n\n"
            f"URL: {CARD_URL}\n"
            "Type: JavaScript module\n\n"
            "Then hard-refresh your browser (Ctrl+Shift+R)."
        ),
        title="Domuse Irrigation - Action needed",
        notification_id=f"{DOMAIN}_card_resource",
    )


def _schedule_duration_seconds(schedule: dict) -> int:
    if "duration_seconds" in schedule:
        return int(schedule["duration_seconds"])
    return int(schedule.get("duration_minutes", 10)) * 60


async def _setup_schedules(hass: HomeAssistant, entry_id: str) -> None:
    domain_data = hass.data[DOMAIN][entry_id]
    for unsub in domain_data["timers"].values():
        unsub()
    domain_data["timers"] = {}

    for schedule in domain_data["data"].get("schedules", []):
        sid = schedule["id"]
        weekdays = schedule.get("weekdays", [])
        try:
            parts = schedule.get("time", "08:00:00").split(":")
            hour   = int(parts[0])
            minute = int(parts[1])
            second = int(parts[2]) if len(parts) > 2 else 0
        except (ValueError, AttributeError, IndexError):
            _LOGGER.warning("Invalid time in schedule %s - skipping.", sid)
            continue
        entity_id = schedule.get("pump_entity_id", "")
        duration = _schedule_duration_seconds(schedule)

        async def _fire(now, _eid=entity_id, _dur=duration, _days=weekdays):
            if now.weekday() not in _days:
                return
            _LOGGER.debug("Irrigation firing for %s (%ds)", _eid, _dur)
            await hass.services.async_call("switch", "turn_on", {"entity_id": _eid})
            async_call_later(
                hass,
                _dur,
                lambda _now, eid=_eid: hass.async_create_task(
                    hass.services.async_call("switch", "turn_off", {"entity_id": eid})
                ),
            )

        unsub = async_track_time_change(
            hass,
            lambda now, f=_fire: hass.async_create_task(f(now)),
            hour=hour, minute=minute, second=second,
        )
        domain_data["timers"][sid] = unsub


def _get_entry_id(hass: HomeAssistant) -> str | None:
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0].entry_id if entries else None


def _register_ws_commands(hass: HomeAssistant) -> None:
    for cmd in (ws_get_config, ws_add_pump, ws_remove_pump,
                ws_add_schedule, ws_remove_schedule, ws_toggle_pump, ws_get_switches):
        websocket_api.async_register_command(hass, cmd)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_config"})
@websocket_api.async_response
async def ws_get_config(hass, connection, msg):
    eid = _get_entry_id(hass)
    if not eid:
        connection.send_error(msg["id"], "not_found", "Integration not configured")
        return
    connection.send_result(msg["id"], hass.data[DOMAIN][eid]["data"])


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/add_pump",
    vol.Required("name"): str,
    vol.Required("entity_id"): str,
})
@websocket_api.async_response
async def ws_add_pump(hass, connection, msg):
    eid = _get_entry_id(hass)
    if not eid:
        connection.send_error(msg["id"], "not_found", "Integration not configured")
        return
    dd = hass.data[DOMAIN][eid]
    pump = {"id": str(uuid.uuid4()), "name": msg["name"], "entity_id": msg["entity_id"]}
    dd["data"]["pumps"].append(pump)
    await dd["store"].async_save(dd["data"])
    connection.send_result(msg["id"], pump)


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/remove_pump",
    vol.Required("pump_id"): str,
})
@websocket_api.async_response
async def ws_remove_pump(hass, connection, msg):
    eid = _get_entry_id(hass)
    if not eid:
        connection.send_error(msg["id"], "not_found", "Integration not configured")
        return
    dd = hass.data[DOMAIN][eid]
    dd["data"]["pumps"] = [p for p in dd["data"]["pumps"] if p["id"] != msg["pump_id"]]
    await dd["store"].async_save(dd["data"])
    connection.send_result(msg["id"], {"success": True})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/add_schedule",
    vol.Required("pump_entity_id"): str,
    vol.Required("weekdays"): list,
    vol.Required("time"): str,
    vol.Required("duration_seconds"): int,
    vol.Optional("name", default=""): str,
})
@websocket_api.async_response
async def ws_add_schedule(hass, connection, msg):
    eid = _get_entry_id(hass)
    if not eid:
        connection.send_error(msg["id"], "not_found", "Integration not configured")
        return
    dd = hass.data[DOMAIN][eid]
    schedule = {
        "id": str(uuid.uuid4()),
        "name": msg.get("name", ""),
        "pump_entity_id": msg["pump_entity_id"],
        "weekdays": msg["weekdays"],
        "time": msg["time"],
        "duration_seconds": msg["duration_seconds"],
    }
    dd["data"]["schedules"].append(schedule)
    await dd["store"].async_save(dd["data"])
    await _setup_schedules(hass, eid)
    connection.send_result(msg["id"], schedule)


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/remove_schedule",
    vol.Required("schedule_id"): str,
})
@websocket_api.async_response
async def ws_remove_schedule(hass, connection, msg):
    eid = _get_entry_id(hass)
    if not eid:
        connection.send_error(msg["id"], "not_found", "Integration not configured")
        return
    dd = hass.data[DOMAIN][eid]
    dd["data"]["schedules"] = [s for s in dd["data"]["schedules"] if s["id"] != msg["schedule_id"]]
    await dd["store"].async_save(dd["data"])
    await _setup_schedules(hass, eid)
    connection.send_result(msg["id"], {"success": True})


@websocket_api.websocket_command({
    vol.Required("type"): f"{DOMAIN}/toggle_pump",
    vol.Required("entity_id"): str,
    vol.Required("state"): bool,
})
@websocket_api.async_response
async def ws_toggle_pump(hass, connection, msg):
    service = "turn_on" if msg["state"] else "turn_off"
    await hass.services.async_call("switch", service, {"entity_id": msg["entity_id"]})
    connection.send_result(msg["id"], {"success": True})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_switches"})
@websocket_api.async_response
async def ws_get_switches(hass, connection, msg):
    states = hass.states.async_all("switch")
    connection.send_result(msg["id"], [
        {"entity_id": s.entity_id,
         "name": s.attributes.get("friendly_name", s.entity_id),
         "state": s.state}
        for s in sorted(states, key=lambda s: s.entity_id)
    ])