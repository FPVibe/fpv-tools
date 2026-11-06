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
  // Demo yaw is negated, so the accumulated +266.7° reads as heading -266.7°.
  const end = project(orientPoint([ARM_LENGTH, 0, 0], { heading: -266.7 }), DEMO_CAMERA);
  assertAlmostEquals(lines[13][0], 10 + end.x * 30, 1e-12);
  assertAlmostEquals(lines[13][1], 20 + end.y * 30, 1e-12);

  const start = project(orientPoint([ARM_LENGTH, 0, 0], { heading: 0 }), DEMO_CAMERA);
  assertAlmostEquals(moves[0][0], 10 + start.x * 30, 1e-12);
  assertAlmostEquals(moves[0][1], 20 + start.y * 30, 1e-12);
});

Deno.test("RotationRenderer.draw paints one cell per supplied profile", () => {
  // The app supports five profiles; dropping the extras would desync the
  // canvas from the checked controls and the readout cards.
  const texts: string[] = [];
  const context = new Proxy({} as Record<string, unknown>, {
    get: (_target, prop: string) =>
      prop === "measureText" ? () => ({ width: 40 }) : (...args: unknown[]) => {
        if (prop === "fillText") texts.push(String(args[0]));
      },
  });
  const renderer = new RotationRenderer({
    width: 420,
    height: 420,
    getContext: () => context,
  } as unknown as HTMLCanvasElement);

  const quads = ["A", "B", "C", "D", "E"].map((label, i) => ({
    label,
    color: `#00000${i}`,
  }));
  renderer.setQuads(quads);
  assertEquals(renderer.quads.length, 5);

  renderer.draw(quads.map(() => ({ angleDeg: 0, axis: "yaw", rate: 100 })));
  // One rate readout per cell, plus one legend label per quad.
  assertEquals(texts.filter((t) => t.includes("°/s")).length, 5);
  for (const label of ["A", "B", "C", "D", "E"]) {
    assertEquals(texts.includes(label), true);
  }
});
