import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ARM_LENGTH, DEMO_CAMERA, orientPoint, project } from "../../rate-profile/src/quad-3d.js";
import { RotationRenderer } from "../../rate-profile/src/rotation-renderer.js";

Deno.test("RotationRenderer.drawTrail preserves signed accumulated rotation", () => {
  const moves: number[][] = [];
  const lines: number[][] = [];
  const context = {
    lineTo: (...args: number[]) => lines.push(args),
    moveTo: (...args: number[]) => moves.push(args),
    beginPath() {},
    stroke() {},
  };
  const renderer = new RotationRenderer(
    { getContext: () => context } as unknown as HTMLCanvasElement,
  );

  renderer.drawTrail([0, 266.7], "yaw", "#00aaff", 30, 10, 20);

  // The wide step is subdivided, so the trail traces the sweep.
  assertEquals(lines.length, 14);
  assertEquals(moves.length, 14);

  // The trail ends at the 266.7° orientation, not the wrapped -93.3°.
  const end = project(orientPoint([ARM_LENGTH, 0, 0], { heading: 266.7 }), DEMO_CAMERA);
  assertAlmostEquals(lines[13][0], 10 + end.x * 30, 1e-12);
  assertAlmostEquals(lines[13][1], 20 + end.y * 30, 1e-12);

  const start = project(orientPoint([ARM_LENGTH, 0, 0], { heading: 0 }), DEMO_CAMERA);
  assertAlmostEquals(moves[0][0], 10 + start.x * 30, 1e-12);
  assertAlmostEquals(moves[0][1], 20 + start.y * 30, 1e-12);
});
