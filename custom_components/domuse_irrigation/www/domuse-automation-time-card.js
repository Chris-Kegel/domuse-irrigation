/**
 * domuse-automation-time-card  v1.1.3
 * Lovelace card for viewing and editing time-based triggers + weekday conditions
 * of an existing Home Assistant automation.
 *
 * Uses config/entity_registry/get (WS) to resolve unique_id — hass.entities
 * only holds display-entries which omit unique_id in modern HA.
 * Uses direct fetch() for all REST API calls.
 */

const ATW_VERSION = '1.1.4';

const ATW_DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

/* ════════════════════════════════════════
   Card Editor
   ════════════════════════════════════════ */
class DomAutomationTimeCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass   = null;
    this._config = {};
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    this._config = config ?? {};
    this._render();
  }

  _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  _render() {
    var current = this._config.automation_entity ?? '';
    var autos   = Object.values((this._hass && this._hass.states) || {})
      .filter(function(s) { return s.entity_id.startsWith('automation.'); })
      .sort(function(a, b) {
        return ((a.attributes && a.attributes.friendly_name) || a.entity_id)
          .localeCompare((b.attributes && b.attributes.friendly_name) || b.entity_id);
      });

    var options = '<option value="">Select an automation…</option>';
    for (var i = 0; i < autos.length; i++) {
      var a     = autos[i];
      var label = (a.attributes && a.attributes.friendly_name) || a.entity_id;
      var sel   = a.entity_id === current ? ' selected' : '';
      options  += '<option value="' + this._esc(a.entity_id) + '"' + sel + '>' + this._esc(label) + '</option>';
    }

    this.shadowRoot.innerHTML = (
      '<style>' +
        '.field { margin-bottom: 14px; }' +
        'label { display: block; font-size: 11px; font-weight: 700; letter-spacing: .05em;' +
                'text-transform: uppercase; color: var(--secondary-text-color); margin-bottom: 6px; }' +
        'select { width: 100%; padding: 10px 12px; background: var(--card-background-color, #fff);' +
                 'border: 1px solid var(--divider-color, rgba(0,0,0,.15)); border-radius: 8px;' +
                 'color: var(--primary-text-color); font-size: 14px; outline: none; }' +
      '</style>' +
      '<div class="field"><label>Automation</label><select id="sel">' + options + '</select></div>'
    );

    var self = this;
    this.shadowRoot.getElementById('sel').addEventListener('change', function(e) {
      self.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: Object.assign({}, self._config, { automation_entity: e.target.value }) },
        bubbles: true,
        composed: true,
      }));
    });
  }
}
customElements.define('domuse-automation-time-card-editor', DomAutomationTimeCardEditor);


/* ════════════════════════════════════════
   Main Card
   ════════════════════════════════════════ */
class DomAutomationTimeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass       = null;
    this._config     = null;
    this._autoId     = null;   // resolved unique_id / config id
    this._autoConfig = null;
    this._loading    = false;
    this._error      = null;
    this._editTimes  = null;
    this._editDays   = null;
    this._saving     = false;
    this._dirty      = false;
  }

  static getConfigElement() { return document.createElement('domuse-automation-time-card-editor'); }
  static getStubConfig()    { return { automation_entity: '' }; }
  getCardSize()             { return 4; }

  setConfig(config) {
    var prevEntity = this._config && this._config.automation_entity;
    this._config = config;
    if (prevEntity !== config.automation_entity) this._reset();
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config && !this._autoConfig && !this._loading && !this._error) {
      this._loadConfig();
    }
    this._syncToggle();
  }

  _reset() {
    this._autoId     = null;
    this._autoConfig = null;
    this._editTimes  = null;
    this._editDays   = null;
    this._error      = null;
    this._loading    = false;
    this._dirty      = false;
  }

  /* Fetch the full entity registry entry via WebSocket to get unique_id.
     hass.entities only has display-entries (no unique_id) in modern HA. */
  async _resolveAutoId() {
    var eid = this._config && this._config.automation_entity;
    if (!eid) return null;
    try {
      var entry = await this._hass.callWS({ type: 'config/entity_registry/get', entity_id: eid });
      return (entry && entry.unique_id) ? entry.unique_id : null;
    } catch (e) {
      return null;
    }
  }

  /* Direct HTTP REST call — no WebSocket. */
  _authHeaders() {
    var token = this._hass.auth && this._hass.auth.data && this._hass.auth.data.access_token;
    return { 'Authorization': 'Bearer ' + (token || ''), 'Content-Type': 'application/json' };
  }
  _hassUrl() {
    return (this._hass.auth && this._hass.auth.data && this._hass.auth.data.hassUrl) || '';
  }

  async _apiGet(path) {
    var resp = await fetch(this._hassUrl() + '/api/' + path, { headers: this._authHeaders() });
    if (!resp.ok) {
      var body = await resp.json().catch(function() { return {}; });
      throw new Error(body.message || (resp.status + ' ' + resp.statusText));
    }
    return resp.json();
  }

  async _apiPost(path, data) {
    var resp = await fetch(this._hassUrl() + '/api/' + path, {
      method: 'POST',
      headers: this._authHeaders(),
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      var body = await resp.json().catch(function() { return {}; });
      throw new Error(body.message || (resp.status + ' ' + resp.statusText));
    }
    return resp.json().catch(function() { return {}; });
  }

  async _loadConfig() {
    if (!this._config || !this._config.automation_entity) return;
    this._loading = true;
    this._error   = null;
    this._render();

    try {
      this._autoId = await this._resolveAutoId();

      if (!this._autoId) {
        this._error = (
          'Could not find a unique ID for this automation. ' +
          'Make sure it was created or saved via the HA Automation editor. ' +
          'YAML-only automations need an "id:" field.'
        );
        this._loading = false;
        this._render();
        return;
      }

      this._autoConfig = await this._apiGet('config/automation/config/' + this._autoId);
      this._editTimes  = this._extractTimes(this._autoConfig);
      this._editDays   = this._extractDays(this._autoConfig);
      this._dirty      = false;
    } catch (e) {
      this._error = 'Failed to load automation: ' + (e.message || String(e));
    }

    this._loading = false;
    this._render();
  }

  _extractTimes(cfg) {
    // HA 2024+ uses 'triggers' (plural); older HA uses 'trigger'.
    var triggers = cfg.triggers || cfg.trigger || [];
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].platform === 'time') {
        var at = triggers[i].at;
        return Array.isArray(at) ? at.slice() : (at ? [at] : []);
      }
    }
    return [];
  }

  _extractDays(cfg) {
    // HA 2024+ uses 'conditions' (plural); older HA uses 'condition'.
    var conds = cfg.conditions || cfg.condition || [];
    for (var i = 0; i < conds.length; i++) {
      if (conds[i].condition === 'time' && conds[i].weekday) return conds[i].weekday.slice();
    }
    return [];
  }

  async _save() {
    if (this._saving || !this._autoConfig || !this._autoId) return;
    this._saving = true;
    this._renderBody();

    try {
      var cfg = JSON.parse(JSON.stringify(this._autoConfig));

      // Use whichever key format HA already put in the config.
      // Mixing 'trigger' and 'triggers' in the same object causes a validation error.
      var tk = Array.isArray(cfg.triggers)   ? 'triggers'   : 'trigger';
      var ck = Array.isArray(cfg.conditions) ? 'conditions' : 'condition';
      cfg[tk] = cfg[tk] || [];
      cfg[ck] = cfg[ck] || [];

      var ti = -1;
      for (var i = 0; i < cfg[tk].length; i++) {
        if (cfg[tk][i].platform === 'time') { ti = i; break; }
      }
      var atValue = this._editTimes.length === 1 ? this._editTimes[0] : this._editTimes.slice();
      if (ti >= 0) { cfg[tk][ti].at = atValue; }
      else         { cfg[tk].push({ platform: 'time', at: atValue }); }

      var ci = -1;
      for (var j = 0; j < cfg[ck].length; j++) {
        if (cfg[ck][j].condition === 'time' && cfg[ck][j].weekday !== undefined) { ci = j; break; }
      }
      if (this._editDays.length > 0) {
        if (ci >= 0) { cfg[ck][ci].weekday = this._editDays.slice(); }
        else         { cfg[ck].push({ condition: 'time', weekday: this._editDays.slice() }); }
      } else if (ci >= 0) {
        cfg[ck].splice(ci, 1);
      }

      await this._apiPost('config/automation/config/' + this._autoId, cfg);
      await this._hass.callService('automation', 'reload');
      this._autoConfig = cfg;
      this._dirty      = false;
      this._error      = null;
    } catch (e) {
      this._error = 'Save failed: ' + (e.message || String(e));
    }

    this._saving = false;
    this._renderBody();
  }

  _syncToggle() {
    var btn = this.shadowRoot && this.shadowRoot.querySelector('.auto-toggle');
    if (!btn) return;
    var stateObj = this._hass && this._config && this._hass.states[this._config.automation_entity];
    var state    = stateObj ? stateObj.state : 'unknown';
    btn.classList.toggle('on', state === 'on');
    btn.dataset.state = state;
  }

  async _toggleAuto() {
    var stateObj = this._hass.states[this._config.automation_entity];
    var state    = stateObj ? stateObj.state : 'off';
    await this._hass.callService('automation', state === 'on' ? 'turn_off' : 'turn_on',
      { entity_id: this._config.automation_entity });
  }

  _setTime(idx, val)  { this._editTimes = this._editTimes.slice(); this._editTimes[idx] = val; this._dirty = true; this._renderBody(); }
  _addTime()          { this._editTimes = this._editTimes.concat(['08:00:00']); this._dirty = true; this._renderBody(); }
  _removeTime(idx)    { this._editTimes = this._editTimes.filter(function(_, i) { return i !== idx; }); this._dirty = true; this._renderBody(); }

  _toggleDay(key) {
    if (this._editDays.indexOf(key) >= 0) {
      this._editDays = this._editDays.filter(function(d) { return d !== key; });
    } else {
      this._editDays = this._editDays.concat([key]);
    }
    this._dirty = true;
    this._renderBody();
  }

  _cancel() {
    this._editTimes = this._extractTimes(this._autoConfig);
    this._editDays  = this._extractDays(this._autoConfig);
    this._dirty     = false;
    this._error     = null;
    this._renderBody();
  }

  /* ─── RENDER ─── */

  _render() {
    var entity   = this._config && this._config.automation_entity;
    var stateObj = entity && this._hass && this._hass.states[entity];
    var name     = stateObj ? (stateObj.attributes.friendly_name || entity) : (entity || 'Automation');
    var state    = stateObj ? stateObj.state : 'unknown';

    this.shadowRoot.innerHTML = (
      this._css() +
      '<ha-card>' +
        '<div class="card-header">' +
          '<div class="header-left">' +
            '<svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5C3.89 3 3.01 3.9 3.01 5' +
                                             'L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2' +
                                             'zm3 18H5V8h14v11z"/></svg>' +
            '<span class="card-title">' + this._esc(name) + '</span>' +
          '</div>' +
          '<button class="auto-toggle ' + (state === 'on' ? 'on' : '') + '" id="auto-toggle" data-state="' + state + '"></button>' +
        '</div>' +
        '<div class="card-body" id="card-body">' + this._bodyHTML() + '</div>' +
      '</ha-card>'
    );
    this._bindAll();
  }

  _renderBody() {
    var body = this.shadowRoot.getElementById('card-body');
    if (body) body.innerHTML = this._bodyHTML();
    this._bindBody();
  }

  _bodyHTML() {
    if (!this._config || !this._config.automation_entity)
      return '<div class="msg">Select an automation in the card settings (pencil icon).</div>';
    if (this._loading)     return '<div class="spinner-wrap"><div class="spinner"></div></div>';
    if (this._error)       return '<div class="msg error">' + this._esc(this._error) + '</div>';
    if (!this._autoConfig) return '<div class="spinner-wrap"><div class="spinner"></div></div>';

    var timesHTML = '';
    var times = this._editTimes || [];
    for (var i = 0; i < times.length; i++) {
      timesHTML += (
        '<div class="time-row">' +
          '<input class="time-input" type="time" step="1" value="' + this._esc(times[i]) + '" data-idx="' + i + '">' +
          '<button class="remove-btn" data-remove-time="' + i + '" title="Remove">' +
            '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59' +
                                              ' 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
          '</button>' +
        '</div>'
      );
    }

    var daysHTML = '';
    var editDays = this._editDays || [];
    for (var d = 0; d < ATW_DAYS.length; d++) {
      var day = ATW_DAYS[d];
      var sel = editDays.indexOf(day.key) >= 0 ? ' sel' : '';
      daysHTML += '<button class="day-btn' + sel + '" data-day="' + day.key + '">' + day.label + '</button>';
    }

    var actionsHTML = '';
    if (this._dirty) {
      actionsHTML = (
        '<div class="actions">' +
          '<button class="btn-secondary" id="btn-cancel">Cancel</button>' +
          '<button class="btn-primary' + (this._saving ? ' saving' : '') + '" id="btn-save">' +
            (this._saving ? 'Saving…' : 'Save Changes') +
          '</button>' +
        '</div>'
      );
    }

    return (
      '<div class="section-label">Time Triggers</div>' +
      (times.length === 0 ? '<div class="empty-msg">No time triggers — add one below.</div>' : timesHTML) +
      '<button class="add-time-btn" id="add-time">' +
        '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>Add Time' +
      '</button>' +
      '<div class="section-label" style="margin-top:18px">Active Days ' +
        '<span class="days-hint">(empty = every day)</span></div>' +
      '<div class="day-picker">' + daysHTML + '</div>' +
      actionsHTML +
      '<div class="version">v' + ATW_VERSION + '</div>'
    );
  }

  _bindAll() {
    var self = this;
    var btn  = this.shadowRoot.getElementById('auto-toggle');
    if (btn) btn.addEventListener('click', function() { self._toggleAuto(); });
    this._bindBody();
  }

  _bindBody() {
    var self = this;
    var sr   = this.shadowRoot;
    sr.querySelectorAll('.time-input').forEach(function(inp) {
      inp.addEventListener('change', function(e) { self._setTime(parseInt(e.target.dataset.idx, 10), e.target.value); });
    });
    sr.querySelectorAll('[data-remove-time]').forEach(function(btn) {
      btn.addEventListener('click', function() { self._removeTime(parseInt(btn.dataset.removeTime, 10)); });
    });
    var addTime = sr.getElementById('add-time');
    if (addTime) addTime.addEventListener('click', function() { self._addTime(); });
    sr.querySelectorAll('.day-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { self._toggleDay(btn.dataset.day); });
    });
    var saveBtn   = sr.getElementById('btn-save');
    var cancelBtn = sr.getElementById('btn-cancel');
    if (saveBtn)   saveBtn.addEventListener('click', function() { self._save(); });
    if (cancelBtn) cancelBtn.addEventListener('click', function() { self._cancel(); });
  }

  _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  _css() {
    return (
      '<style>' +
        ':host { display: block; }' +
        'ha-card { overflow: hidden; }' +
        '.card-header { display: flex; align-items: center; justify-content: space-between;' +
                       'padding: 14px 18px; border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.08)); }' +
        '.header-left { display: flex; align-items: center; gap: 10px; }' +
        '.header-left svg { width: 22px; height: 22px; fill: #0E9CA5; flex-shrink: 0; }' +
        '.card-title { font-size: 16px; font-weight: 600; color: var(--primary-text-color); }' +
        '.auto-toggle { width: 50px; height: 28px; border-radius: 14px; border: none; cursor: pointer;' +
                       'outline: none; background: rgba(0,0,0,.12); position: relative;' +
                       'transition: background .2s; flex-shrink: 0; }' +
        '.auto-toggle::after { content: ""; position: absolute; width: 22px; height: 22px;' +
                               'border-radius: 50%; background: #fff; top: 3px; left: 3px;' +
                               'transition: transform .2s; box-shadow: 0 1px 4px rgba(0,0,0,.3); }' +
        '.auto-toggle.on { background: #0E9CA5; }' +
        '.auto-toggle.on::after { transform: translateX(22px); }' +
        '.card-body { padding: 16px 18px; }' +
        '.section-label { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;' +
                         'color: var(--secondary-text-color, #94a3b8); margin-bottom: 10px; }' +
        '.days-hint { font-size: 10px; font-weight: 400; text-transform: none; letter-spacing: 0; opacity: .65; }' +
        '.time-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }' +
        '.time-input { flex: 1; padding: 9px 12px;' +
                      'background: var(--secondary-background-color, rgba(0,0,0,.04));' +
                      'border: 1px solid var(--divider-color, rgba(0,0,0,.12));' +
                      'border-radius: 8px; color: var(--primary-text-color); font-size: 15px; outline: none; }' +
        '.time-input:focus { border-color: #0E9CA5; }' +
        '.remove-btn { width: 34px; height: 34px; border-radius: 50%; border: none; background: none;' +
                      'cursor: pointer; display: flex; align-items: center; justify-content: center;' +
                      'color: var(--secondary-text-color, #94a3b8); flex-shrink: 0; }' +
        '.remove-btn:hover { background: rgba(239,68,68,.1); color: #ef4444; }' +
        '.remove-btn svg { width: 18px; height: 18px; fill: currentColor; }' +
        '.add-time-btn { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 4px;' +
                        'padding: 7px 14px; border: 1px dashed var(--divider-color, rgba(0,0,0,.2));' +
                        'border-radius: 8px; background: none; color: #0E9CA5;' +
                        'font-size: 13px; font-weight: 600; cursor: pointer; }' +
        '.add-time-btn:hover { background: rgba(14,156,165,.08); }' +
        '.add-time-btn svg { width: 16px; height: 16px; fill: currentColor; }' +
        '.day-picker { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 4px; }' +
        '.day-btn { width: 42px; height: 42px; border-radius: 50%;' +
                   'border: 2px solid var(--divider-color, rgba(0,0,0,.12));' +
                   'background: none; color: var(--primary-text-color);' +
                   'font-size: 11px; font-weight: 700; cursor: pointer; transition: all .15s; }' +
        '.day-btn:hover { border-color: #0E9CA5; }' +
        '.day-btn.sel { background: #0E9CA5; border-color: #0E9CA5; color: #fff; }' +
        '.actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;' +
                   'padding-top: 16px; border-top: 1px solid var(--divider-color, rgba(0,0,0,.08)); }' +
        '.btn-primary { padding: 9px 18px; border: none; border-radius: 8px; background: #0E9CA5;' +
                       'color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }' +
        '.btn-primary:hover { opacity: .85; }' +
        '.btn-primary.saving { opacity: .6; cursor: not-allowed; }' +
        '.btn-secondary { padding: 9px 18px; border: 1px solid var(--divider-color, rgba(0,0,0,.15));' +
                         'border-radius: 8px; background: none; color: var(--secondary-text-color);' +
                         'font-size: 13px; cursor: pointer; }' +
        '.empty-msg { font-size: 13px; color: var(--secondary-text-color, #94a3b8); margin-bottom: 12px; }' +
        '.msg { padding: 16px; font-size: 13px; color: var(--secondary-text-color); line-height: 1.5; }' +
        '.msg.error { color: #ef4444; }' +
        '.spinner-wrap { display: flex; justify-content: center; padding: 24px; }' +
        '.spinner { width: 28px; height: 28px; border-radius: 50%;' +
                   'border: 3px solid rgba(0,0,0,.1); border-top-color: #0E9CA5;' +
                   'animation: spin .7s linear infinite; }' +
        '@keyframes spin { to { transform: rotate(360deg); } }' +
        '.version { font-size: 10px; color: var(--secondary-text-color); opacity: .4;' +
                   'text-align: right; margin-top: 12px; }' +
      '</style>'
    );
  }
}

customElements.define('domuse-automation-time-card', DomAutomationTimeCard);
window.customCards = window.customCards ?? [];
window.customCards.push({
  type:        'domuse-automation-time-card',
  name:        'Automation Time Editor',
  description: 'Edit time-based triggers and active weekdays of an existing HA automation.',
  preview:     false,
});
