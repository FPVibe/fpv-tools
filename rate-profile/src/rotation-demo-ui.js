import { buildFlickTimeline, simulateRotation, stickAt } from "./rotation-demo.js";
import { RotationRenderer } from "./rotation-renderer.js";

/** Profile slot labels, parallel to the app's PROFILE_LABELS. */
const PROFILE_LABELS = ["A", "B", "C", "D", "E"];

/** Canvas colors for profile slots A-E, distinct on the dark background. */
const PROFILE_COLORS = ["#00aaff", "#ffd24d", "#9e7bb5", "#f08a3c", "#9ecae1"];

/** Axes the demo can spin. */
const AXES = ["roll", "pitch", "yaw"];

/** Rolling trail samples kept per profile (~2.5 s at 60 fps). */
const TRAIL_LENGTH = 150;

/** Scripted inputs: buildFlickTimeline params (seconds). */
const SCRIPT_PRESETS = [
  { key: "flick-50", label: "Flick 50%", params: { peak: 0.5, rise: 0.05, hold: 0.25, fall: 0.1 } },
  { key: "flick-100", label: "Flick 100%", params: { peak: 1, rise: 0.05, hold: 0.25, fall: 0.1 } },
  {
    key: "hold-1s",
    label: "Hold 1s @ 100%",
    params: { peak: 1, rise: 0.05, hold: 1.0, fall: 0.1 },
  },
];

/** localStorage key the app shares for collapsible-section state. */
const COLLAPSE_STORAGE_KEY = "fpv-rate-graph-collapsed";

/**
 * Controller for the rotation demo. Builds its DOM inside a container, runs a
 * requestAnimationFrame loop, and applies one stick input to every selected
 * profile at once — same input, different rates, watch the quads diverge.
 * Profiles are read live via profilesGetter() on each frame, so the app's
 * sliders update the demo instantly.
 */
export class RotationDemo {
  /**
   * @param {Object} opts
   * @param {HTMLElement} opts.container - Element to build the demo UI inside.
   * @param {() => Object[]} opts.profilesGetter - Returns the live profiles array.
   */
  constructor({ container, profilesGetter }) {
    if (!container) throw new Error("RotationDemo: container is required");
    if (typeof profilesGetter !== "function") {
      throw new Error("RotationDemo: profilesGetter must be a function");
    }
    this.container = container;
    this.profilesGetter = profilesGetter;

    // Simulation state.
    this.axis = "roll";
    this.running = false;
    this.elapsed = 0; // seconds since the last reset
    this.lastTimestamp = null;
    this.stick = 0; // stick applied this frame, -1..1
    this.prevStick = 0; // stick applied last frame (segment start)
    this.padActive = false; // pointer (or arrow key) is holding the stick
    this.padValue = 0;
    this.script = null; // { timeline, duration } while a scripted input plays
    this.scriptStart = 0; // this.elapsed when the script started
    this.trails = new Map(); // profile index -> recent angles
    this.lastAngle = new Map(); // profile index -> accumulated angle
    this.lastRate = new Map(); // profile index -> last computed rate
    this.selected = new Set([0, 1]); // default: first two profiles that exist
    this.builtProfileCount = 0;
    this.profileRefs = [];
    this.readoutKey = "";
    this.dirty = true;

    this.buildDOM();
    this.wireSectionCollapse();

    const profiles = this.profilesGetter() ?? [];
    this.syncProfiles(profiles, true);
    this.syncReadouts(profiles);
    this.rebuildFrames();

    this.rafId = requestAnimationFrame((timestamp) => this.tick(timestamp));
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  /** requestAnimationFrame step: advance time, simulate, and draw. */
  tick(timestamp) {
    if (this.lastTimestamp === null) this.lastTimestamp = timestamp;
    const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.05);
    this.lastTimestamp = timestamp;

    if (this.running) {
      this.elapsed += dt;
      this.updateStick();
      this.simulate(dt);
    }

    if (!this.running) {
      const profiles = this.profilesGetter() ?? [];
      if (this.syncProfiles(profiles)) this.rebuildFrames();
      this.syncReadouts(profiles);
    }

    if (this.running || this.dirty) {
      this.renderFrame();
      this.dirty = false;
    }

    this.rafId = requestAnimationFrame((ts) => this.tick(ts));
  }

