import { GraphRenderer, PROFILE_DASH_PATTERNS } from "./graph-renderer.js";
import { ProfileManager } from "./profile-manager.js";
import { generateCLI, parseAllRateProfiles, parseCLI } from "./cli-parser.js";
import { normalizeLimitPercent, normalizeLimitType } from "./rate-calculator.js";

/** Maximum number of simultaneous profiles. */
const MAX_PROFILES = 5;

/** Single-letter labels for profiles 0-4. */
const PROFILE_LABELS = ["A", "B", "C", "D", "E"];

/**
 * Main application controller
 */
class RateProfileComparison {
  constructor() {
    this.profileManager = new ProfileManager();
    this.graphRenderer = new GraphRenderer(
      document.getElementById("rate-canvas"),
      document.getElementById("throttle-canvas"),
    );

    // Side-by-side renderers — rebuilt when entering that view mode
    this.sideRenderers = [];

    // View mode
    this.viewMode = "overlay"; // 'overlay' or 'sidebyside'
    this.minWidthForSideBySide = 1400;

    // Profiles array (2 by default, up to MAX_PROFILES)
    this.profiles = [
      this.createDefaultProfile("Profile A"),
      this.createDefaultProfile("Profile B"),
    ];

    // Per-slot visibility (parallel to profiles array; extra slots stay true for
    // freshly-added profiles)
    this.profileVisibility = [true, true, true, true, true];

    // Auto-save debounce timer
    this.autoSaveTimer = null;
    this.autoSaveDelay = 2000;

    // Build dynamic DOM, then wire everything up
    this.buildProfileEditors();
    this.buildProfileVisibilityToggles();
    this.initializeControls();
    this.initializeVisibilityToggles();
    this.initializeViewMode();
    this.initializeHistory();
    this.initializeGraphCollapse();

    this.checkViewportWidth();
    window.addEventListener("resize", () => this.checkViewportWidth());

    this.initializeBulkImport();

    this.updateLegend();
    this.updateGraphs();
    this.updateExports();
    this.renderHistory();
  }

  // ---------------------------------------------------------------------------
  // Profile creation
  // ---------------------------------------------------------------------------

