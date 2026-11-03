/**
 * Canvas renderer for the rotation demo.
 *
 * Pure drawing module — no rate math, no profile logic. The controller
 * (rotation-demo-ui.js) computes angles and rates and passes them in; this
 * class only paints. Visual conventions match graph-renderer.js: background
 * #1a1a1a, grid #333, axis #666, labels #999.
 */

/** Degrees → radians. */
const DEG_TO_RAD = Math.PI / 180;

/** Full circle in radians. */
const TAU = Math.PI * 2;

/**
 * Draws top-down quads (X-layout arms, motor dots, heading arrow) with a
 * fading arc trail of recent headings, plus a legend and stick indicators.
 */
export class RotationRenderer {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas to draw the demo on.
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.backgroundColor = "#1a1a1a";
    this.gridColor = "#333";
    this.axisColor = "#666";
    this.labelColor = "#999";
    this.foregroundColor = "#c9d1d9";
    /** @type {{label: string, color: string}[]} */
    this.quads = [];
  }

  /**
   * Set the quads to draw.
   * @param {{label: string, color: string}[]} quads
   */
  setQuads(quads) {
    this.quads = Array.isArray(quads) ? quads.slice() : [];
  }

  /** Clear the canvas to the dark background. */
  clear() {
    this.ctx.fillStyle = this.backgroundColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Draw one frame: one top-down quad cell per entry, parallel to the
   * setQuads() order.
   * @param {{angleDeg?: number, trail?: number[], rate?: number,
   *          stick?: number|null}[]} frames - One frame per quad.
   */
  draw(frames) {
    this.clear();
    if (this.quads.length === 0) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const frameList = Array.isArray(frames) ? frames : [];

    const cellWidth = width / this.quads.length;
    const topPad = 34; // legend strip
    const bottomPad = 64; // stick indicator + rate text
    const radius = Math.min(cellWidth, height - topPad - bottomPad) * 0.3;
    const centerY = topPad + (height - topPad - bottomPad) / 2;

    for (let i = 0; i < this.quads.length; i++) {
      this.drawQuad(
        this.quads[i],
        frameList[i] ?? {},
        cellWidth * i,
        cellWidth,
        centerY,
        radius,
        height,
      );
    }
    this.drawLegend();
  }

  /**
   * Draw a single top-down quad cell.
   * @param {{label: string, color: string}} quad
   * @param {{angleDeg?: number, trail?: number[], rate?: number,
   *          stick?: number|null}} frame
   * @param {number} cellX - Left edge of this quad's cell.
   * @param {number} cellWidth - Width of this quad's cell.
   * @param {number} centerY - Vertical center of the spin circle.
   * @param {number} radius - Spin-circle radius.
   * @param {number} height - Canvas height, for the bottom annotations.
   */
  drawQuad(quad, frame, cellX, cellWidth, centerY, radius, height) {
    const ctx = this.ctx;
    const centerX = cellX + cellWidth / 2;
    const heading = (frame.angleDeg ?? 0) * DEG_TO_RAD;

    // Faint reference ring so the rotation is readable.
    ctx.strokeStyle = this.gridColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    this.drawTrail(frame.trail, centerX, centerY, radius, quad.color);

    // Arms (X layout) with motor dots at the tips.
    ctx.strokeStyle = quad.color;
    ctx.lineWidth = 3;
    for (let offset = 45; offset < 360; offset += 90) {
      const armAngle = heading + offset * DEG_TO_RAD;
      const x = centerX + Math.cos(armAngle) * radius;
      const y = centerY + Math.sin(armAngle) * radius;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = quad.color;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, TAU);
      ctx.fill();
    }

    // Body hub.
    ctx.fillStyle = this.backgroundColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 7, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Heading arrow along the current orientation.
    const arrowLength = radius * 1.3;
    const tipX = centerX + Math.cos(heading) * arrowLength;
    const tipY = centerY + Math.sin(heading) * arrowLength;
    ctx.strokeStyle = this.foregroundColor;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    for (const spread of [150, -150]) {
      const chevron = heading + spread * DEG_TO_RAD;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX + Math.cos(chevron) * 9, tipY + Math.sin(chevron) * 9);
      ctx.stroke();
    }

    // Rate readout under the quad.
    ctx.fillStyle = this.labelColor;
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.round(frame.rate ?? 0)} °/s`, centerX, height - 12);

    // Stick-position indicator, drawn when the frame provides one.
    if (typeof frame.stick === "number") {
      this.drawStickIndicator(
        frame.stick,
        quad.color,
        centerX,
        height - 40,
        Math.min(cellWidth * 0.3, 110),
      );
    }
  }

  /**
   * Draw the fading arc trail of recent headings (oldest → newest).
   * @param {number[]|undefined} trail
   * @param {number} centerX
   * @param {number} centerY
   * @param {number} radius
   * @param {string} color
   */
  drawTrail(trail, centerX, centerY, radius, color) {
    if (!Array.isArray(trail) || trail.length < 2) return;
    const ctx = this.ctx;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 1; i < trail.length; i++) {
      // Fade older segments out, newer segments in.
      const alpha = 0.05 + (i / trail.length) * 0.5;
      const start = trail[i - 1] * DEG_TO_RAD;
      const delta = trail[i] - trail[i - 1];
      if (Math.abs(delta) < 0.01) continue;
      ctx.strokeStyle = this.withAlpha(color, alpha);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, start, start + delta * DEG_TO_RAD, delta < 0);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  }

  /**
   * Draw the mini stick indicator under a quad.
   * @param {number} stick - Stick position, -1..1.
   * @param {string} color - Knob color.
   * @param {number} centerX
   * @param {number} trackY
   * @param {number} trackHalf - Half-width of the track.
   */
  drawStickIndicator(stick, color, centerX, trackY, trackHalf) {
    const ctx = this.ctx;
    const clamped = Math.max(-1, Math.min(1, stick));

    ctx.strokeStyle = this.axisColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX - trackHalf, trackY);
    ctx.lineTo(centerX + trackHalf, trackY);
    ctx.stroke();

    // Center tick marking stick = 0.
    ctx.strokeStyle = this.gridColor;
    ctx.beginPath();
    ctx.moveTo(centerX, trackY - 4);
    ctx.lineTo(centerX, trackY + 4);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(centerX + clamped * trackHalf, trackY, 6, 0, TAU);
    ctx.fill();
  }

  /** Draw the legend (color swatch + label per quad) in the top-left corner. */
  drawLegend() {
    const ctx = this.ctx;
    ctx.font = "12px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let x = 12;
    const y = 17;
    for (const quad of this.quads) {
      ctx.fillStyle = quad.color;
      ctx.fillRect(x, y - 6, 12, 12);
      x += 18;
      ctx.fillStyle = this.labelColor;
      ctx.fillText(quad.label, x, y);
      x += ctx.measureText(quad.label).width + 20;
    }
    ctx.textBaseline = "alphabetic";
  }

  /**
   * Convert a #rrggbb color to an rgba() string with the given alpha.
   * @param {string} hex
   * @param {number} alpha
   * @returns {string} The color with alpha applied (hex passthrough on no match).
   */
  withAlpha(hex, alpha) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!match) return hex;
    const value = parseInt(match[1], 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }
}
