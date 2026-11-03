import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { RotationRenderer } from "../../rate-profile/src/rotation-renderer.js";

Deno.test("RotationRenderer.drawTrail preserves signed accumulated rotation", () => {
  const arcs: number[][] = [];
  const context = {
    arc: (...args: number[]) => arcs.push(args),
    beginPath() {},
    stroke() {},
  };
  const renderer = new RotationRenderer(
    { getContext: () => context } as unknown as HTMLCanvasElement,
  );

  renderer.drawTrail([0, 266.7], 10, 20, 30, "#00aaff");

  assertEquals(arcs.length, 1);
  assertAlmostEquals(arcs[0][4], 266.7 * Math.PI / 180, 1e-12);
  assertEquals(arcs[0][5], false);
});
