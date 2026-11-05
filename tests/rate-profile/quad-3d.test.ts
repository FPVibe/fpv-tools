import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  AMBIENT,
  ARM_LENGTH,
  buildQuadModel,
  DEMO_CAMERA,
  faceCentroid,
  faceNormal,
  headingArrow,
  makeCamera,
  orientationForAxis,
  orientNormal,
  orientPoint,
  orientVertices,
  project,
  projectCircle,
  rotateX,
  rotateY,
  rotateZ,
  shadeColor,
  shadeFactor,
  sortFacesForPainter,
  trailPoints,
} from "../../rate-profile/src/quad-3d.js";

/** Tolerance for floating-point comparisons. */
const EPS = 1e-9;

/** Camera looking straight down: world +x → screen right, +y → screen up. */
const TOP_DOWN = makeCamera({ azimuthDeg: 0, elevationDeg: 90 });

/** The demo's three-quarter camera (front-right, above). */
const THREE_QUARTER = DEMO_CAMERA;

/** Euclidean length of a 3-vector. */
function length(v: number[]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/** Dot product of two 3-vectors. */
function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Subtract b from a (both 3-vectors). */
function sub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// ---------------------------------------------------------------------------
// rotateX / rotateY / rotateZ
// ---------------------------------------------------------------------------

Deno.test("rotateZ - quarter turn maps +x onto +y and back for negative angles", () => {
  const forward = rotateZ([1, 0, 0], 90);
  assertAlmostEquals(forward[0], 0, EPS);
  assertAlmostEquals(forward[1], 1, EPS);
  assertAlmostEquals(forward[2], 0, EPS);

  const back = rotateZ([1, 0, 0], -90);
  assertAlmostEquals(back[0], 0, EPS);
  assertAlmostEquals(back[1], -1, EPS);
});

Deno.test("rotateX - quarter turn maps +y onto +z", () => {
  const p = rotateX([0, 1, 0], 90);
  assertAlmostEquals(p[0], 0, EPS);
  assertAlmostEquals(p[1], 0, EPS);
  assertAlmostEquals(p[2], 1, EPS);
});

Deno.test("rotateY - quarter turn maps +z onto +x", () => {
  const p = rotateY([0, 0, 1], 90);
  assertAlmostEquals(p[0], 1, EPS);
  assertAlmostEquals(p[1], 0, EPS);
  assertAlmostEquals(p[2], 0, EPS);
});

Deno.test("rotations preserve vector length", () => {
  const v = [0.3, -0.7, 0.6];
  for (const rotated of [rotateX(v, 37), rotateY(v, 122), rotateZ(v, 211)]) {
    assertAlmostEquals(length(rotated), length(v), EPS);
  }
});

// ---------------------------------------------------------------------------
// orientPoint / orientationForAxis
// ---------------------------------------------------------------------------

Deno.test("orientPoint - yaw swings the nose around the vertical axis", () => {
  const east = orientPoint([1, 0, 0], { heading: 0, roll: 0, pitch: 0 });
  assertAlmostEquals(east[0], 1, EPS);

  const north = orientPoint([1, 0, 0], { heading: 90, roll: 0, pitch: 0 });
  assertAlmostEquals(north[0], 0, EPS);
  assertAlmostEquals(north[1], 1, EPS);
  assertAlmostEquals(north[2], 0, EPS);
});

Deno.test("orientPoint - roll lifts the left wing out of the ground plane", () => {
  const leftWing = orientPoint([0, 1, 0], { heading: 0, roll: 90, pitch: 0 });
  assertAlmostEquals(leftWing[0], 0, EPS);
  assertAlmostEquals(leftWing[1], 0, EPS);
  assertAlmostEquals(leftWing[2], 1, EPS);
});

Deno.test("orientPoint - pitch moves the nose out of the ground plane", () => {
  const nose = orientPoint([1, 0, 0], { heading: 0, roll: 0, pitch: 90 });
  assertAlmostEquals(nose[0], 0, EPS);
  assertAlmostEquals(nose[1], 0, EPS);
  assertAlmostEquals(nose[2], -1, EPS);
});

Deno.test("orientPoint - roll is applied in the body frame, before yaw", () => {
  // Nose east, rolled 90°: the north wing is straight up. Yawing after that
  // must keep it up (yaw cannot tilt a vertical vector); the reverse order
  // would swing the wing onto the -x axis instead.
  const wing = orientPoint([0, 1, 0], { heading: 90, roll: 90, pitch: 0 });
  assertAlmostEquals(wing[0], 0, EPS);
  assertAlmostEquals(wing[1], 0, EPS);
  assertAlmostEquals(wing[2], 1, EPS);
});

Deno.test("orientPoint - defaults to no rotation", () => {
  const p = orientPoint([1, 2, 3], {});
  assertEquals(p, [1, 2, 3]);
});

Deno.test("orientationForAxis - maps each demo axis onto its body rotation", () => {
  assertEquals(orientationForAxis("yaw", 30), { heading: 30, roll: 0, pitch: 0 });
  assertEquals(orientationForAxis("roll", 30), { heading: 0, roll: 30, pitch: 0 });
  assertEquals(orientationForAxis("pitch", 30), { heading: 0, roll: 0, pitch: 30 });
});

Deno.test("orientationForAxis - unknown axes fall back to yaw", () => {
  assertEquals(orientationForAxis("banana", 12), { heading: 12, roll: 0, pitch: 0 });
});

Deno.test("orientVertices - maps every vertex, leaving the input untouched", () => {
  const vertices = [[1, 0, 0], [0, 1, 0]];
  const oriented = orientVertices(vertices, { heading: 90 });
  assertEquals(oriented.length, 2);
  assertAlmostEquals(oriented[0][1], 1, EPS);
  assertAlmostEquals(oriented[1][0], -1, EPS);
  assertEquals(vertices[0], [1, 0, 0]);
});

Deno.test("orientNormal - rotates a normal by the orientation only", () => {
  const up = orientNormal([0, 0, 1], { heading: 45, roll: 0, pitch: 0 });
  assertAlmostEquals(up[2], 1, EPS); // yaw cannot tilt a vertical normal
  const side = orientNormal([1, 0, 0], { heading: 90 });
  assertAlmostEquals(side[0], 0, EPS);
  assertAlmostEquals(side[1], 1, EPS);
});

// ---------------------------------------------------------------------------
// makeCamera / project
// ---------------------------------------------------------------------------

Deno.test("project - top-down camera maps world axes to screen axes", () => {
  const east = project([1, 0, 0], TOP_DOWN);
  assertEquals(east.x > 0, true); // +x → screen right
  assertAlmostEquals(east.y, 0, EPS);

  const north = project([0, 1, 0], TOP_DOWN);
  assertEquals(north.x, 0);
  assertEquals(north.y < 0, true); // +y → screen up (canvas y grows downward)
});

Deno.test("project - points nearer the camera project larger", () => {
  const near = project([1, 0, 1], TOP_DOWN);
  const far = project([1, 0, -1], TOP_DOWN);
  assertEquals(near.x > far.x, true);
  assertEquals(near.depth < far.depth, true);
});

Deno.test("project - depth is the distance along the view axis", () => {
  const center = project([0, 0, 0], TOP_DOWN);
  assertAlmostEquals(center.depth, TOP_DOWN.distance, EPS);

  const towardCamera = project([0, 0, 1], TOP_DOWN);
  assertAlmostEquals(towardCamera.depth, TOP_DOWN.distance - 1, EPS);
});

Deno.test("project - side camera sees world up as screen up and north as screen right", () => {
  const side = makeCamera({ azimuthDeg: 0, elevationDeg: 0 });
  const up = project([0, 0, 1], side);
  assertAlmostEquals(up.x, 0, EPS);
  assertEquals(up.y < 0, true);
  const north = project([0, 1, 0], side);
  assertEquals(north.x > 0, true);
  assertAlmostEquals(north.y, 0, EPS);
});

Deno.test("project - three-quarter camera keeps the origin at the center", () => {
  const origin = project([0, 0, 0], THREE_QUARTER);
  assertAlmostEquals(origin.x, 0, EPS);
  assertAlmostEquals(origin.y, 0, EPS);
});

// ---------------------------------------------------------------------------
// buildQuadModel
// ---------------------------------------------------------------------------

Deno.test("buildQuadModel - builds an X-layout quad with four motors on the ring", () => {
  const model = buildQuadModel();
  const motors = model.faces.filter((face) => face.part === "motor");
  assertEquals(motors.length, 24); // 6 faces per motor box

  const centers = new Set(
    motors.map((face) => face.center.map((c) => c.toFixed(6)).join(",")),
  );
  assertEquals(centers.size, 4);

  for (const key of centers) {
    const [x, y, z] = key.split(",").map(Number);
    assertAlmostEquals(Math.sqrt(x * x + y * y), ARM_LENGTH, 1e-6);
    assertEquals(Math.abs(z) < 0.2, true); // motors sit in the arm plane
  }
});

Deno.test("buildQuadModel - every face normal is unit length and points outward", () => {
  const model = buildQuadModel();
  assertEquals(model.faces.length, 60); // 10 boxes × 6 faces

  for (const face of model.faces) {
    const normal = faceNormal(model.vertices, face);
    assertAlmostEquals(length(normal), 1, EPS);

    const centroid = faceCentroid(model.vertices, face);
    const outward = sub(centroid, face.center);
    assertEquals(dot(normal, outward) > 0, true);
  }
});

Deno.test("faceCentroid - averages the face's vertices", () => {
  const model = buildQuadModel();
  const face = model.faces[0];
  const centroid = faceCentroid(model.vertices, face);
  const expected = face.indices.map((i) => model.vertices[i]);
  for (let axis = 0; axis < 3; axis++) {
    const mean = expected.reduce((sum, v) => sum + v[axis], 0) / expected.length;
    assertAlmostEquals(centroid[axis], mean, EPS);
  }
});

// ---------------------------------------------------------------------------
// sortFacesForPainter
// ---------------------------------------------------------------------------

Deno.test("sortFacesForPainter - orders faces far-to-near for the painter's algorithm", () => {
  const model = buildQuadModel();
  const oriented = orientVertices(model.vertices, { heading: 20, roll: 10, pitch: -5 });
  const ordered = sortFacesForPainter(model.faces, oriented, THREE_QUARTER);

  assertEquals(ordered.length, model.faces.length);
  for (let i = 1; i < ordered.length; i++) {
    const prevDepth = project(faceCentroid(oriented, ordered[i - 1]), THREE_QUARTER).depth;
    const depth = project(faceCentroid(oriented, ordered[i]), THREE_QUARTER).depth;
    assertEquals(depth <= prevDepth + EPS, true);
  }
});

// ---------------------------------------------------------------------------
// shadeFactor / shadeColor
// ---------------------------------------------------------------------------

Deno.test("shadeFactor - lit faces are bright, unlit faces fall back to ambient", () => {
  const light = [0.55, 0.45, 0.7];
  const unit = 1 / length(light);
  const l = [light[0] * unit, light[1] * unit, light[2] * unit];

  assertAlmostEquals(shadeFactor(l, l), 1, EPS);
  assertAlmostEquals(shadeFactor([-l[0], -l[1], -l[2]], l), AMBIENT, EPS);
  assertAlmostEquals(shadeFactor([0, 0, 1], [1, 0, 0]), AMBIENT, EPS);
});

Deno.test("shadeColor - scales hex channels and passes through non-hex input", () => {
  assertEquals(shadeColor("#ffffff", 1), "#ffffff");
  assertEquals(shadeColor("#ffffff", 0.5), "#808080");
  assertEquals(shadeColor("#000000", 1), "#000000");
  assertEquals(shadeColor("#00aaff", 0), "#000000");
  assertEquals(shadeColor("rgb(1, 2, 3)", 0.5), "rgb(1, 2, 3)");
});

// ---------------------------------------------------------------------------
// projectCircle
// ---------------------------------------------------------------------------

Deno.test("projectCircle - top-down projection keeps the circle circular", () => {
  const points = projectCircle(1, TOP_DOWN, 24);
  assertEquals(points.length, 24);

  const origin = project([0, 0, 0], TOP_DOWN);
  for (const p of points) {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    assertAlmostEquals(Math.sqrt(dx * dx + dy * dy), Math.abs(points[0].x - origin.x), EPS);
  }
});

Deno.test("projectCircle - a tilted camera foreshortens the ground circle", () => {
  const points = projectCircle(1, THREE_QUARTER, 48);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  assertEquals(spanY < spanX, true);
});

// ---------------------------------------------------------------------------
// trailPoints
// ---------------------------------------------------------------------------

Deno.test("trailPoints - projects the nose path as one polyline", () => {
  const points = trailPoints([10, 20, 30], "yaw", THREE_QUARTER);
  assertEquals(points.length, 3);
});

Deno.test("trailPoints - needs at least two samples", () => {
  assertEquals(trailPoints([], "yaw", THREE_QUARTER), []);
  assertEquals(trailPoints([42], "yaw", THREE_QUARTER), []);
  assertEquals(trailPoints(undefined, "yaw", THREE_QUARTER), []);
});

Deno.test("trailPoints - draws large signed deltas as a single path", () => {
  // Accumulated angles never wrap, so a big jump is real rotation, not a
  // heading wrap — the path is drawn straight through it.
  const points = trailPoints([0, 266.7], "yaw", THREE_QUARTER);
  assertEquals(points.length, 2);
  const expected = project(orientPoint([ARM_LENGTH, 0, 0], { heading: 266.7 }), THREE_QUARTER);
  assertAlmostEquals(points[1].x, expected.x, EPS);
  assertAlmostEquals(points[1].y, expected.y, EPS);
});

Deno.test("trailPoints - roll trails climb off the ground plane", () => {
  // The nose sits on the roll axis, so a roll trail traces the wing tip.
  const roll = trailPoints([0, 45, 90], "roll", THREE_QUARTER);
  assertEquals(roll.length, 3);

  const ground = project(orientPoint([0, ARM_LENGTH, 0], { roll: 0 }), THREE_QUARTER);
  const raised = project(orientPoint([0, ARM_LENGTH, 0], { roll: 90 }), THREE_QUARTER);
  assertEquals(raised.y < ground.y - 0.3, true);
  assertAlmostEquals(roll[2].x, raised.x, EPS);
  assertAlmostEquals(roll[2].y, raised.y, EPS);
});

Deno.test("trailPoints - yaw trails stay on the ground ring", () => {
  const yaw = trailPoints([0, 45, 90], "yaw", THREE_QUARTER);
  const expected = project(orientPoint([ARM_LENGTH, 0, 0], { heading: 90 }), THREE_QUARTER);
  assertAlmostEquals(yaw[2].x, expected.x, EPS);
  assertAlmostEquals(yaw[2].y, expected.y, EPS);
});

// ---------------------------------------------------------------------------
// headingArrow
// ---------------------------------------------------------------------------

Deno.test("headingArrow - points along the nose and extends past the ring", () => {
  const arrow = headingArrow({ heading: 0, roll: 0, pitch: 0 }, TOP_DOWN);
  assertEquals(arrow.tip.x > arrow.base.x, true); // nose east → screen right
  assertAlmostEquals(arrow.base.y, 0, EPS);

  const ring = projectCircle(ARM_LENGTH, TOP_DOWN, 4)[0];
  assertEquals(arrow.tip.x > ring.x, true); // tip sits outside the reference ring
});

Deno.test("headingArrow - follows the heading around the circle", () => {
  const arrow = headingArrow({ heading: 90, roll: 0, pitch: 0 }, TOP_DOWN);
  assertEquals(arrow.tip.y < 0, true); // nose north → screen up
});

Deno.test("headingArrow - chevrons sit at the tip, flanking the shaft", () => {
  const arrow = headingArrow({ heading: 0, roll: 0, pitch: 0 }, THREE_QUARTER);
  const tipToLeft = Math.hypot(arrow.left.x - arrow.tip.x, arrow.left.y - arrow.tip.y);
  const tipToRight = Math.hypot(arrow.right.x - arrow.tip.x, arrow.right.y - arrow.tip.y);
  const shaft = Math.hypot(arrow.tip.x - arrow.base.x, arrow.tip.y - arrow.base.y);
  assertEquals(tipToLeft > 0, true);
  assertEquals(tipToRight > 0, true);
  assertEquals(tipToLeft < shaft, true);
  assertEquals(tipToRight < shaft, true);
});
