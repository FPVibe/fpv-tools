import { calculateRate, calculateThrottle } from "./rate-calculator.js";

/**
 * Dash patterns for up to 5 simultaneous profiles.
 * Index corresponds to profile slot (0 = A, 1 = B, …).
 * @type {number[][]}
 */
export const PROFILE_DASH_PATTERNS = [
  [], // A — solid
  [10, 5], // B — dashed
  [3, 4], // C — dotted
  [12, 4, 3, 4], // D — dash-dot
  [16, 6], // E — long-dash
];

/**
 * Renders comparison graphs for rate profiles.
 * Accepts an arbitrary-length array of profiles (up to 5).
 */
export class GraphRenderer {
  constructor(rateCanvas, throttleCanvas) {
    this.rateCanvas = rateCanvas;
    this.throttleCanvas = throttleCanvas;
    this.rateCtx = rateCanvas.getContext("2d");
    this.throttleCtx = throttleCanvas.getContext("2d");

    // Visual configuration
    this.colors = {
      roll: "#ff3366", // Red
      pitch: "#33ff66", // Green
      yaw: "#ffaa00", // Orange
    };

    this.padding = 60;
    this.gridColor = "#333";
    this.axisColor = "#666";
    this.labelColor = "#999";

    // Visibility settings
    this.visibility = {
      profiles: [true, true, false, false, false], // one slot per max-profile
      roll: true,
      pitch: true,
      yaw: true,
    };
  }

  /**
   * Update visibility settings.
   * @param {Object} opts
   * @param {boolean[]} [opts.profiles] - Per-slot visibility array
   * @param {boolean}  [opts.roll]
   * @param {boolean}  [opts.pitch]
   * @param {boolean}  [opts.yaw]
   */
  setVisibility(opts) {
    if (opts.profiles !== undefined) {
      this.visibility.profiles = [...opts.profiles];
    }
    if (opts.roll !== undefined) this.visibility.roll = opts.roll;
    if (opts.pitch !== undefined) this.visibility.pitch = opts.pitch;
    if (opts.yaw !== undefined) this.visibility.yaw = opts.yaw;
  }