  createDefaultProfile(name) {
    return {
      name,
      ratesType: "ACTUAL",
      rates: {
        roll: { center: 70, maxRate: 670, expo: 0 },
        pitch: { center: 70, maxRate: 670, expo: 0 },
        yaw: { center: 70, maxRate: 670, expo: 0 },
      },
      throttle: {
        mid: 50,
        expo: 0,
        limitType: "OFF",
        limitPercent: 100,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Dynamic DOM construction
  // ---------------------------------------------------------------------------

  /** Rebuild the entire editors section from this.profiles. */
  buildProfileEditors() {
    const section = document.getElementById("editors-section");
    section.innerHTML = "";
    this.profiles.forEach((_, i) => {
      section.appendChild(this.createProfileEditorDOM(i));
    });
    this.updateAddProfileButton();
  }

  /** Synchronize the "Add Profile" button presence and label. */
  updateAddProfileButton() {
    const existing = document.getElementById("add-profile-btn");
    if (existing) existing.remove();

    if (this.profiles.length < MAX_PROFILES) {
      const btn = document.createElement("button");
      btn.id = "add-profile-btn";
      btn.className = "btn btn-secondary add-profile-btn";
      btn.textContent = `+ Add Profile (${this.profiles.length} / ${MAX_PROFILES})`;
      btn.addEventListener("click", () => this.addProfile());
      document.getElementById("editors-section").appendChild(btn);
    }
  }

  /** Create the DOM element for one profile editor (not yet wired up). */
  createProfileEditorDOM(i) {
    const label = PROFILE_LABELS[i];
    const profile = this.profiles[i];
    const div = document.createElement("div");
    div.className = "profile-editor";
    div.dataset.profileIndex = i;

    const canRemove = i >= 2;
    div.innerHTML = `
      <div class="editor-header">
        <h2>Profile ${label}</h2>
        <div class="profile-actions">
          <input type="text" id="profile-${i}-name"
                 placeholder="Profile Name" class="profile-name-input">
          <button id="save-profile-${i}" class="btn btn-primary">Save</button>
          ${canRemove ? `<button id="remove-profile-${i}" class="btn btn-danger btn-small" aria-label="Remove Profile ${label}">✕</button>` : ""}
        </div>
      </div>

      <div class="controls-grid">
        ${["roll", "pitch", "yaw"]
          .map(
            (axis) => `
          <div class="control-section">
            <h3 class="${axis}-heading">${axis.charAt(0).toUpperCase() + axis.slice(1)}</h3>
            <div class="control-item">
              <label for="${i}-${axis}-center">Center (0-255):</label>
              <input type="range" id="${i}-${axis}-center"
                     min="0" max="255" step="1"
                     value="${profile.rates[axis].center}">
              <span id="${i}-${axis}-center-value" class="value-display">${profile.rates[axis].center}</span>
            </div>
            <div class="control-item">
              <label for="${i}-${axis}-max">Max Rate (deg/s):</label>
              <input type="range" id="${i}-${axis}-max"
                     min="200" max="2000" step="10"
                     value="${profile.rates[axis].maxRate}">
              <span id="${i}-${axis}-max-value" class="value-display">${profile.rates[axis].maxRate}</span>
            </div>
            <div class="control-item">
              <label for="${i}-${axis}-expo">Expo (0-100):</label>
              <input type="range" id="${i}-${axis}-expo"
                     min="0" max="100" step="1"
                     value="${profile.rates[axis].expo}">
              <span id="${i}-${axis}-expo-value" class="value-display">${profile.rates[axis].expo}</span>
            </div>
          </div>`,
          )
          .join("")}

        <div class="control-section">
          <h3>Throttle</h3>
          <div class="control-item">
            <label for="${i}-throttle-mid">Mid Point (0-100):</label>
            <input type="range" id="${i}-throttle-mid"
                   min="0" max="100" step="1"
                   value="${profile.throttle.mid}">
            <span id="${i}-throttle-mid-value" class="value-display">${profile.throttle.mid}</span>
          </div>
          <div class="control-item">
            <label for="${i}-throttle-expo">Expo (0-100):</label>
            <input type="range" id="${i}-throttle-expo"
                   min="0" max="100" step="1"
                   value="${profile.throttle.expo}">
            <span id="${i}-throttle-expo-value" class="value-display">${profile.throttle.expo}</span>
          </div>
          <div class="control-item">
            <label for="${i}-throttle-limit-type">Limit Type:</label>
            <select id="${i}-throttle-limit-type" class="select-input">
              <option value="OFF"${profile.throttle.limitType === "OFF" ? " selected" : ""}>Off</option>
              <option value="SCALE"${profile.throttle.limitType === "SCALE" ? " selected" : ""}>Scale</option>
              <option value="CLIP"${profile.throttle.limitType === "CLIP" ? " selected" : ""}>Clip</option>
            </select>
          </div>
          <div class="control-item">
            <label for="${i}-throttle-limit-percent">Limit Percent (25-100):</label>
            <input type="range" id="${i}-throttle-limit-percent"
                   min="25" max="100" step="1"
                   value="${profile.throttle.limitPercent}">
            <span id="${i}-throttle-limit-percent-value" class="value-display">${profile.throttle.limitPercent}</span>
          </div>
        </div>
      </div>

      <div class="cli-section">
        <div class="cli-import">
          <h3>Import from CLI</h3>
          <textarea id="import-${i}" placeholder="Paste Betaflight CLI dump here…" rows="4"></textarea>
          <button id="import-btn-${i}" class="btn btn-secondary">Import</button>
          <span id="import-status-${i}" class="status-message"></span>
        </div>
        <div class="cli-export">
          <h3>Export to CLI</h3>
          <textarea id="export-${i}" readonly rows="4"></textarea>
          <button id="copy-btn-${i}" class="btn btn-secondary">Copy</button>
          <span id="export-status-${i}" class="status-message"></span>
        </div>
      </div>
    `;

    // Set the name value via DOM to avoid quote-injection through innerHTML attribute context.
    div.querySelector(`#profile-${i}-name`).value = profile.name;

    return div;
  }

  /** Attach all event listeners for profile slot i. */
  wireProfileEditor(i) {
    const profileObj = this.profiles[i];
    const axes = ["roll", "pitch", "yaw"];

    axes.forEach((axis) => {
      const centerInput = document.getElementById(`${i}-${axis}-center`);
      const centerValue = document.getElementById(`${i}-${axis}-center-value`);
      centerInput.addEventListener("input", (e) => {
        profileObj.rates[axis].center = parseInt(e.target.value);
        centerValue.textContent = e.target.value;
        this.onProfileChange();
      });

      const maxInput = document.getElementById(`${i}-${axis}-max`);
      const maxValue = document.getElementById(`${i}-${axis}-max-value`);
      maxInput.addEventListener("input", (e) => {
        profileObj.rates[axis].maxRate = parseInt(e.target.value);
        maxValue.textContent = e.target.value;
        this.onProfileChange();
      });

      const expoInput = document.getElementById(`${i}-${axis}-expo`);
      const expoValue = document.getElementById(`${i}-${axis}-expo-value`);
      expoInput.addEventListener("input", (e) => {
        profileObj.rates[axis].expo = parseInt(e.target.value);
        expoValue.textContent = e.target.value;
        this.onProfileChange();
      });
    });

    const throttleMidInput = document.getElementById(`${i}-throttle-mid`);
    const throttleMidValue = document.getElementById(`${i}-throttle-mid-value`);
    throttleMidInput.addEventListener("input", (e) => {
      profileObj.throttle.mid = parseInt(e.target.value);
      throttleMidValue.textContent = e.target.value;
      this.onProfileChange();
    });

    const throttleExpoInput = document.getElementById(`${i}-throttle-expo`);
    const throttleExpoValue = document.getElementById(`${i}-throttle-expo-value`);
    throttleExpoInput.addEventListener("input", (e) => {
      profileObj.throttle.expo = parseInt(e.target.value);
      throttleExpoValue.textContent = e.target.value;
      this.onProfileChange();
    });

    const limitTypeInput = document.getElementById(`${i}-throttle-limit-type`);
    limitTypeInput.addEventListener("change", (e) => {
      profileObj.throttle.limitType = e.target.value;
      this.onProfileChange();
    });

    const limitPercentInput = document.getElementById(`${i}-throttle-limit-percent`);
    const limitPercentValue = document.getElementById(`${i}-throttle-limit-percent-value`);
    limitPercentInput.addEventListener("input", (e) => {
      profileObj.throttle.limitPercent = parseInt(e.target.value);
      limitPercentValue.textContent = e.target.value;
      this.onProfileChange();
    });

    document.getElementById(`import-btn-${i}`).addEventListener("click", () => {
      this.importProfile(i);
    });
    document.getElementById(`copy-btn-${i}`).addEventListener("click", () => {
      this.copyExport(i);
    });
    document.getElementById(`save-profile-${i}`).addEventListener("click", () => {
      this.saveProfile(i);
    });
    document.getElementById(`profile-${i}-name`).addEventListener("input", (e) => {
      this.profiles[i].name = e.target.value || `Profile ${PROFILE_LABELS[i]}`;
      this.updateExports();
    });

    const removeBtn = document.getElementById(`remove-profile-${i}`);
    if (removeBtn) {
      removeBtn.addEventListener("click", () => this.removeProfile(i));
    }
  }

  /** Wire all profile editors (called after buildProfileEditors). */
  initializeControls() {
    this.profiles.forEach((_, i) => this.wireProfileEditor(i));
  }

  // ---------------------------------------------------------------------------
  // Visibility toggles
  // ---------------------------------------------------------------------------

  /** Rebuild the profile-visibility toggle row from this.profiles. */
  buildProfileVisibilityToggles() {
    const container = document.getElementById("profile-visibility-toggles");
    container.innerHTML = "";
    this.profiles.forEach((_, i) => {
      container.appendChild(this.createProfileToggleDOM(i));
    });
  }

  /** Create a single profile-visibility toggle label element. */
  createProfileToggleDOM(i) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `toggle-profile-${i}`;
    checkbox.checked = this.profileVisibility[i] !== false;

    const lineSpan = document.createElement("span");
    lineSpan.className = "profile-line-indicator";
    lineSpan.setAttribute("aria-hidden", "true");
    lineSpan.dataset.profileIndex = i;
    lineSpan.innerHTML = this.dashPatternSVG(PROFILE_DASH_PATTERNS[i] ?? []);

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` Profile ${PROFILE_LABELS[i]} `));
    label.appendChild(lineSpan);
    return label;
  }

