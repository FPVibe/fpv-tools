/**
 * Canvas renderer for the rotation demo.
 *
 * Pure drawing module — no rate math, no profile logic. The controller
 * (rotation-demo-ui.js) computes angles and rates and passes them in; this
 * class only paints. Each quad is drawn as a 3D model (see quad-3d.js) in a
 * three-quarter view: yaw spins the model in the ground plane, roll banks
 * it, pitch pitches it. Visual conventions match graph-renderer.js:
 * background #1a1a1a, grid #333, axis #666, labels #999.
 */

import {
  ARM_LENGTH,
  buildQuadModel,
  DEMO_CAMERA,
  faceNormal,
  headingArrow,
  orientationForAxis,
  orientNormal,
  orientVertices,
  project,
  projectCircle,
  shadeColor,
  shadeFactor,
  sortFacesForPainter,
  trailPoints,
} from "./quad-3d.js";

/** World-space direction toward the light (camera side, above). */
const LIGHT_DIR = [0.6, -0.42, 0.68];
const LIGHT_LEN = Math.hypot(LIGHT_DIR[0], LIGHT_DIR[1], LIGHT_DIR[2]);
const LIGHT = LIGHT_DIR.map((c) => c / LIGHT_LEN);

/** Base colors for the parts that don't take the profile color. */
const PART_COLORS = { body: "#3a3f44", canopy: "#2b3035" };

/** Ground-shadow radius, in model units. */
const SHADOW_RADIUS = 1.12;

/**
 * Scale a projected point into a quad's cell.
 * @param {{x: number, y: number}} point - Projected screen point.
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} scale - Pixels per model unit.
 * @returns {{x: number, y: number}}
 */
function place(point, centerX, centerY, scale) {
  return { x: centerX + point.x * scale, y: centerY + point.y * scale };
}