  /**
   * Compute the stick to apply this frame. Scripted playback wins over the
   * pad; with neither active the stick rests at 0.
   */
  updateStick() {
    if (this.script) {
      const t = this.elapsed - this.scriptStart;
      if (t >= this.script.duration) {
        this.script = null;
        this.stick = 0;
      } else {
        this.stick = stickAt(this.script.timeline, t);
      }
    } else if (this.padActive) {
      this.stick = this.padValue;
    } else {
      this.stick = 0;
    }
  }

  /**
   * Advance every selected profile by this frame's stick segment.
   * @param {number} dt - Seconds elapsed this frame.
   */
  simulate(dt) {
    const profiles = this.profilesGetter() ?? [];
    this.syncProfiles(profiles);
    this.syncReadouts(profiles);

    const quads = [];
    const frames = [];
    profiles.forEach((profile, i) => {
      if (!profile || !this.selected.has(i)) return;
      const { angle, rate } = this.simulateProfile(profile, i, dt);
      this.lastAngle.set(i, angle);
      this.lastRate.set(i, rate);
      quads.push({ label: `Profile ${PROFILE_LABELS[i]}`, color: PROFILE_COLORS[i] });
      frames.push({
        angleDeg: angle,
        axis: this.axis,
        trail: this.pushTrail(i, angle),
        rate,
        stick: this.stick,
      });
      this.updateReadout(i, angle, rate);
    });
    this.prevStick = this.stick;
    this.lastQuads = quads;
    this.lastFrames = frames;
  }

  /**
   * Advance one profile's rotation by this frame's stick segment.
   *
   * The segment is zero-based ({0, prevStick} → {dt, stick}) and
   * simulateRotation integrates it at its internal step size; the returned
   * angle delta is accumulated onto the profile's running total, so live
   * slider edits apply instantly without rewriting past rotation.
   * @param {Object} profile
   * @param {number} i - Profile slot index.
   * @param {number} dt - Seconds elapsed this frame.
   * @returns {{angle: number, rate: number}}
   */
  simulateProfile(profile, i, dt) {
    // Fast path: the stick has rested at 0 and the last rate was 0 —
    // nothing can have moved, so skip simulating.
    if (
      this.prevStick === 0 && this.stick === 0 &&
      (this.lastRate.get(i) ?? -1) === 0
    ) {
      return { angle: this.lastAngle.get(i) ?? 0, rate: 0 };
    }

    const segment = [
      { t: 0, stick: this.prevStick },
      { t: dt, stick: this.stick },
    ];
    let delta = 0;
    let rate = 0;
    try {
      const sim = simulateRotation(profile, this.axis, segment, {
        duration: dt,
        dt: dt > 0 ? dt / Math.ceil(dt * 120) : 1 / 120,
      });
      delta = typeof sim.angle === "number" ? sim.angle : 0;
      const series = sim.series;
      const last = Array.isArray(series) ? series[series.length - 1] : null;
      if (last && typeof last.rate === "number") rate = last.rate;
    } catch {
      // Keep the demo loop alive if the simulation module hiccups.
    }
    return { angle: (this.lastAngle.get(i) ?? 0) + delta, rate };
  }

  /**
   * Record the latest angle on a profile's rolling trail.
   * @param {number} i - Profile slot index.
   * @param {number} angle
   * @returns {number[]} The profile's trail array (drawn by the renderer).
   */
  pushTrail(i, angle) {
    let trail = this.trails.get(i);
    if (!trail) {
      trail = [];
      this.trails.set(i, trail);
    }
    trail.push(angle);
    if (trail.length > TRAIL_LENGTH) trail.splice(0, trail.length - TRAIL_LENGTH);
    return trail;
  }

  /** Push the latest frames to the renderer. */
  renderFrame() {
    this.renderer.setQuads(this.lastQuads ?? []);
    this.renderer.draw(this.lastFrames ?? []);
  }