  /** Wire axis + profile visibility checkboxes. */
  initializeVisibilityToggles() {
    // Profile toggles (dynamic, re-wired after rebuild)
    this.profiles.forEach((_, i) => {
      const el = document.getElementById(`toggle-profile-${i}`);
      if (!el) return;
      el.addEventListener("change", (e) => {
        this.profileVisibility[i] = e.target.checked;
        this.syncRendererVisibility();
        this.updateGraphs();
      });
    });

    // Axis toggles (static)
    document.getElementById("toggle-roll").addEventListener("change", (e) => {
      this.graphRenderer.setVisibility({ roll: e.target.checked });
      this.updateGraphs();
    });
    document.getElementById("toggle-pitch").addEventListener("change", (e) => {
      this.graphRenderer.setVisibility({ pitch: e.target.checked });
      this.updateGraphs();
    });
    document.getElementById("toggle-yaw").addEventListener("change", (e) => {
      this.graphRenderer.setVisibility({ yaw: e.target.checked });
      this.updateGraphs();
    });
  }

  /** Push current profileVisibility state into the graph renderer. */
  syncRendererVisibility() {
    this.graphRenderer.setVisibility({ profiles: [...this.profileVisibility] });
    this.sideRenderers.forEach((renderer, i) => {
      // Each side renderer shows exactly one profile — always visible
      renderer.setVisibility({ profiles: [true] });
    });
  }

  // ---------------------------------------------------------------------------
  // Add / Remove profiles
  // ---------------------------------------------------------------------------