/**
 * Draws the selected profiles' quads as 3D models with a fading trail of
 * recent positions, plus a legend and stick indicators.
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
    this.model = buildQuadModel();
    /** @type {{label: string, color: string}[]} */
    this.quads = [];
  }

  /**
   * Set the quads to draw (1-3 entries; extras are ignored).
   * @param {{label: string, color: string}[]} quads
   */
  setQuads(quads) {
    this.quads = Array.isArray(quads) ? quads.slice(0, 3) : [];
  }

  /** Clear the canvas to the dark background. */
  clear() {
    this.ctx.fillStyle = this.backgroundColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Draw one frame: one quad cell per entry, parallel to the setQuads()
   * order.
   * @param {{angleDeg?: number, axis?: string, trail?: number[],
   *          rate?: number, stick?: number|null}[]} frames - One frame per
   *   quad.
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
    const centerY = topPad + (height - topPad - bottomPad) / 2;
    // Model units → pixels: the reference ring keeps its old on-screen size.
    const ringRadius = Math.min(cellWidth, height - topPad - bottomPad) * 0.28;
    const scale = ringRadius / ARM_LENGTH;

    for (let i = 0; i < this.quads.length; i++) {
      this.drawQuad(
        this.quads[i],
        frameList[i] ?? {},
        cellWidth * i,
        cellWidth,
        centerY,
        scale,
        height,
      );
    }
    this.drawLegend();
  }

  /**
   * Draw a single quad cell: shadow, reference ring, trail, the 3D model,
   * the heading arrow, and the 2D annotations.
   * @param {{label: string, color: string}} quad
   * @param {{angleDeg?: number, axis?: string, trail?: number[],
   *          rate?: number, stick?: number|null}} frame
   * @param {number} cellX - Left edge of this quad's cell.
   * @param {number} cellWidth - Width of this quad's cell.
   * @param {number} centerY - Vertical center of the spin circle.
   * @param {number} scale - Pixels per model unit.
   * @param {number} height - Canvas height, for the bottom annotations.
   */
  drawQuad(quad, frame, cellX, cellWidth, centerY, scale, height) {
    const ctx = this.ctx;
    const centerX = cellX + cellWidth / 2;
    const axis = typeof frame.axis === "string" ? frame.axis : "yaw";
    const angleDeg = typeof frame.angleDeg === "number" ? frame.angleDeg : 0;
    const orientation = orientationForAxis(axis, angleDeg);

    // Model → screen: orient in world space, project, then scale into the cell.
    const oriented = orientVertices(this.model.vertices, orientation);
    const screen = oriented.map((vertex) =>
      place(project(vertex, DEMO_CAMERA), centerX, centerY, scale)
    );

    // Ground shadow and reference ring keep the depth readable.
    this.fillPolygon(
      this.circlePoints(SHADOW_RADIUS, scale, centerX, centerY),
      "rgba(0, 0, 0, 0.35)",
    );
    this.strokePolygon(
      this.circlePoints(ARM_LENGTH, scale, centerX, centerY),
      this.gridColor,
      1,
      [4, 4],
    );

    // Fading trail of the rotating part's recent path.
    this.drawTrail(frame.trail, axis, quad.color, scale, centerX, centerY);

    // Solid faces, far to near (painter's algorithm).
    for (const face of sortFacesForPainter(this.model.faces, oriented, DEMO_CAMERA)) {
      const normal = orientNormal(faceNormal(this.model.vertices, face), orientation);
      const factor = shadeFactor(normal, LIGHT);
      const base = face.part === "arm" || face.part === "motor"
        ? quad.color
        : PART_COLORS[face.part];
      const color = shadeColor(base, factor);
      this.fillPolygon(
        face.indices.map((i) => screen[i]),
        color,
        shadeColor(color, 0.55),
      );
    }

    // Heading arrow along the current orientation.
    const arrow = headingArrow(orientation, DEMO_CAMERA);
    const base = place(arrow.base, centerX, centerY, scale);
    const tip = place(arrow.tip, centerX, centerY, scale);
    ctx.strokeStyle = this.foregroundColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    for (const chevron of [arrow.left, arrow.right]) {
      const end = place(chevron, centerX, centerY, scale);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(end.x, end.y);
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
   * Project a ground-plane circle into a quad's cell.
   * @param {number} radius - Model units.
   * @param {number} scale
   * @param {number} centerX
   * @param {number} centerY
   * @returns {{x: number, y: number}[]}
   */
  circlePoints(radius, scale, centerX, centerY) {
    return projectCircle(radius, DEMO_CAMERA, 48).map((p) => place(p, centerX, centerY, scale));
  }

  /**
   * Draw the fading path of the rotating part's recent positions.
   * @param {number[]|undefined} trail - Accumulated angles, oldest first.
   * @param {string} axis - "roll" | "pitch" | "yaw"
   * @param {string} color - Trail color.
   * @param {number} scale
   * @param {number} centerX
   * @param {number} centerY
   */
  drawTrail(trail, axis, color, scale, centerX, centerY) {
    const ctx = this.ctx;
    const points = trailPoints(trail, axis, DEMO_CAMERA);
    if (points.length < 2) return;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 1; i < points.length; i++) {
      // Fade older segments out, newer segments in.
      const alpha = 0.05 + (i / points.length) * 0.5;
      const from = place(points[i - 1], centerX, centerY, scale);
      const to = place(points[i], centerX, centerY, scale);
      ctx.strokeStyle = this.withAlpha(color, alpha);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  }

  /**
   * Fill a screen-space polygon, optionally with a matching outline.
   * @param {{x: number, y: number}[]} points
   * @param {string} fill
   * @param {string} [stroke]
   */
  fillPolygon(points, fill, stroke) {
    const ctx = this.ctx;
    if (points.length === 0) return;
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /**
   * Stroke a screen-space polygon (dashed when a dash pattern is given).
   * @param {{x: number, y: number}[]} points
   * @param {string} color
   * @param {number} width
   * @param {number[]} [dash]
   */
  strokePolygon(points, color, width, dash) {
    const ctx = this.ctx;
    if (points.length === 0) return;
    ctx.setLineDash(dash ?? []);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
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
    ctx.arc(centerX + clamped * trackHalf, trackY, 6, 0, Math.PI * 2);
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
