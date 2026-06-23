const DOMAIN = 'domuse_irrigation';

class DomIrrigationCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass   = null;
    this._config = null;
    this._pumps  = null;
  }

  setConfig(config) {
    this._config = { title: 'Irrigation Control', ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._pumps === null) { this._loadPumps(); } else { this._updateStates(); }
  }

  getCardSize() { return Math.max(1, Math.ceil((this._pumps?.length ?? 1) / 2) + 1); }
  static getStubConfig() { return { title: 'Irrigation Control' }; }

  async _loadPumps() {
    try {
      const data = await this._hass.callWS({ type: \/get_config });
      this._pumps = data.pumps ?? [];
    } catch (e) {
      console.error('[domuse-irrigation-card] failed to load config', e);
      this._pumps = [];
    }
    this._render();
  }

  _state(entityId) { return this._hass?.states?.[entityId]?.state ?? 'unknown'; }

  async _toggle(entityId, currentState) {
    try {
      await this._hass.callWS({ type: \/toggle_pump, entity_id: entityId, state: currentState !== 'on' });
    } catch (e) { console.error('[domuse-irrigation-card] toggle failed', e); }
  }

  _updateStates() {
    const sr = this.shadowRoot;
    (this._pumps ?? []).forEach(pump => {
      const state  = this._state(pump.entity_id);
      const eid    = CSS.escape(pump.entity_id);
      const toggle = sr.querySelector(.pump-toggle[data-eid="\"]);
      const dot    = sr.querySelector(.state-dot[data-eid="\"]);
      const badge  = sr.querySelector(.state-label[data-eid="\"]);
      if (toggle) { toggle.classList.toggle('on', state === 'on'); toggle.dataset.state = state; }
      if (dot)    { dot.className = state-dot \; }
      if (badge)  { badge.textContent = state.toUpperCase(); badge.className = state-label \; }
    });
  }

  _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  _render() {
    const title = this._config?.title ?? 'Irrigation Control';
    const pumps = this._pumps;
    this.shadowRoot.innerHTML = 
      \
      <ha-card>
        <div class="card-header">
          <svg viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0E9CA5"/><path d="M50 12C32 42 24 54 24 66a26 26 0 1 0 52 0C76 54 68 42 50 12Z" fill="#fff"/><path d="M50 51L71 67 62 67 62 82 38 82 38 67 29 67Z" fill="#0E9CA5"/></svg>
          <span>\</span>
        </div>
        <div class="card-body">
          \
        </div>
      </ha-card>;
    this._bindEvents();
  }

  _htmlPump(pump) {
    const state = this._state(pump.entity_id);
    const eid   = this._esc(pump.entity_id);
    return 
      <div class="pump-row">
        <div class="pump-icon-wrap">
          <div class="state-dot \" data-eid="\"></div>
          <svg class="pump-svg" viewBox="0 0 24 24"><path d="M12 2c-5.33 4.55-8 8.48-8 11.8C4 18.78 7.8 22 12 22s8-3.22 8-8.2C20 10.48 17.33 6.55 12 2z"/></svg>
        </div>
        <div class="pump-info">
          <span class="pump-name">\</span>
          <span class="state-label \" data-eid="\">\</span>
        </div>
        <button class="pump-toggle \"
                data-eid="\" data-state="\"
                aria-label="Toggle \"></button>
      </div>;
  }

  _bindEvents() {
    this.shadowRoot.querySelectorAll('.pump-toggle').forEach(btn =>
      btn.addEventListener('click', () => this._toggle(btn.dataset.eid, btn.dataset.state)));
  }

  _css() {
    return <style>
      :host { display: block; }
      ha-card { padding: 0; overflow: hidden; }
      .card-header {
        display: flex; align-items: center; gap: 10px;
        padding: 14px 18px 10px;
        font-size: 17px; font-weight: 600;
        color: var(--primary-text-color);
        border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.08));
      }
      .card-header svg { width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0; }
      .card-body { padding: 8px 0; }
      .pump-row {
        display: flex; align-items: center; gap: 14px; padding: 12px 18px;
        transition: background .15s;
      }
      .pump-row:hover { background: var(--secondary-background-color, rgba(0,0,0,.03)); }
      .pump-icon-wrap { position: relative; flex-shrink: 0; }
      .pump-svg { width: 28px; height: 28px; fill: var(--secondary-text-color, #94a3b8); display: block; }
      .state-dot {
        position: absolute; top: -2px; right: -2px;
        width: 9px; height: 9px; border-radius: 50%;
        background: var(--secondary-text-color, #bdbdbd);
        border: 2px solid var(--card-background-color, #fff);
        transition: background .2s;
      }
      .state-dot.on { background: #0E9CA5; }
      .pump-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .pump-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--primary-text-color); }
      .state-label { font-size: 10px; font-weight: 700; letter-spacing: .06em; color: var(--secondary-text-color, #94a3b8); }
      .state-label.on { color: #0E9CA5; }
      .pump-toggle {
        width: 50px; height: 28px; border-radius: 14px; flex-shrink: 0;
        background: rgba(0,0,0,.12); border: none; cursor: pointer; outline: none;
        position: relative; transition: background .2s;
        -webkit-tap-highlight-color: transparent;
      }
      .pump-toggle::after {
        content: ''; position: absolute;
        width: 22px; height: 22px; border-radius: 50%; background: #fff;
        top: 3px; left: 3px; transition: transform .2s;
        box-shadow: 0 1px 4px rgba(0,0,0,.3);
      }
      .pump-toggle.on { background: #0E9CA5; }
      .pump-toggle.on::after { transform: translateX(22px); }
      .loading { display: flex; justify-content: center; padding: 24px; }
      .spinner {
        width: 28px; height: 28px; border-radius: 50%;
        border: 3px solid rgba(0,0,0,.1); border-top-color: #0E9CA5;
        animation: spin .7s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .empty { padding: 24px 18px; text-align: center; color: var(--secondary-text-color, #94a3b8); font-size: 13px; line-height: 1.6; }
    </style>;
  }
}

customElements.define('domuse-irrigation-card', DomIrrigationCard);
window.customCards = window.customCards ?? [];
window.customCards.push({
  type: 'domuse-irrigation-card',
  name: 'Irrigation Control Card',
  description: 'Manual pump toggle card for the Domuse Irrigation integration.',
  preview: false,
});