  addProfile() {
    if (this.profiles.length >= MAX_PROFILES) return;
    const i = this.profiles.length;
    this.profiles.push(this.createDefaultProfile(`Profile ${PROFILE_LABELS[i]}`));
    this.profileVisibility[i] = true;

    // Add editor DOM
    const section = document.getElementById("editors-section");
    const addBtn = document.getElementById("add-profile-btn");
    const editorEl = this.createProfileEditorDOM(i);
    section.insertBefore(editorEl, addBtn || null);
    this.wireProfileEditor(i);

    // Add visibility toggle
    const toggleContainer = document.getElementById("profile-visibility-toggles");
    toggleContainer.appendChild(this.createProfileToggleDOM(i));
    document.getElementById(`toggle-profile-${i}`).addEventListener("change", (e) => {
      this.profileVisibility[i] = e.target.checked;
      this.syncRendererVisibility();
      this.updateGraphs();
    });

    this.syncRendererVisibility();
    this.updateAddProfileButton();
    this.updateLegend();

    // Rebuild side-by-side if active
    if (this.viewMode === "sidebyside") this.rebuildSideBySide();

    this.updateGraphs();
    this.updateExports();
    this.renderHistory();
  }

  removeProfile(i) {
    if (i < 2 || this.profiles.length <= 2) return; // A and B are permanent
    this.profiles.splice(i, 1);
    this.profileVisibility.splice(i, 1); // keep parallel array in sync
    // Rebuild everything — simpler than partial DOM surgery
    this.rebuild();
  }

  /**
   * Full DOM rebuild after structural changes (e.g. removeProfile).
   * Preserves profile data already in this.profiles.
   */
  rebuild() {
    this.buildProfileEditors();
    this.buildProfileVisibilityToggles();
    this.initializeControls();
    this.initializeVisibilityToggles();
    this.syncRendererVisibility();
    this.updateLegend();

    if (this.viewMode === "sidebyside") this.rebuildSideBySide();

    this.updateGraphs();
    this.updateExports();
    this.renderHistory();
  }

  // ---------------------------------------------------------------------------
  // View mode
  // ---------------------------------------------------------------------------

  initializeViewMode() {
    document.getElementById("view-mode-overlay").addEventListener("change", (e) => {
      if (e.target.checked) this.setViewMode("overlay");
    });
    document.getElementById("view-mode-sidebyside").addEventListener("change", (e) => {
      if (e.target.checked) this.setViewMode("sidebyside");
    });
  }

  checkViewportWidth() {
    const width = window.innerWidth;
    const viewModeControl = document.getElementById("view-mode-control");
    if (width >= this.minWidthForSideBySide) {
      viewModeControl.style.display = "";
    } else {
      viewModeControl.style.display = "none";
      if (this.viewMode === "sidebyside") {
        document.getElementById("view-mode-overlay").checked = true;
        this.setViewMode("overlay");
      }
    }
  }

  setViewMode(mode) {
    this.viewMode = mode;
    const overlayContainer = document.getElementById("graphs-overlay");
    const sideBySideContainer = document.getElementById("graphs-sidebyside");

    if (mode === "overlay") {
      overlayContainer.style.display = "";
      sideBySideContainer.style.display = "none";
    } else {
      overlayContainer.style.display = "none";
      sideBySideContainer.style.display = "";
      this.rebuildSideBySide();
    }

    this.updateGraphs();
  }