  /**
   * Rebuild lastQuads/lastFrames from the current selection without
   * simulating (used on selection changes and resets).
   */
  rebuildFrames() {
    const profiles = this.profilesGetter() ?? [];
    const quads = [];
    const frames = [];
    profiles.forEach((profile, i) => {
      if (!profile || !this.selected.has(i)) return;
      quads.push({ label: `Profile ${PROFILE_LABELS[i]}`, color: PROFILE_COLORS[i] });
      frames.push({
        angleDeg: this.lastAngle.get(i) ?? 0,
        axis: this.axis,
        trail: [],
        rate: 0,
        stick: 0,
      });
    });
    this.lastQuads = quads;
    this.lastFrames = frames;
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Playback control
  // ---------------------------------------------------------------------------

  /**
   * Start or pause the demo loop.
   * @param {boolean} running
   */
  setRunning(running) {
    this.running = running;
    if (this.playBtn) this.playBtn.textContent = running ? "Pause" : "Play";
    this.dirty = true;
  }

  /** Stop playback and return the demo to its initial state. */
  reset() {
    this.elapsed = 0;
    this.script = null;
    this.scriptStart = 0;
    this.stick = 0;
    this.prevStick = 0;
    this.padValue = 0;
    this.padActive = false;
    this.trails.clear();
    this.lastAngle.clear();
    this.lastRate.clear();
    this.updatePadKnob();
    this.setRunning(false);
    this.rebuildFrames();
    this.resetReadouts();
  }

  /**
   * Start a scripted input playing in real time from now.
   * @param {{key: string, label: string, params: Object}} preset
   */
  playScript(preset) {
    let timeline;
    try {
      timeline = buildFlickTimeline(preset.params);
    } catch {
      return;
    }
    if (!Array.isArray(timeline) || timeline.length === 0) return;
    this.script = {
      timeline,
      duration: timeline[timeline.length - 1].t ?? 0,
    };
    this.scriptStart = this.elapsed;
    this.padActive = false;
    this.padValue = 0;
    this.updatePadKnob();
    this.setRunning(true);
  }

  // ---------------------------------------------------------------------------
  // DOM construction (all createElement/textContent — no innerHTML)
  // ---------------------------------------------------------------------------

  /** Build the demo's DOM inside the container. */
  buildDOM() {
    const root = document.createElement("div");
    root.className = "rotation-demo";
    this.root = root;

    const layout = document.createElement("div");
    layout.className = "rotation-demo-layout";

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "rotation-demo-canvas-wrap";
    this.canvas = document.createElement("canvas");
    this.canvas.id = "rotation-demo-canvas";
    this.canvas.width = 900;
    this.canvas.height = 500;
    this.canvas.setAttribute(
      "aria-label",
      "Three-quarter view of the selected profiles' quads rotating under the stick input",
    );
    canvasWrap.appendChild(this.canvas);
    this.renderer = new RotationRenderer(this.canvas);

    const controls = document.createElement("div");
    controls.className = "rotation-demo-controls";
    controls.appendChild(this.buildAxisGroup());

    const profilesGroup = document.createElement("div");
    profilesGroup.className = "rotation-demo-control";
    const profilesHeading = document.createElement("h4");
    profilesHeading.textContent = "Profiles";
    profilesGroup.appendChild(profilesHeading);
    this.togglesWrap = document.createElement("div");
    this.togglesWrap.className = "rotation-demo-toggle-group";
    this.togglesWrap.id = "rotation-demo-profile-toggles";
    profilesGroup.appendChild(this.togglesWrap);
    controls.appendChild(profilesGroup);

    controls.appendChild(this.buildStickPad());
    controls.appendChild(this.buildButtons());

    layout.appendChild(canvasWrap);
    layout.appendChild(controls);
    root.appendChild(layout);

    this.readouts = document.createElement("div");
    this.readouts.className = "rotation-demo-readouts";
    this.readouts.id = "rotation-demo-readouts";
    root.appendChild(this.readouts);

    this.readoutEls = new Map();
    this.container.appendChild(root);
  }

  /** Build the roll/pitch/yaw radio group. */
  buildAxisGroup() {
    const group = document.createElement("div");
    group.className = "rotation-demo-control";
    const heading = document.createElement("h4");
    heading.textContent = "Axis";
    group.appendChild(heading);

    const row = document.createElement("div");
    row.className = "rotation-demo-toggle-group";
    AXES.forEach((axis) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "rotation-demo-axis";
      input.id = `rotation-demo-axis-${axis}`;
      input.value = axis;
      input.checked = axis === this.axis;
      input.addEventListener("change", () => {
        if (input.checked && this.axis !== axis) {
          this.axis = axis;
          this.reset(); // switching axis restarts the comparison
        }
      });
      label.appendChild(input);
      const swatch = document.createElement("span");
      swatch.className = `color-indicator ${axis}`;
      swatch.setAttribute("aria-hidden", "true");
      label.appendChild(swatch);
      label.appendChild(document.createTextNode(axis.charAt(0).toUpperCase() + axis.slice(1)));
      row.appendChild(label);
    });
    group.appendChild(row);
    return group;
  }

