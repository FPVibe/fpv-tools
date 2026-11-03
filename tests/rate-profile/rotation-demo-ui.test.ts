import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { RotationDemo } from "../../rate-profile/src/rotation-demo-ui.js";

function makePausedDemo(profileName: string) {
  const textNode = { textContent: `Profile A — ${profileName}` };
  const checkbox = {};
  const label = { lastChild: textNode, checkbox };
  const demo = Object.create(RotationDemo.prototype);
  Object.assign(demo, {
    builtProfileCount: 1,
    dirty: false,
    lastTimestamp: null,
    profilesGetter: () => [{ name: profileName }],
    rebuildFrames() {},
    renderFrame() {},
    running: false,
    selected: new Set([0]),
    syncReadouts() {},
    togglesWrap: { children: [label] },
  });
  return { checkbox, demo, label, textNode };
}

Deno.test("syncProfiles updates renamed labels without replacing controls", () => {
  const { checkbox, demo, label, textNode } = makePausedDemo("Old name");

  demo.syncProfiles([{ name: "New name" }]);

  assertEquals(textNode.textContent, "Profile A — New name");
  assertStrictEquals(demo.togglesWrap.children[0], label);
  assertStrictEquals(demo.togglesWrap.children[0].checkbox, checkbox);
});

Deno.test("paused tick detects profile renames", () => {
  const { demo, textNode } = makePausedDemo("Old name");
  demo.profilesGetter = () => [{ name: "New name" }];
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;

  try {
    demo.tick(0);
  } finally {
    if (previousRequestAnimationFrame) {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    } else {
      delete globalThis.requestAnimationFrame;
    }
  }

  assertEquals(textNode.textContent, "Profile A — New name");
});
