/**
 * Pure 3D math for the rotation demo's quad rendering.
 *
 * No canvas, no rate math: the renderer (rotation-renderer.js) paints what
 * this module computes. World axes are right-handed — +x east, +y north,
 * +z up — with the quad's nose along +x at heading 0. Screen coordinates
 * follow the canvas convention: +x right, +y down.
 */

/** Degrees → radians. */
const DEG_TO_RAD = Math.PI / 180;

/** Full circle in radians. */
const TAU = Math.PI * 2;

/** Center-to-motor distance in model units. */
export const ARM_LENGTH = 1;

/** Diffuse floor so faces turned away from the light stay visible. */
export const AMBIENT = 0.35;

/**
 * A point in screen coordinates (canvas convention: +y down).
 * @typedef {object} ScreenPoint
 * @property {number} x
 * @property {number} y
 * @property {number} depth
 */

/**
 * One quad face: a named part, its box center, and four vertex indices.
 * @typedef {object} QuadFace
 * @property {string} part
 * @property {number[]} center
 * @property {number[]} indices
 */

/**
 * The quad as boxes: shared vertices plus quad faces wound outward.
 * @typedef {object} QuadModel
 * @property {number[][]} vertices
 * @property {QuadFace[]} faces
 */

/**
 * A camera looking at the origin, with an explicit right/up/back basis.
 * @typedef {object} Camera
 * @property {number} azimuthDeg
 * @property {number} elevationDeg
 * @property {number} distance
 * @property {number} focal
 * @property {number[]} right
 * @property {number[]} up
 * @property {number[]} back
 */

/**
 * Rotate a point about the x axis (right-hand rule).
 * @param {number[]} point - [x, y, z]
 * @param {number} angleDeg
 * @returns {number[]} The rotated point.
 */
export function rotateX(point, angleDeg) {
  const a = angleDeg * DEG_TO_RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [point[0], point[1] * c - point[2] * s, point[1] * s + point[2] * c];
}

/**
 * Rotate a point about the y axis (right-hand rule).
 * @param {number[]} point - [x, y, z]
 * @param {number} angleDeg
 * @returns {number[]} The rotated point.
 */
export function rotateY(point, angleDeg) {
  const a = angleDeg * DEG_TO_RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [point[0] * c + point[2] * s, point[1], -point[0] * s + point[2] * c];
}

/**
 * Rotate a point about the z axis (right-hand rule).
 * @param {number[]} point - [x, y, z]
 * @param {number} angleDeg
 * @returns {number[]} The rotated point.
 */
export function rotateZ(point, angleDeg) {
  const a = angleDeg * DEG_TO_RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [point[0] * c - point[1] * s, point[0] * s + point[1] * c, point[2]];
}

/**
 * Map a demo axis onto the body rotation that visualizes it.
 *
 * Yaw spins the model in the ground plane; roll banks it about the nose
 * axis; pitch pitches it about the lateral axis. Unknown axes read as yaw.
 * @param {string} axis - "roll" | "pitch" | "yaw"
 * @param {number} angleDeg - Accumulated rotation in degrees.
 * @returns {{heading: number, roll: number, pitch: number}}
 */
export function orientationForAxis(axis, angleDeg) {
  const angle = Number.isFinite(angleDeg) ? angleDeg : 0;
  if (axis === "roll") return { heading: 0, roll: angle, pitch: 0 };
  if (axis === "pitch") return { heading: 0, roll: 0, pitch: angle };
  return { heading: angle, roll: 0, pitch: 0 };
}

/**
 * Rotate a body-frame point into world coordinates.
 *
 * Composition is yaw ∘ roll ∘ pitch: pitch and roll act in the body frame,
 * then the whole model swings to its heading.
 * @param {number[]} point - [x, y, z] in body coordinates.
 * @param {{heading?: number, roll?: number, pitch?: number}} [orientation]
 * @returns {number[]} The point in world coordinates.
 */
export function orientPoint(point, orientation = {}) {
  const { heading = 0, roll = 0, pitch = 0 } = orientation ?? {};
  return rotateZ(rotateX(rotateY(point, pitch), roll), heading);
}

/**
 * Rotate every vertex of a list into world coordinates.
 * @param {number[][]} vertices
 * @param {{heading?: number, roll?: number, pitch?: number}} [orientation]
 * @returns {number[][]} A new list; the input is left untouched.
 */
export function orientVertices(vertices, orientation = {}) {
  return vertices.map((vertex) => orientPoint(vertex, orientation));
}

/**
 * Rotate a direction vector by an orientation (rotations only, so normals
 * transform exactly like points).
 * @param {number[]} normal - [x, y, z]
 * @param {{heading?: number, roll?: number, pitch?: number}} [orientation]
 * @returns {number[]}
 */
export function orientNormal(normal, orientation = {}) {
  return orientPoint(normal, orientation);
}

/**
 * Build a camera looking at the origin from the given azimuth and elevation.
 * @param {object} [opts]
 * @param {number} [opts.azimuthDeg=-35] - View direction in the ground
 *   plane, degrees counterclockwise from +x.
 * @param {number} [opts.elevationDeg=25] - Height above the ground plane.
 * @param {number} [opts.distance=8] - Camera distance from the origin, in
 *   model units.
 * @param {number} [opts.focal=6] - Focal length, in model units.
 * @returns {Camera}
 */
