"""Config flow for Domuse Irrigation."""
from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import DOMAIN, CONF_SHOW_IN_SIDEBAR


class DomIrrigationConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle the initial setup config flow."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="already_configured")

        if user_input is not None:
            return self.async_create_entry(
                title="Domuse Irrigation",
                data={},
                options={CONF_SHOW_IN_SIDEBAR: user_input.get(CONF_SHOW_IN_SIDEBAR, True)},
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {vol.Optional(CONF_SHOW_IN_SIDEBAR, default=True): bool}
            ),
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return DomIrrigationOptionsFlow(config_entry)


class DomIrrigationOptionsFlow(config_entries.OptionsFlow):
    """Options accessible via Settings > Integrations > Configure."""

    def __init__(self, config_entry):
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_SHOW_IN_SIDEBAR,
                        default=self.config_entry.options.get(CONF_SHOW_IN_SIDEBAR, True),
                    ): bool,
                }
            ),
        )