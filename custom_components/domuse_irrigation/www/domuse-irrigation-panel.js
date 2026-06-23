const DOMAIN = 'domuse_irrigation';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

class DomIrrigationPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass           = null;
    this._config         = { pumps: [], schedules: [] };
    this._switches       = [];
    this._tab            = 'pumps';
    this._loading        = true;
    this._addingPump     = false;
    this._addingSchedule = false;
    this._newDays        = [];
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loading) this._updateLiveStates();
  }

  connectedCallback() { this._boot(); }

  async _boot() {
    this._loading = true;
    this._render();
    try {
      [this._config, this._switches] = await Promise.all([
        this._hass.callWS({ type: `${DOMAIN}/get_config` }),
        this._hass.callWS({ type: `${DOMAIN}/get_switches` }),
      ]);
    } catch (e) { console.error('[domuse-irrigation] boot failed', e); }
    this._loading = false;
    this._render();
  }

  _state(eid) { return this._hass?.states?.[eid]?.state ?? 'unknown'; }
  _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  _fmtDuration(schedule) {
    const secs = schedule.duration_seconds ?? ((schedule.duration_minutes ?? 0) * 60);
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60), r = secs % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }

  async _addPump(name, entityId) {
    const pump = await this._hass.callWS({ type: `${DOMAIN}/add_pump`, name, entity_id: entityId });
    this._config.pumps.push(pump);
    this._addingPump = false;
    this._render();
  }
  async _removePump(id) {
    await this._hass.callWS({ type: `${DOMAIN}/remove_pump`, pump_id: id });
    this._config.pumps = this._config.pumps.filter(p => p.id !== id);
    this._render();
  }
  async _addSchedule(payload) {
    const s = await this._hass.callWS({ type: `${DOMAIN}/add_schedule`, ...payload });
    this._config.schedules.push(s);
    this._addingSchedule = false;
    this._newDays = [];
    this._render();
  }
  async _removeSchedule(id) {
    await this._hass.callWS({ type: `${DOMAIN}/remove_schedule`, schedule_id: id });
    this._config.schedules = this._config.schedules.filter(s => s.id !== id);
    this._render();
  }
  async _togglePump(entityId, currentState) {
    await this._hass.callWS({ type: `${DOMAIN}/toggle_pump`, entity_id: entityId, state: currentState !== 'on' });
  }

  _updateLiveStates() {
    this.shadowRoot.querySelectorAll('[data-live-entity]').forEach(el => {
      const state = this._state(el.dataset.liveEntity);
      const kind  = el.dataset.liveKind;
      if (kind === 'toggle') { el.classList.toggle('on', state === 'on'); el.dataset.state = state; }
      else if (kind === 'badge') { el.textContent = state.toUpperCase(); el.className = `badge state-badge ${state}`; }
      else if (kind === 'icon')  { el.classList.toggle('active', state === 'on'); }
    });
  }

  _render() { this.shadowRoot.innerHTML = `${this._css()}${this._html()}`; this._bindEvents(); }

  _html() {
    return `<div class="panel">${this._htmlHeader()}${this._htmlTabs()}
      <div class="content">${this._loading
        ? '<div class="empty"><div class="spinner"></div><p>Loading...</p></div>'
        : this._tab === 'pumps' ? this._htmlPumps() : this._htmlSchedules()}
      </div></div>`;
  }

  _htmlHeader() {
    return `<header class="app-bar">
      <svg viewBox="0 0 24 24"><path d="M12 2c-5.33 4.55-8 8.48-8 11.8C4 18.78 7.8 22 12 22s8-3.22 8-8.2C20 10.48 17.33 6.55 12 2z"/></svg>
      <span>Irrigation</span></header>`;
  }

  _htmlTabs() {
    return `<div class="tabs">
      <button class="tab ${this._tab==='pumps'?'active':''}" data-tab="pumps">
        <svg viewBox="0 0 24 24"><path d="M20 10V8h-4V4h-2v4h-4V4H8v4H4v2h2v10h12V10h2zm-4 8h-2v-4h2v4zm-4 0h-2v-4h2v4z"/></svg>Pumps</button>
      <button class="tab ${this._tab==='schedules'?'active':''}" data-tab="schedules">
        <svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5C3.89 3 3.01 3.9 3.01 5L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>Schedules</button>
    </div>`;
  }

  _htmlPumps() {
    return `${this._addingPump ? this._htmlAddPumpForm() : `
      <button class="btn-primary add-btn" id="btn-add-pump">
        <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>Add Pump</button>`}
      ${this._config.pumps.length===0 && !this._addingPump
        ? this._htmlEmpty('No pumps yet. Add your first pump to get started.')
        : this._htmlPumpList()}`;
  }

  _htmlPumpList() {
    return `<div class="card">${this._config.pumps.map(p => {
      const state = this._state(p.entity_id);
      return `<div class="list-row">
        <div class="pump-icon ${state==='on'?'active':''}" data-live-entity="${this._esc(p.entity_id)}" data-live-kind="icon">
          <svg viewBox="0 0 24 24"><path d="M12 2c-5.33 4.55-8 8.48-8 11.8C4 18.78 7.8 22 12 22s8-3.22 8-8.2C20 10.48 17.33 6.55 12 2z"/></svg></div>
        <div class="list-info">
          <div class="list-title">${this._esc(p.name)}</div>
          <div class="list-sub">${this._esc(p.entity_id)}</div></div>
        <span class="badge state-badge ${state}" data-live-entity="${this._esc(p.entity_id)}" data-live-kind="badge">${state.toUpperCase()}</span>
        <button class="toggle ${state==='on'?'on':''}" data-live-entity="${this._esc(p.entity_id)}" data-live-kind="toggle"
                data-state="${state}" data-action="toggle-pump" data-entity-id="${this._esc(p.entity_id)}"></button>
        <button class="icon-btn" data-action="remove-pump" data-id="${this._esc(p.id)}">
          <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
      </div>`;
    }).join('')}</div>`;
  }

  _htmlAddPumpForm() {
    return `<div class="form-card"><div class="form-title">Add Pump</div>
      <div class="field"><label>Name</label>
        <input id="f-pump-name" type="text" placeholder="e.g. Garden Zone 1"></div>
      <div class="field"><label>Switch Entity</label>
        <select id="f-pump-entity"><option value="">Select a switch...</option>
          ${this._switches.map(s=>`<option value="${this._esc(s.entity_id)}">${this._esc(s.name)} (${this._esc(s.entity_id)})</option>`).join('')}
        </select></div>
      <div class="form-actions">
        <button class="btn-secondary" data-action="cancel-pump">Cancel</button>
        <button class="btn-primary" data-action="save-pump">Add Pump</button></div>
    </div>`;
  }

  _htmlSchedules() {
    return `${this._addingSchedule ? this._htmlAddScheduleForm() : `
      <button class="btn-primary add-btn" id="btn-add-schedule">
        <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>Add Schedule</button>`}
      ${this._config.schedules.length===0 && !this._addingSchedule
        ? this._htmlEmpty('No schedules yet. Create one to automate watering.')
        : this._htmlScheduleList()}`;
  }

  _htmlScheduleList() {
    return `<div class="card">${this._config.schedules.map(s => {
      const pump = this._config.pumps.find(p => p.entity_id === s.pump_entity_id);
      return `<div class="list-row">
        <div class="sched-icon">
          <svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5C3.89 3 3.01 3.9 3.01 5L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg></div>
        <div class="list-info">
          <div class="list-title">${this._esc(s.name||'Unnamed Schedule')}</div>
          <div class="list-sub">${this._esc(pump?pump.name:s.pump_entity_id)} &nbsp;·&nbsp; ${this._esc(s.time)} &nbsp;·&nbsp; ${this._fmtDuration(s)}</div>
          <div class="day-chips">${(s.weekdays??[]).map(d=>`<span class="day-chip">${DAYS[d]}</span>`).join('')}</div></div>
        <button class="icon-btn" data-action="remove-schedule" data-id="${this._esc(s.id)}">
          <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
      </div>`;
    }).join('')}</div>`;
  }

  _htmlAddScheduleForm() {
    return `<div class="form-card"><div class="form-title">Add Schedule</div>
      <div class="field"><label>Name (optional)</label>
        <input id="f-sched-name" type="text" placeholder="e.g. Morning Watering"></div>
      <div class="field"><label>Pump</label>
        <select id="f-sched-pump"><option value="">Select a pump...</option>
          ${this._config.pumps.map(p=>`<option value="${this._esc(p.entity_id)}">${this._esc(p.name)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Weekdays</label>
        <div class="day-picker">${DAYS.map((d,i)=>`
          <button class="day-btn ${this._newDays.includes(i)?'sel':''}" data-action="toggle-day" data-day="${i}">${d}</button>`).join('')}
        </div></div>
      <div class="field"><label>Start Time</label>
        <input id="f-sched-time" type="time" step="1" value="08:00:00"></div>
      <div class="field"><label>Duration (seconds)</label>
        <input id="f-sched-dur" type="number" value="600" min="1" max="86400"
               placeholder="e.g. 30 = 30s, 90 = 1m 30s, 600 = 10m"></div>
      <div class="form-actions">
        <button class="btn-secondary" data-action="cancel-schedule">Cancel</button>
        <button class="btn-primary" data-action="save-schedule">Add Schedule</button></div>
    </div>`;
  }

  _htmlEmpty(msg) {
    return `<div class="empty">
      <svg viewBox="0 0 24 24"><path d="M12 2c-5.33 4.55-8 8.48-8 11.8C4 18.78 7.8 22 12 22s8-3.22 8-8.2C20 10.48 17.33 6.55 12 2z"/></svg>
      <p>${msg}</p></div>`;
  }

  _bindEvents() {
    const sr = this.shadowRoot;
    sr.querySelectorAll('.tab').forEach(t =>
      t.addEventListener('click', () => { this._tab = t.dataset.tab; this._render(); }));
    const on = (id, fn) => { const el = sr.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('btn-add-pump',     () => { this._addingPump = true; this._render(); });
    on('btn-add-schedule', () => { this._addingSchedule = true; this._newDays = []; this._render(); });
    sr.querySelectorAll('[data-action]').forEach(el =>
      el.addEventListener('click', () => this._handleAction(el)));
  }

  _handleAction(el) {
    const { action, id, entityId, day } = el.dataset;
    const sr = this.shadowRoot;
    switch (action) {
      case 'cancel-pump':
        this._addingPump = false; this._render(); break;
      case 'save-pump': {
        const name = sr.getElementById('f-pump-name')?.value.trim();
        const eid  = sr.getElementById('f-pump-entity')?.value;
        if (!name || !eid) return;
        this._addPump(name, eid); break;
      }
      case 'remove-pump':
        if (confirm('Remove this pump?')) this._removePump(id); break;
      case 'toggle-pump':
        this._togglePump(entityId, el.dataset.state); break;
      case 'cancel-schedule':
        this._addingSchedule = false; this._newDays = []; this._render(); break;
      case 'save-schedule': {
        const pump = sr.getElementById('f-sched-pump')?.value;
        const time = sr.getElementById('f-sched-time')?.value;
        const dur  = parseInt(sr.getElementById('f-sched-dur')?.value, 10);
        const name = sr.getElementById('f-sched-name')?.value.trim() ?? '';
        if (!pump || !time || !this._newDays.length || !dur) return;
        this._addSchedule({ name, pump_entity_id: pump, weekdays: [...this._newDays], time, duration_seconds: dur });
        break;
      }
      case 'remove-schedule':
        if (confirm('Remove this schedule?')) this._removeSchedule(id); break;
      case 'toggle-day': {
        const d = parseInt(day, 10);
        this._newDays = this._newDays.includes(d)
          ? this._newDays.filter(x => x !== d)
          : [...this._newDays, d].sort((a,b) => a-b);
        el.classList.toggle('sel', this._newDays.includes(d));
        break;
      }
    }
  }

  _css() {
    return `<style>
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      :host{display:block;min-height:100%;background:var(--primary-background-color,#111827);color:var(--primary-text-color,#f1f5f9);font-family:var(--mdc-typography-body1-font-family,'Roboto',sans-serif);font-size:14px}
      .panel{display:flex;flex-direction:column;min-height:100vh}
      .app-bar{display:flex;align-items:center;gap:12px;padding:16px 24px;background:var(--app-header-background-color,#1e293b);color:var(--app-header-text-color,#f1f5f9);font-size:20px;font-weight:600;box-shadow:0 1px 0 rgba(255,255,255,.07)}
      .app-bar svg{width:26px;height:26px;fill:var(--primary-color,#38bdf8)}
      .tabs{display:flex;background:var(--app-header-background-color,#1e293b);border-bottom:1px solid rgba(255,255,255,.08)}
      .tab{display:flex;align-items:center;gap:6px;padding:12px 20px;background:none;border:none;border-bottom:2px solid transparent;color:var(--secondary-text-color,#94a3b8);font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;cursor:pointer;transition:color .15s,border-color .15s;margin-bottom:-1px}
      .tab svg{width:18px;height:18px;fill:currentColor}
      .tab:hover{color:var(--primary-text-color,#f1f5f9)}
      .tab.active{color:var(--primary-color,#38bdf8);border-bottom-color:var(--primary-color,#38bdf8)}
      .content{padding:24px;max-width:860px}
      .card{background:var(--card-background-color,#1e293b);border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.07);margin-bottom:16px}
      .list-row{display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06)}
      .list-row:last-child{border-bottom:none}
      .list-info{flex:1;min-width:0}
      .list-title{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .list-sub{font-size:12px;color:var(--secondary-text-color,#94a3b8);margin-top:2px}
      .pump-icon{width:40px;height:40px;border-radius:50%;flex-shrink:0;background:rgba(255,255,255,.07);display:flex;align-items:center;justify-content:center;transition:background .2s}
      .pump-icon svg{width:22px;height:22px;fill:var(--secondary-text-color,#94a3b8);transition:fill .2s}
      .pump-icon.active{background:rgba(56,189,248,.2)}
      .pump-icon.active svg{fill:var(--primary-color,#38bdf8)}
      .sched-icon{width:40px;height:40px;border-radius:50%;flex-shrink:0;background:rgba(56,189,248,.15);display:flex;align-items:center;justify-content:center}
      .sched-icon svg{width:22px;height:22px;fill:var(--primary-color,#38bdf8)}
      .badge{font-size:10px;font-weight:700;letter-spacing:.06em;padding:3px 8px;border-radius:99px;flex-shrink:0}
      .state-badge.on{background:rgba(56,189,248,.15);color:var(--primary-color,#38bdf8)}
      .state-badge.off,.state-badge.unknown{background:rgba(255,255,255,.07);color:var(--secondary-text-color,#94a3b8)}
      .toggle{width:50px;height:28px;border-radius:14px;flex-shrink:0;background:rgba(255,255,255,.14);border:none;cursor:pointer;outline:none;position:relative;transition:background .2s}
      .toggle::after{content:'';position:absolute;width:22px;height:22px;border-radius:50%;background:#fff;top:3px;left:3px;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.4)}
      .toggle.on{background:var(--primary-color,#38bdf8)}
      .toggle.on::after{transform:translateX(22px)}
      .icon-btn{background:none;border:none;cursor:pointer;outline:none;padding:8px;border-radius:50%;flex-shrink:0;color:var(--secondary-text-color,#94a3b8);transition:background .15s,color .15s}
      .icon-btn:hover{background:rgba(255,255,255,.07);color:#ef4444}
      .icon-btn svg{width:20px;height:20px;fill:currentColor;display:block}
      .add-btn{display:inline-flex;align-items:center;gap:8px;margin-bottom:20px}
      .btn-primary{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:8px;background:var(--primary-color,#38bdf8);color:#0f172a;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s}
      .btn-primary:hover{opacity:.85}
      .btn-primary svg{width:18px;height:18px;fill:#0f172a}
      .btn-secondary{padding:9px 18px;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:none;color:var(--secondary-text-color,#94a3b8);font-size:13px;cursor:pointer;transition:background .15s}
      .btn-secondary:hover{background:rgba(255,255,255,.06)}
      .form-card{background:var(--card-background-color,#1e293b);border-radius:14px;padding:20px;margin-bottom:20px;border:1px solid rgba(255,255,255,.07)}
      .form-title{font-size:16px;font-weight:600;margin-bottom:18px}
      .field{margin-bottom:14px}
      .field label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--secondary-text-color,#94a3b8);margin-bottom:6px}
      .field input,.field select{width:100%;padding:10px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--primary-text-color,#f1f5f9);font-size:14px;outline:none;transition:border-color .15s}
      .field input:focus,.field select:focus{border-color:var(--primary-color,#38bdf8)}
      .field select option{background:#1e293b}
      .day-picker{display:flex;gap:8px;flex-wrap:wrap}
      .day-btn{width:42px;height:42px;border-radius:50%;border:2px solid rgba(255,255,255,.12);background:none;color:var(--primary-text-color,#f1f5f9);font-size:11px;font-weight:700;cursor:pointer;transition:all .15s}
      .day-btn:hover{border-color:var(--primary-color,#38bdf8)}
      .day-btn.sel{background:var(--primary-color,#38bdf8);border-color:var(--primary-color,#38bdf8);color:#0f172a}
      .day-chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
      .day-chip{padding:2px 7px;border-radius:99px;background:rgba(56,189,248,.15);color:var(--primary-color,#38bdf8);font-size:10px;font-weight:700}
      .form-actions{display:flex;gap:10px;margin-top:20px;justify-content:flex-end}
      .empty{display:flex;flex-direction:column;align-items:center;padding:56px 24px;color:var(--secondary-text-color,#94a3b8);text-align:center}
      .empty svg{width:56px;height:56px;fill:currentColor;opacity:.25;margin-bottom:16px}
      .empty p{font-size:15px}
      .spinner{width:36px;height:36px;border-radius:50%;border:3px solid rgba(255,255,255,.1);border-top-color:var(--primary-color,#38bdf8);animation:spin .7s linear infinite;margin-bottom:14px}
      @keyframes spin{to{transform:rotate(360deg)}}
    </style>`;
  }
}

customElements.define('domuse-irrigation-panel', DomIrrigationPanel);