  /** Build the virtual stick pad (pointer + keyboard, springs back to 0). */
  buildStickPad() {
    const group = document.createElement("div");
    group.className = "rotation-demo-control";
    const heading = document.createElement("h4");
    heading.textContent = "Virtual Stick (drag)";
    group.appendChild(heading);

    const pad = document.createElement("div");
    pad.id = "rotation-demo-stick-pad";
    pad.className = "rotation-demo-stick-pad";
    pad.tabIndex = 0;
    pad.setAttribute("role", "slider");
    pad.setAttribute("aria-label", "Virtual stick, horizontal axis");
    pad.setAttribute("aria-orientation", "horizontal");
    pad.setAttribute("aria-valuemin", "-1");
    pad.setAttribute("aria-valuemax", "1");
    pad.setAttribute("aria-valuenow", "0");
    const knob = document.createElement("span");
    knob.id = "rotation-demo-stick-knob";
    knob.className = "rotation-demo-stick-knob";
    knob.setAttribute("aria-hidden", "true");
    pad.appendChild(knob);
    this.stickPad = pad;
    this.stickKnob = knob;

    const setFromPointer = (e) => {
      const rect = pad.getBoundingClientRect();
      if (rect.width === 0) return;
      const x = e.clientX - rect.left - rect.width / 2;
      this.padValue = Math.max(-1, Math.min(1, x / (rect.width / 2)));
      this.updatePadKnob();
    };

    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.script = null; // live input takes over from scripted playback
      this.padActive = true;
      pad.setPointerCapture(e.pointerId);
      if (!this.running) this.setRunning(true);
      setFromPointer(e);
    });
    pad.addEventListener("pointermove", (e) => {
      if (this.padActive) setFromPointer(e);
    });
    const release = () => {
      this.padActive = false;
      this.padValue = 0; // releasing returns the stick to 0
      this.updatePadKnob();
    };
    pad.addEventListener("pointerup", release);
    pad.addEventListener("pointercancel", release);
    pad.addEventListener("lostpointercapture", release);

    // Keyboard: momentary — arrow keys nudge, releasing the key springs to 0.
    pad.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      this.script = null;
      if (!this.running) this.setRunning(true);
      const step = e.key === "ArrowRight" ? 0.1 : -0.1;
      this.padValue = Math.max(-1, Math.min(1, this.padValue + step));
      this.padActive = true;
      this.updatePadKnob();
    });
    pad.addEventListener("keyup", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") release();
    });
    pad.addEventListener("blur", release);

    group.appendChild(pad);
    return group;
  }

  /** Build the scripted-input buttons and playback controls. */
  buildButtons() {
    const group = document.createElement("div");
    group.className = "rotation-demo-control";
    const heading = document.createElement("h4");
    heading.textContent = "Scripted Inputs";
    group.appendChild(heading);

    const scriptRow = document.createElement("div");
    scriptRow.className = "rotation-demo-buttons";
    SCRIPT_PRESETS.forEach((preset) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = `rotation-demo-${preset.key}`;
      btn.className = "btn btn-secondary btn-small";
      btn.textContent = preset.label;
      btn.addEventListener("click", () => this.playScript(preset));
      scriptRow.appendChild(btn);
    });
    group.appendChild(scriptRow);

    const playbackHeading = document.createElement("h4");
    playbackHeading.textContent = "Playback";
    group.appendChild(playbackHeading);

    const playbackRow = document.createElement("div");
    playbackRow.className = "rotation-demo-buttons";
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.id = "rotation-demo-play-btn";
    playBtn.className = "btn btn-primary btn-small";
    playBtn.textContent = "Play";
    playBtn.addEventListener("click", () => this.setRunning(!this.running));
    this.playBtn = playBtn;
    playbackRow.appendChild(playBtn);

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.id = "rotation-demo-reset-btn";
    resetBtn.className = "btn btn-secondary btn-small";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", () => this.reset());
    playbackRow.appendChild(resetBtn);
    group.appendChild(playbackRow);

    return group;
  }

  // ---------------------------------------------------------------------------
  // Profile toggles + readouts
  // ---------------------------------------------------------------------------

  /**
   * Synchronize profile toggles and reset accumulated state when profiles are
   * removed or replaced.
   * @param {Object[]} profiles
   * @param {boolean} [force=false]
   */
  syncProfiles(profiles, force = false) {
    const count = Math.min(profiles.length, PROFILE_LABELS.length);
    const currentProfiles = profiles.slice(0, PROFILE_LABELS.length);
    const identitiesChanged = !force && (
      currentProfiles.length < this.profileRefs.length ||
      currentProfiles.some((profile, i) => profile !== this.profileRefs[i])
    );
    const countChanged = force || count !== this.builtProfileCount;

    if (identitiesChanged) {
      this.elapsed = 0;
      this.script = null;
      this.scriptStart = 0;
      this.stick = 0;
      this.prevStick = 0;
      this.trails.clear();
      this.lastAngle.clear();
      this.lastRate.clear();
      this.readoutKey = null;
    }
    this.profileRefs = currentProfiles;

    if (countChanged) {
      this.builtProfileCount = count;
      for (const i of this.selected) {
        if (i >= count) this.selected.delete(i);
      }
      this.togglesWrap.replaceChildren();
      currentProfiles.forEach((profile, i) => {
        this.togglesWrap.appendChild(this.createProfileToggle(i, profile));
      });
    } else {
      currentProfiles.forEach((profile, i) => {
        const textNode = this.togglesWrap.children[i]?.lastChild;
        const text = this.profileToggleText(i, profile);
        if (textNode && textNode.nodeValue !== text) textNode.nodeValue = text;
      });
    }

    return countChanged || identitiesChanged;
  }

  profileToggleText(i, profile) {
    let text = `Profile ${PROFILE_LABELS[i]}`;
    const name = profile && profile.name ? String(profile.name).trim() : "";
    if (name && name !== text) text += ` — ${name}`;
    return text;
  }

  /**
   * Create one profile checkbox. Label text is set via createTextNode — no
   * innerHTML — so profile names are safely escaped.
   * @param {number} i
   * @param {Object} profile
   * @returns {HTMLLabelElement}
   */
  createProfileToggle(i, profile) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `rotation-demo-toggle-profile-${i}`;
    checkbox.checked = this.selected.has(i);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.selected.add(i);
      else this.selected.delete(i);
      this.trails.clear();
      this.rebuildFrames();
      this.syncReadouts(this.profilesGetter() ?? []);
    });
    label.appendChild(checkbox);
    const swatch = document.createElement("span");
    swatch.className = "rotation-demo-swatch";
    swatch.style.backgroundColor = PROFILE_COLORS[i];
    swatch.setAttribute("aria-hidden", "true");
    label.appendChild(swatch);
    label.appendChild(document.createTextNode(this.profileToggleText(i, profile)));
    return label;
  }

  /**
   * Rebuild the readout cards when the selected-profile set changes.
   * @param {Object[]} profiles
   */
  syncReadouts(profiles) {
    const key = profiles
      .map((profile, i) => (profile && this.selected.has(i)) ? i : -1)
      .filter((i) => i >= 0)
      .join("-");
    if (key === this.readoutKey) return;
    this.readoutKey = key;
    this.readoutEls = new Map();
    this.readouts.replaceChildren();
    profiles.forEach((profile, i) => {
      if (!profile || !this.selected.has(i)) return;
      this.readouts.appendChild(this.createReadoutCard(i));
      this.updateReadout(i, this.lastAngle.get(i) ?? 0, this.lastRate.get(i) ?? 0);
    });
  }

  /**
   * Create one profile's readout card.
   * @param {number} i
   * @returns {HTMLElement}
   */
  createReadoutCard(i) {
    const card = document.createElement("div");
    card.className = "rotation-demo-readout";
    card.dataset.profileIndex = String(i);

    const title = document.createElement("span");
    title.className = "rotation-demo-readout-label";
    title.style.color = PROFILE_COLORS[i];
    title.textContent = `Profile ${PROFILE_LABELS[i]}`;
    card.appendChild(title);

    const refs = {
      angle: this.appendReadoutRow(card, "Angle", "0.0°"),
      rate: this.appendReadoutRow(card, "Rate", "0 °/s"),
      time: this.appendReadoutRow(card, "Time", "0.0 s"),
    };
    this.readoutEls.set(i, refs);
    return card;
  }

  /**
   * Append a label/value row to a readout card and return the value span.
   * @param {HTMLElement} card
   * @param {string} name
   * @param {string} initial
   * @returns {HTMLElement}
   */
  appendReadoutRow(card, name, initial) {
    const row = document.createElement("div");
    row.className = "rotation-demo-readout-row";
    const label = document.createElement("span");
    label.textContent = name;
    const value = document.createElement("span");
    value.className = "rotation-demo-readout-value";
    value.textContent = initial;
    row.appendChild(label);
    row.appendChild(value);
    card.appendChild(row);
    return value;
  }

  /**
   * Update one profile's readout values.
   * @param {number} i
   * @param {number} angle
   * @param {number} rate
   */
  updateReadout(i, angle, rate) {
    const refs = this.readoutEls && this.readoutEls.get(i);
    if (!refs) return;
    // Accumulated rotation, not heading mod 360 — the quad graphic already
    // conveys orientation, and total rotation is what compares rate profiles.
    refs.angle.textContent = `${angle.toFixed(1)}°`;
    refs.rate.textContent = `${Math.round(rate)} °/s`;
    refs.time.textContent = `${this.elapsed.toFixed(1)} s`;
  }

  /** Zero every visible readout card. */
  resetReadouts() {
    if (!this.readoutEls) return;
    for (const refs of this.readoutEls.values()) {
      refs.angle.textContent = "0.0°";
      refs.rate.textContent = "0 °/s";
      refs.time.textContent = "0.0 s";
    }
  }

  // ---------------------------------------------------------------------------
  // Stick pad
  // ---------------------------------------------------------------------------

  /** Position the pad knob from padValue and expose it to assistive tech. */
  updatePadKnob() {
    if (!this.stickKnob) return;
    this.stickKnob.style.left = `${((this.padValue + 1) / 2) * 100}%`;
    this.stickPad.setAttribute("aria-valuenow", this.padValue.toFixed(2));
    this.dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Section collapse (the app wires its own sections; this one is ours)
  // ---------------------------------------------------------------------------

  /** Wire the demo's collapsible-section header, persisting like app.js does. */
  wireSectionCollapse() {
    const section = this.container.closest(".collapsible-section[data-collapse-key]");
    if (!section) return;
    const header = section.querySelector(".collapsible-section-header");
    if (!header) return;
    const key = section.dataset.collapseKey;

    const loadState = () => {
      try {
        const parsed = JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    };

    if (loadState()[key]) {
      section.classList.add("collapsed");
      header.setAttribute("aria-expanded", "false");
    }
    header.addEventListener("click", () => {
      const collapsed = section.classList.toggle("collapsed");
      header.setAttribute("aria-expanded", String(!collapsed));
      try {
        const state = loadState();
        if (collapsed) state[key] = true;
        else delete state[key];
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Ignore quota / privacy-mode errors.
      }
    });
  }
}