  /**
   * Clear a canvas
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   */
  clearCanvas(ctx, width, height) {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Draw grid on canvas
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   */
  drawGrid(ctx, width, height) {
    ctx.strokeStyle = this.gridColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    // Vertical grid lines
    for (let i = 0; i <= 10; i++) {
      const x = this.padding + (width - 2 * this.padding) * (i / 10);
      ctx.beginPath();
      ctx.moveTo(x, this.padding);
      ctx.lineTo(x, height - this.padding);
      ctx.stroke();
    }

    // Horizontal grid lines
    for (let i = 0; i <= 10; i++) {
      const y = this.padding + (height - 2 * this.padding) * (i / 10);
      ctx.beginPath();
      ctx.moveTo(this.padding, y);
      ctx.lineTo(width - this.padding, y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  /**
   * Draw axes for rate graph
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {number} yMax
   */
  drawRateAxes(ctx, width, height, yMax) {
    ctx.strokeStyle = this.axisColor;
    ctx.lineWidth = 2;

    // Y-axis
    ctx.beginPath();
    ctx.moveTo(this.padding, this.padding);
    ctx.lineTo(this.padding, height - this.padding);
    ctx.stroke();

    // X-axis (centered)
    ctx.beginPath();
    ctx.moveTo(this.padding, height / 2);
    ctx.lineTo(width - this.padding, height / 2);
    ctx.stroke();

    // Labels
    ctx.fillStyle = this.labelColor;
    ctx.font = "12px monospace";
    ctx.textAlign = "right";

    // Y-axis labels
    for (let i = 0; i <= 4; i++) {
      const value = yMax - (i * yMax) / 2;
      const y = this.padding + (height - 2 * this.padding) * (i / 4);
      ctx.fillText(Math.round(value) + "°/s", this.padding - 10, y + 4);
    }

    // X-axis labels
    ctx.textAlign = "center";
    ctx.fillText("-1.0", this.padding, height - this.padding + 20);
    ctx.fillText("0.0", width / 2, height - this.padding + 20);
    ctx.fillText("1.0", width - this.padding, height - this.padding + 20);
    ctx.fillText("RC Command", width / 2, height - 10);
  }

  /**
   * Draw axes for throttle graph
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   */
  drawThrottleAxes(ctx, width, height) {
    ctx.strokeStyle = this.axisColor;
    ctx.lineWidth = 2;

    // Y-axis and X-axis
    ctx.beginPath();
    ctx.moveTo(this.padding, this.padding);
    ctx.lineTo(this.padding, height - this.padding);
    ctx.lineTo(width - this.padding, height - this.padding);
    ctx.stroke();

    // Labels
    ctx.fillStyle = this.labelColor;
    ctx.font = "12px monospace";
    ctx.textAlign = "right";

    // Y-axis labels
    for (let i = 0; i <= 10; i++) {
      const value = 1.0 - i / 10;
      const y = this.padding + (height - 2 * this.padding) * (i / 10);
      ctx.fillText(value.toFixed(1), this.padding - 10, y + 4);
    }

    // X-axis labels
    ctx.textAlign = "center";
    for (let i = 0; i <= 10; i++) {
      const value = i / 10;
      const x = this.padding + (width - 2 * this.padding) * (i / 10);
      ctx.fillText(value.toFixed(1), x, height - this.padding + 20);
    }

    ctx.fillText("Throttle Input", width / 2, height - 10);

    // Y-axis label (rotated)
    ctx.save();
    ctx.translate(20, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Throttle Output", 0, 0);
    ctx.restore();
  }

  /**
   * Draw a single rate curve
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {Object} rates - Rate settings for specific axis
   * @param {string} color - Curve color
   * @param {number} yMax - Maximum Y value for scaling
   * @param {number[]} [dashPattern=[]] - Canvas line-dash pattern for this profile
   * @param {string} [ratesType='ACTUAL'] - Rate algorithm to use ('ACTUAL' or 'BETAFLIGHT')
   */
  drawRateCurve(ctx, width, height, rates, color, yMax, dashPattern = [], ratesType = "ACTUAL") {
    const steps = 200;

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash(dashPattern);
    ctx.beginPath();

    for (let i = 0; i <= steps; i++) {
      const rcCommand = -1 + (2 * i) / steps;
      const rateValue = calculateRate(rcCommand, rates.center, rates.maxRate, rates.expo, ratesType);

      const x = this.padding + (width - 2 * this.padding) * ((rcCommand + 1) / 2);
      const y = height / 2 - (rateValue / yMax) * ((height - 2 * this.padding) / 2);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Draw throttle curve
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   * @param {Object} throttle - Throttle settings
   * @param {string} color - Curve color
   * @param {number[]} [dashPattern=[]] - Canvas line-dash pattern for this profile
   */
  drawThrottleCurve(ctx, width, height, throttle, color, dashPattern = []) {
    const steps = 200;

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash(dashPattern);
    ctx.beginPath();

    for (let i = 0; i <= steps; i++) {
      const input = i / steps;
      const throttleValue = calculateThrottle(
        input,
        throttle.mid,
        throttle.expo,
        throttle.limitType,
        throttle.limitPercent,
      );

      const x = this.padding + (width - 2 * this.padding) * input;
      const y = height - this.padding - (height - 2 * this.padding) * throttleValue;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Calculate maximum rate across all visible profiles and axes for Y-axis scaling.
   * @param {Object[]} profiles - Array of profile objects (entries may be null)
   * @returns {number} Maximum rate value (minimum 1000)
   */
  calculateMaxRate(profiles) {
    const axes = ["roll", "pitch", "yaw"];
    let maxRate = 0;

    profiles.forEach((profile, i) => {
      if (!profile || !this.visibility.profiles[i]) return;
      axes.forEach((axis) => {
        if (this.visibility[axis]) {
          const rate = Math.abs(
            calculateRate(
              1,
              profile.rates[axis].center,
              profile.rates[axis].maxRate,
              profile.rates[axis].expo,
              profile.ratesType || "ACTUAL",
            ),
          );
          maxRate = Math.max(maxRate, rate);
        }
      });
    });

    return Math.max(1000, maxRate * 1.1);
  }

  /**
   * Render rate comparison graph for all profiles.
   * @param {Object[]} profiles - Array of profile objects
   * @param {number|null} [yMaxOverride=null] - If provided, use this as the Y-axis ceiling
   *   instead of computing it from the profiles. Used to share a common scale across
   *   multiple renderer instances (e.g. side-by-side mode).
   */
  renderRates(profiles, yMaxOverride = null) {
    const width = this.rateCanvas.width;
    const height = this.rateCanvas.height;
    const ctx = this.rateCtx;
    const axes = ["roll", "pitch", "yaw"];

    this.clearCanvas(ctx, width, height);
    this.drawGrid(ctx, width, height);

    const yMax = yMaxOverride !== null ? yMaxOverride : this.calculateMaxRate(profiles);

    profiles.forEach((profile, i) => {
      if (!profile || !this.visibility.profiles[i]) return;
      const dashPattern = PROFILE_DASH_PATTERNS[i] ?? [];
      axes.forEach((axis) => {
        if (!this.visibility[axis]) return;
        this.drawRateCurve(
          ctx,
          width,
          height,
          profile.rates[axis],
          this.colors[axis],
          yMax,
          dashPattern,
          profile.ratesType || "ACTUAL",
        );
      });
    });

    this.drawRateAxes(ctx, width, height, yMax);
  }

  /**
   * Render throttle comparison graph for all profiles.
   * @param {Object[]} profiles - Array of profile objects
   */
  renderThrottle(profiles) {
    const width = this.throttleCanvas.width;
    const height = this.throttleCanvas.height;
    const ctx = this.throttleCtx;

    this.clearCanvas(ctx, width, height);
    this.drawGrid(ctx, width, height);

    profiles.forEach((profile, i) => {
      if (!profile || !this.visibility.profiles[i]) return;
      const dashPattern = PROFILE_DASH_PATTERNS[i] ?? [];
      this.drawThrottleCurve(ctx, width, height, profile.throttle, "#00aaff", dashPattern);
    });

    this.drawThrottleAxes(ctx, width, height);
  }

  /**
   * Render both graphs for all profiles.
   * @param {Object[]} profiles - Array of profile objects
   * @param {number|null} [yMaxOverride=null] - Passed through to renderRates for shared scaling.
   */
  render(profiles, yMaxOverride = null) {
    this.renderRates(profiles, yMaxOverride);
    this.renderThrottle(profiles);
  }
}