export function makeCamera(opts = {}) {
  const azimuthDeg = opts.azimuthDeg ?? -35;
  const elevationDeg = opts.elevationDeg ?? 25;
  const distance = opts.distance ?? 8;
  const focal = opts.focal ?? 6;

  const az = azimuthDeg * DEG_TO_RAD;
  const el = elevationDeg * DEG_TO_RAD;
  const back = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];

  // Camera up: world up projected off the view axis. Looking straight up
  // or down leaves no world-up component, so fall back to +y.
  const worldUp = [0, 0, 1];
  const along = back[0] * worldUp[0] + back[1] * worldUp[1] + back[2] * worldUp[2];
  let up;
  if (Math.abs(along) > 0.9999) {
    up = [0, 1, 0];
  } else {
    up = [
      worldUp[0] - back[0] * along,
      worldUp[1] - back[1] * along,
      worldUp[2] - back[2] * along,
    ];
    const len = Math.hypot(up[0], up[1], up[2]);
    up = [up[0] / len, up[1] / len, up[2] / len];
  }

  // right = up × back, so (right, up, back) is right-handed with back
  // pointing at the camera.
  const right = [
    up[1] * back[2] - up[2] * back[1],
    up[2] * back[0] - up[0] * back[2],
    up[0] * back[1] - up[1] * back[0],
  ];

  return { azimuthDeg, elevationDeg, distance, focal, right, up, back };
}

/**
 * The rotation demo's camera: three-quarter view from the front-right,
 * above. Shared so the renderer and its tests agree on the viewpoint.
 * @type {Camera}
 */
export const DEMO_CAMERA = makeCamera({ azimuthDeg: -35, elevationDeg: 25 });

/**
 * Project a world point to screen coordinates through a camera.
 * @param {number[]} point - [x, y, z] in world coordinates.
 * @param {Camera} camera
 * @returns {ScreenPoint} Screen x/y (canvas convention: +y down) and
 *   distance from the camera along the view axis.
 */
export function project(point, camera) {
  const xCam = camera.right[0] * point[0] + camera.right[1] * point[1] +
    camera.right[2] * point[2];
  const yCam = camera.up[0] * point[0] + camera.up[1] * point[1] +
    camera.up[2] * point[2];
  const zCam = camera.back[0] * point[0] + camera.back[1] * point[1] +
    camera.back[2] * point[2];
  const depth = camera.distance - zCam;
  const scale = camera.focal / depth;
  return { x: xCam * scale, y: -yCam * scale, depth };
}

/**
 * Project a horizontal circle (the reference ring and ground shadow).
 * @param {number} radius - Model units.
 * @param {Camera} camera
 * @param {number} [segments=24]
 * @param {number} [z=0] - Height of the circle's plane.
 * @returns {ScreenPoint[]}
 */
export function projectCircle(radius, camera, segments = 24, z = 0) {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    points.push(project([Math.cos(a) * radius, Math.sin(a) * radius, z], camera));
  }
  return points;
}

/**
 * Build the quad model: central body, canopy, four X-layout arms with a
 * motor bell on each tip. All boxes are axis-aligned in body coordinates
 * except the arms, which are rotated onto their 45° spokes.
 * @returns {QuadModel}
 */
export function buildQuadModel() {
  const parts = { vertices: [], faces: [] };

  const bodyZ = 0.16;
  const canopyZ = 0.1;
  addBox(parts, [0, 0, 0], [0.5, 0.42, bodyZ], 0, "body");
  addBox(parts, [0, 0, bodyZ / 2 + canopyZ / 2], [0.3, 0.26, canopyZ], 0, "canopy");

  const armInset = 0.12;
  const armSpan = ARM_LENGTH - armInset;
  for (let deg = 45; deg < 360; deg += 90) {
    const rad = deg * DEG_TO_RAD;
    const mid = armInset + armSpan / 2;
    addBox(
      parts,
      [Math.cos(rad) * mid, Math.sin(rad) * mid, 0],
      [armSpan, 0.16, 0.07],
      deg,
      "arm",
    );
    addBox(
      parts,
      [Math.cos(rad) * ARM_LENGTH, Math.sin(rad) * ARM_LENGTH, 0.035],
      [0.18, 0.18, 0.14],
      deg,
      "motor",
    );
  }

  return parts;
}

/**
 * Append a box to a model under construction.
 * @param {{vertices: number[][], faces: object[]}} parts
 * @param {number[]} center - Box center in body coordinates.
 * @param {number[]} size - [x, y, z] full extents.
 * @param {number} rotationDeg - Rotation about the body z axis.
 * @param {string} part - Part name, for coloring.
 */