  /**
   * Dynamically populate the side-by-side container with one column per profile.
   */
  rebuildSideBySide() {
    const container = document.getElementById("graphs-sidebyside");
    container.innerHTML = "";
    container.style.gridTemplateColumns = `repeat(${this.profiles.length}, minmax(350px, 1fr))`;
    this.sideRenderers = [];

    this.profiles.forEach((_, i) => {
      const label = PROFILE_LABELS[i];
      const col = document.createElement("div");
      col.className = "profile-graphs";
      col.innerHTML = `
        <h2>Profile ${label}</h2>
        <div class="graph-panel">
          <h3 class="graph-panel-heading">
            <button type="button" class="graph-panel-header" aria-expanded="true">
              <span>Rate Curves</span>
              <span class="graph-panel-chevron" aria-hidden="true">▾</span>
            </button>
          </h3>
          <div class="graph-panel-body">
            <canvas id="rate-canvas-sbs-${i}" width="700" height="400"></canvas>
          </div>
        </div>
        <div class="graph-panel">
          <h3 class="graph-panel-heading">
            <button type="button" class="graph-panel-header" aria-expanded="true">
              <span>Throttle Curve</span>
              <span class="graph-panel-chevron" aria-hidden="true">▾</span>
            </button>
          </h3>
          <div class="graph-panel-body">
            <canvas id="throttle-canvas-sbs-${i}" width="700" height="400"></canvas>
          </div>
        </div>
      `;
      container.appendChild(col);

      const renderer = new GraphRenderer(
        document.getElementById(`rate-canvas-sbs-${i}`),
        document.getElementById(`throttle-canvas-sbs-${i}`),
      );
      // Side-by-side shows one profile at full curves — always visible
      renderer.setVisibility({ profiles: [true], roll: true, pitch: true, yaw: true });
      this.sideRenderers.push(renderer);

      // Wire collapse behaviour for dynamically-created panels
      col.querySelectorAll(".graph-panel").forEach((panel) => {
        const header = panel.querySelector(".graph-panel-header");
        if (!header) return;
        header.setAttribute("aria-expanded", "true");
        header.addEventListener("click", () => {
          const collapsed = panel.classList.toggle("collapsed");
          header.setAttribute("aria-expanded", String(!collapsed));
          if (!collapsed) this.updateGraphs();
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Legend
  // ---------------------------------------------------------------------------

  /** Rebuild the dynamic profile-line portion of the rate-graph legend. */
  updateLegend() {
    const legendContainer = document.getElementById("rate-graph-profile-legend");
    const throttleLegendContainer = document.getElementById("throttle-graph-profile-legend");
    if (!legendContainer) return;

    legendContainer.innerHTML = this.profiles
      .map((_, i) => {
        const label = PROFILE_LABELS[i];
        const dash = PROFILE_DASH_PATTERNS[i] ?? [];
        return `<span class="legend-item">
          ${this.dashPatternSVG(dash)}
          Profile ${label}
        </span>`;
      })
      .join("");

    if (throttleLegendContainer) {
      throttleLegendContainer.innerHTML = this.profiles
        .map((_, i) => {
          const label = PROFILE_LABELS[i];
          const dash = PROFILE_DASH_PATTERNS[i] ?? [];
          return `<span class="legend-item">
            ${this.dashPatternSVG(dash, "#00aaff")}
            Profile ${label}
          </span>`;
        })
        .join("");
    }
  }

  /** Return an inline SVG showing the given dash pattern. */
  dashPatternSVG(dashPattern, color = "var(--text-secondary)") {
    const dashAttr = dashPattern.length ? dashPattern.join(",") : "none";
    return `<svg width="30" height="6" viewBox="0 0 30 6" aria-hidden="true" style="vertical-align:middle">
      <line x1="0" y1="3" x2="30" y2="3"
            stroke="${color}" stroke-width="3"
            stroke-dasharray="${dashAttr}"/>
    </svg>`;
  }

  // ---------------------------------------------------------------------------
  // Collapse
  // ---------------------------------------------------------------------------

  initializeGraphCollapse() {
    this.collapseStorageKey = "fpv-rate-graph-collapsed";
    const stored = this.loadCollapsedState();

    document.querySelectorAll(".graph-panel[data-collapse-key]").forEach((panel) => {
      const key = panel.dataset.collapseKey;
      if (stored[key]) panel.classList.add("collapsed");
      const header = panel.querySelector(".graph-panel-header");
      if (!header) return;
      header.setAttribute("aria-expanded", String(!panel.classList.contains("collapsed")));
      header.addEventListener("click", () => {
        const collapsed = panel.classList.toggle("collapsed");
        header.setAttribute("aria-expanded", String(!collapsed));
        this.saveCollapsedState(key, collapsed);
        if (!collapsed) this.updateGraphs();
      });
    });
  }

  loadCollapsedState() {
    try {
      const raw = localStorage.getItem(this.collapseStorageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      return {};
    } catch {
      return {};
    }
  }

  saveCollapsedState(key, collapsed) {
    try {
      const state = this.loadCollapsedState();
      if (collapsed) {
        state[key] = true;
      } else {
        delete state[key];
      }
      localStorage.setItem(this.collapseStorageKey, JSON.stringify(state));
    } catch {
      // Ignore quota / privacy-mode errors
    }
  }

  // ---------------------------------------------------------------------------
  // Graph + export updates
  // ---------------------------------------------------------------------------

  onProfileChange() {
    this.updateGraphs();
    this.updateExports();

    clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      this.profiles.forEach((profile, i) => {
        const defaultName = `Profile ${PROFILE_LABELS[i]}`;
        if (profile.name && profile.name !== defaultName) {
          this.profileManager.saveProfile({ ...profile });
        }
      });
      this.renderHistory();
    }, this.autoSaveDelay);
  }

  updateGraphs() {
    if (this.viewMode === "overlay") {
      this.graphRenderer.render(this.profiles);
    } else {
      // Each side-by-side renderer shows exactly one profile
      this.sideRenderers.forEach((renderer, i) => {
        if (this.profiles[i]) renderer.render([this.profiles[i]]);
      });
    }
  }

  updateExports() {
    this.profiles.forEach((profile, i) => {
      const el = document.getElementById(`export-${i}`);
      if (el) el.value = generateCLI(profile);
    });
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  /**
   * Apply a flat CLI settings map to a profile object in-place.
   *
   * @param {Object} settings - Key-value map from parseCLI / parseAllRateProfiles
   * @param {Object} profileObj - Profile object to mutate
   * @returns {{ ratesType: string, count: number }|null} Detected type + applied
   *   count on success, or null when the rates_type is unsupported.
   */
  _applySettingsToProfile(settings, profileObj) {
    const detectedType = (settings.rates_type || "").trim().toUpperCase();
    let ratesType = "ACTUAL";
    if (detectedType === "BETAFLIGHT") {
      ratesType = "BETAFLIGHT";
    } else if (detectedType && detectedType !== "ACTUAL") {
      return null; // unsupported type
    }
    profileObj.ratesType = ratesType;

    const mapping = Object.create(null);
    mapping.roll_rc_rate = (v) => { profileObj.rates.roll.center = parseInt(v); };
    mapping.pitch_rc_rate = (v) => { profileObj.rates.pitch.center = parseInt(v); };
    mapping.yaw_rc_rate = (v) => { profileObj.rates.yaw.center = parseInt(v); };
    mapping.roll_expo = (v) => { profileObj.rates.roll.expo = parseInt(v); };
    mapping.pitch_expo = (v) => { profileObj.rates.pitch.expo = parseInt(v); };
    mapping.yaw_expo = (v) => { profileObj.rates.yaw.expo = parseInt(v); };
    mapping.thr_mid = (v) => { profileObj.throttle.mid = parseInt(v); };
    mapping.thr_expo = (v) => { profileObj.throttle.expo = parseInt(v); };
    mapping.throttle_limit_type = (v) => { profileObj.throttle.limitType = normalizeLimitType(v); };
    mapping.throttle_limit_percent = (v) => {
      profileObj.throttle.limitPercent = normalizeLimitPercent(v);
    };
    // Both ACTUAL and BETAFLIGHT use `*_srate` for the second rate parameter.
    // Old firmware / hand-edited dumps may use bare `*_rate`; map it first so
    // that `*_srate` (defined last) wins when both keys appear.
    //   ACTUAL     → roll_srate = max rate in deg/s (200-2000)
    //   BETAFLIGHT → roll_srate = super rate percentage (0-100)
    mapping.roll_rate = (v) => { profileObj.rates.roll.maxRate = parseInt(v); };
    mapping.pitch_rate = (v) => { profileObj.rates.pitch.maxRate = parseInt(v); };
    mapping.yaw_rate = (v) => { profileObj.rates.yaw.maxRate = parseInt(v); };
    mapping.roll_srate = (v) => { profileObj.rates.roll.maxRate = parseInt(v); };
    mapping.pitch_srate = (v) => { profileObj.rates.pitch.maxRate = parseInt(v); };
    mapping.yaw_srate = (v) => { profileObj.rates.yaw.maxRate = parseInt(v); };

    let count = 0;
    for (const [key, handler] of Object.entries(mapping)) {
      if (settings[key] !== undefined) { handler(settings[key]); count++; }
    }
    return { ratesType, count };
  }

  importProfile(i) {
    const textarea = document.getElementById(`import-${i}`);
    const statusSpan = document.getElementById(`import-status-${i}`);
    const text = textarea.value;

    if (!text.trim()) {
      this.showStatus(statusSpan, "Please paste CLI dump text first.", "error");
      return;
    }

    try {
      const settings = parseCLI(text);
      const profileObj = this.profiles[i];

      const result = this._applySettingsToProfile(settings, profileObj);
      if (result === null) {
        const detectedType = (settings.rates_type || "").trim().toUpperCase();
        this.showStatus(
          statusSpan,
          `Import stopped: ${detectedType} rates are not yet supported. ` +
            `Switch to ACTUAL or BETAFLIGHT in Betaflight Configurator first (Rates tab → Type).`,
          "error",
        );
        return;
      }

      this.updateUIFromProfile(i, profileObj);
      this.updateGraphs();
      this.updateExports();

      if (result.count === 0) {
        this.showStatus(
          statusSpan,
          "No recognised rate settings found — check the pasted text.",
          "error",
        );
      } else {
        textarea.value = "";
        this.showStatus(
          statusSpan,
          `Imported ${result.count} settings (${result.ratesType})`,
          "success",
        );
      }
    } catch (error) {
      this.showStatus(statusSpan, `Import failed: ${error.message}`, "error");
    }
  }

  /** Wire up the bulk-import UI section. */
  initializeBulkImport() {
    const btn = document.getElementById("bulk-import-btn");
    if (!btn) return;
    btn.addEventListener("click", () => this.bulkImportFromCLI());
  }

  /**
   * Parse a full CLI dump and replace the current profiles with one profile
   * per rateprofile section found (capped at MAX_PROFILES, minimum 2).
   */
  bulkImportFromCLI() {
    const textarea = document.getElementById("bulk-import-textarea");
    const statusSpan = document.getElementById("bulk-import-status");
    const text = textarea.value;

    if (!text.trim()) {
      this.showStatus(statusSpan, "Please paste a CLI dump first.", "error");
      return;
    }

    const parsed = parseAllRateProfiles(text);
    if (parsed.length === 0) {
      this.showStatus(
        statusSpan,
        "No rateprofile sections found — paste a full 'dump rates' or 'diff all' output.",
        "error",
      );
      return;
    }

    const capped = parsed.slice(0, MAX_PROFILES);
    const skipped = parsed.length - capped.length;

    // Build new profiles array (minimum 2 for the UI's A/B assumption).
    // Skip sections with unsupported rates_type and surface an error immediately.
    const newProfiles = [];
    for (let idx = 0; idx < capped.length; idx++) {
      const settings = capped[idx];
      const profileObj = this.createDefaultProfile(`Rateprofile ${idx}`);
      const result = this._applySettingsToProfile(settings, profileObj);
      if (result === null) {
        const detectedType = (settings.rates_type || "").trim().toUpperCase();
        this.showStatus(
          statusSpan,
          `Rateprofile ${idx} uses unsupported type "${detectedType}" — import stopped. ` +
            `Switch to ACTUAL or BETAFLIGHT in Betaflight Configurator (Rates tab → Type).`,
          "error",
        );
        return;
      }
      newProfiles.push(profileObj);
    }

    // Pad to at least 2 if only 1 rateprofile found
    while (newProfiles.length < 2) {
      newProfiles.push(this.createDefaultProfile(`Profile ${PROFILE_LABELS[newProfiles.length]}`));
    }

    this.profiles = newProfiles;
    this.profileVisibility = newProfiles.map(() => true);

    this.rebuild();

    textarea.value = "";
    const noun = newProfiles.length === 1 ? "rateprofile" : "rateprofiles";
    let msg = `Loaded ${capped.length} ${noun} from dump.`;
    if (skipped > 0) msg += ` (${skipped} skipped — max ${MAX_PROFILES})`;
    this.showStatus(statusSpan, msg, "success");
  }

  updateUIFromProfile(i, profileObj) {
    const axes = ["roll", "pitch", "yaw"];
    const isBF = profileObj.ratesType === "BETAFLIGHT";

    axes.forEach((axis) => {
      const centerEl = document.getElementById(`${i}-${axis}-center`);
      if (centerEl) {
        centerEl.value = profileObj.rates[axis].center;
        document.getElementById(`${i}-${axis}-center-value`).textContent =
          profileObj.rates[axis].center;
      }
      const maxEl = document.getElementById(`${i}-${axis}-max`);
      if (maxEl) {
        // Set min/max before value so the browser doesn't clamp a 0-100 super_rate
        // against the ACTUAL default min of 200.
        maxEl.min = isBF ? "0" : "200";
        maxEl.max = isBF ? "100" : "2000";
        maxEl.step = isBF ? "1" : "10";
        maxEl.value = profileObj.rates[axis].maxRate;
        document.getElementById(`${i}-${axis}-max-value`).textContent =
          profileObj.rates[axis].maxRate;
        const maxLabel = document.querySelector(`label[for="${i}-${axis}-max"]`);
        if (maxLabel) {
          maxLabel.textContent = isBF ? "Super Rate (0-100):" : "Max Rate (deg/s):";
        }
      }
      const expoEl = document.getElementById(`${i}-${axis}-expo`);
      if (expoEl) {
        expoEl.value = profileObj.rates[axis].expo;
        document.getElementById(`${i}-${axis}-expo-value`).textContent =
          profileObj.rates[axis].expo;
      }
    });

    const midEl = document.getElementById(`${i}-throttle-mid`);
    if (midEl) {
      midEl.value = profileObj.throttle.mid;
      document.getElementById(`${i}-throttle-mid-value`).textContent = profileObj.throttle.mid;
    }
    const tExpoEl = document.getElementById(`${i}-throttle-expo`);
    if (tExpoEl) {
      tExpoEl.value = profileObj.throttle.expo;
      document.getElementById(`${i}-throttle-expo-value`).textContent = profileObj.throttle.expo;
    }
    const limitTypeEl = document.getElementById(`${i}-throttle-limit-type`);
    if (limitTypeEl) limitTypeEl.value = profileObj.throttle.limitType ?? "OFF";
    const limitPctEl = document.getElementById(`${i}-throttle-limit-percent`);
    if (limitPctEl) {
      const lp = profileObj.throttle.limitPercent ?? 100;
      limitPctEl.value = lp;
      document.getElementById(`${i}-throttle-limit-percent-value`).textContent = lp;
    }
  }

  // ---------------------------------------------------------------------------
  // Export / copy
  // ---------------------------------------------------------------------------

  async copyExport(i) {
    const textarea = document.getElementById(`export-${i}`);
    const statusSpan = document.getElementById(`export-status-${i}`);
    try {
      await navigator.clipboard.writeText(textarea.value);
      this.showStatus(statusSpan, "Copied to clipboard!", "success");
    } catch {
      textarea.select();
      document.execCommand("copy");
      this.showStatus(statusSpan, "Copied to clipboard!", "success");
    }
  }

  // ---------------------------------------------------------------------------
  // Save / History
  // ---------------------------------------------------------------------------

  saveProfile(i) {
    const profileObj = this.profiles[i];
    const nameInput = document.getElementById(`profile-${i}-name`);
    if (!nameInput.value.trim()) {
      alert("Please enter a profile name before saving.");
      nameInput.focus();
      return;
    }
    profileObj.name = nameInput.value;
    this.profileManager.saveProfile({ ...profileObj });
    this.renderHistory();
    const statusSpan = document.getElementById(`export-status-${i}`);
    this.showStatus(statusSpan, `Profile saved: ${profileObj.name}`, "success");
  }

  renderHistory() {
    const historyList = document.getElementById("history-list");
    const history = this.profileManager.getHistory();

    if (history.length === 0) {
      historyList.innerHTML =
        '<p class="empty-history">No saved profiles yet. Save a profile to start building your history.</p>';
      return;
    }

    // Build "Load to X" buttons for each active profile slot
    const loadButtons = this.profiles
      .map(
        (_, i) =>
          `<button class="btn btn-small load-to-profile" data-profile-index="${i}">
            Load to ${PROFILE_LABELS[i]}
          </button>`,
      )
      .join("");

    historyList.innerHTML = history
      .map(
        (profile, index) => `
      <div class="history-item" data-index="${index}">
        <div class="history-item-header">
          <h4>${this.escapeHtml(profile.name)}</h4>
          <span class="history-timestamp">${new Date(profile.timestamp).toLocaleString()}</span>
        </div>
        <div class="history-item-actions">
          ${loadButtons.replace(/data-profile-index="(\d+)"/g, (m, pi) => `${m} data-timestamp="${profile.timestamp}"`)}
          <button class="btn btn-small btn-danger delete-profile" data-timestamp="${profile.timestamp}">Delete</button>
        </div>
      </div>
    `,
      )
      .join("");

    historyList.querySelectorAll(".load-to-profile").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const profileIndex = parseInt(e.target.dataset.profileIndex);
        const timestamp = parseInt(e.target.dataset.timestamp);
        this.loadProfileTo(profileIndex, timestamp);
      });
    });

    historyList.querySelectorAll(".delete-profile").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const timestamp = parseInt(e.target.dataset.timestamp);
        if (confirm("Delete this profile from history?")) {
          this.profileManager.deleteProfile(timestamp);
          this.renderHistory();
        }
      });
    });
  }

  loadProfileTo(i, timestamp) {
    const history = this.profileManager.getHistory();
    const profile = history.find((p) => p.timestamp === timestamp);
    if (!profile) return;
    this.profiles[i] = { ...profile };
    this.updateUIFromProfile(i, this.profiles[i]);
    const nameInput = document.getElementById(`profile-${i}-name`);
    if (nameInput) nameInput.value = profile.name;
    this.updateGraphs();
    this.updateExports();
  }

  initializeHistory() {
    document.getElementById("export-history-btn").addEventListener("click", () => {
      this.exportHistory();
    });
    document.getElementById("import-history-btn").addEventListener("click", () => {
      document.getElementById("history-file-input").click();
    });
    document.getElementById("history-file-input").addEventListener("change", (e) => {
      this.importHistoryFromFile(e.target.files[0]);
    });
    document.getElementById("clear-history-btn").addEventListener("click", () => {
      if (confirm("Are you sure you want to clear all history? This cannot be undone.")) {
        this.profileManager.clearAll();
        this.renderHistory();
      }
    });
  }

  exportHistory() {
    const json = this.profileManager.exportHistory();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fpv-rate-profiles-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importHistoryFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        this.profileManager.importHistory(e.target.result);
        this.renderHistory();
        alert("History imported successfully!");
      } catch (error) {
        alert(`Import failed: ${error.message}`);
      }
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  showStatus(element, message, type) {
    element.textContent = message;
    element.className = `status-message ${type}`;
    setTimeout(() => {
      element.textContent = "";
      element.className = "status-message";
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new RateProfileComparison();
});