function addBox(parts, center, size, rotationDeg, part) {
  const [cx, cy, cz] = center;
  const hx = size[0] / 2;
  const hy = size[1] / 2;
  const hz = size[2] / 2;
  const corners = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ];
  const base = parts.vertices.length;
  for (const corner of corners) {
    const rotated = rotationDeg ? rotateZ(corner, rotationDeg) : corner;
    parts.vertices.push([rotated[0] + cx, rotated[1] + cy, rotated[2] + cz]);
  }
  // Wound counterclockwise seen from outside, so cross products point out.
  const quads = [
    [0, 3, 2, 1], // bottom
    [4, 5, 6, 7], // top
    [0, 1, 5, 4], // -y
    [3, 7, 6, 2], // +y
    [0, 4, 7, 3], // -x
    [1, 2, 6, 5], // +x
  ];
  for (const indices of quads) {
    parts.faces.push({
      part,
      center: [cx, cy, cz],
      indices: indices.map((i) => base + i),
    });
  }
}

/**
 * Outward unit normal of a face (from its first three vertices).
 * @param {number[][]} vertices
 * @param {QuadFace} face
 * @returns {number[]}
 */
export function faceNormal(vertices, face) {
  const a = vertices[face.indices[0]];
  const b = vertices[face.indices[1]];
  const c = vertices[face.indices[2]];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/**
 * Centroid of a face's vertices.
 * @param {number[][]} vertices
 * @param {QuadFace} face
 * @returns {number[]}
 */
export function faceCentroid(vertices, face) {
  const sum = [0, 0, 0];
  for (const i of face.indices) {
    sum[0] += vertices[i][0];
    sum[1] += vertices[i][1];
    sum[2] += vertices[i][2];
  }
  const n = face.indices.length || 1;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

/**
 * Order faces far-to-near for the painter's algorithm.
 * @param {QuadFace[]} faces
 * @param {number[][]} orientedVertices - Model vertices in world coordinates.
 * @param {Camera} camera
 * @returns {QuadFace[]} A new array; the input order is left untouched.
 */
export function sortFacesForPainter(faces, orientedVertices, camera) {
  const depthOf = (face) => project(faceCentroid(orientedVertices, face), camera).depth;
  return faces
    .map((face) => ({ face, depth: depthOf(face) }))
    .sort((a, b) => b.depth - a.depth)
    .map((entry) => entry.face);
}

/**
 * Diffuse shading factor for a face normal under a light direction.
 * @param {number[]} normal - Unit normal in world coordinates.
 * @param {number[]} light - Unit vector pointing toward the light.
 * @returns {number} Multiplier in AMBIENT..1.
 */
export function shadeFactor(normal, light) {
  const d = normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2];
  return AMBIENT + (1 - AMBIENT) * Math.max(0, d);
}

/**
 * Scale a #rrggbb color's channels by a factor, clamping to 0..255.
 * @param {string} hex
 * @param {number} factor
 * @returns {string} The shaded hex color, or the input on no match.
 */
export function shadeColor(hex, factor) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  const channel = (shift) => {
    const scaled = Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * factor)));
    return scaled.toString(16).padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/**
 * Project the recent path of the rotating part as one screen polyline.
 *
 * The traced point is the nose tip for yaw and pitch; the nose sits on the
 * roll axis, so a roll trail traces the wing tip instead. Angles are the
 * controller's accumulated (never wrapped) values, so the path is drawn
 * straight through them.
 * @param {number[]|undefined} trail - Accumulated angles, oldest first.
 * @param {string} axis - "roll" | "pitch" | "yaw"
 * @param {Camera} camera
 * @returns {ScreenPoint[]} The path, oldest point first.
 */
export function trailPoints(trail, axis, camera) {
  if (!Array.isArray(trail)) return [];
  const angles = trail.filter((angle) => typeof angle === "number" && Number.isFinite(angle));
  if (angles.length < 2) return [];
  const anchor = axis === "roll" ? [0, ARM_LENGTH, 0] : [ARM_LENGTH, 0, 0];
  return angles.map((angle) =>
    project(orientPoint(anchor, orientationForAxis(axis, angle)), camera)
  );
}

/**
 * Project the heading arrow: a shaft from the body center past the nose
 * tip, with two chevrons flanking the tip.
 * @param {{heading?: number, roll?: number, pitch?: number}} [orientation]
 * @param {Camera} camera
 * @returns {{base: ScreenPoint, tip: ScreenPoint, left: ScreenPoint,
 *   right: ScreenPoint}}
 */
export function headingArrow(orientation = {}, camera) {
  const nose = orientPoint([1, 0, 0], orientation);
  const reach = ARM_LENGTH * 1.3;
  const tip = [nose[0] * reach, nose[1] * reach, nose[2] * reach];

  const chevron = (offsetDeg) => {
    // Flank the nose in the heading plane, just back from the tip. The nose
    // is already oriented, so only the flank offset is applied here — adding
    // the heading again would swing the chevrons past the tip.
    const dir = rotateZ(nose, offsetDeg);
    const back = 0.09;
    return project(
      [tip[0] + dir[0] * back, tip[1] + dir[1] * back, tip[2] + dir[2] * back],
      camera,
    );
  };

  return {
    base: project([0, 0, 0], camera),
    tip: project(tip, camera),
    left: chevron(150),
    right: chevron(-150),
  };
}
