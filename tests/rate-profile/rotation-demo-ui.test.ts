import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { RotationDemo } from "../../rate-profile/src/rotation-demo-ui.js";

function makeProfile(name: string) {
  return { name };
}

function makeDemo(profile: { name: string }) {
  const label = {
    checkbox: {},
    lastChild: { nodeValue: `Profile A — ${profile.name}` },
  };
  const demo = Object.create(RotationDemo.prototype);
  Object.assign(demo, {
    builtProfileCount: 1,
    dirty: false,
    lastTimestamp: null,
    profileRefs: [profile],
    profilesGetter: () => [profile],
    rebuildFrames() {},
    renderFrame() {},
    selected: new Set([0]),
    syncReadouts() {},
    togglesWrap: {
      children: [label],
      replaceChildren() {},
    },
    elapsed: 2,
    script: { timeline: [], duration: 1 },
    scriptStart: 1,
    stick: 1,
    prevStick: 1,
    trails: new Map([[0, [0, 30]]]),
    lastAngle: new Map([[0, 30]]),
    lastRate: new Map([[0, 100]]),
    readoutKey: "0",
  });
  return { demo, label };
}

Deno.test("syncProfiles updates a renamed profile label without replacing its controls", () => {
  const profile = makeProfile("Old name");
  const { demo, label } = makeDemo(profile);
  const checkbox = label.checkbox;

  profile.name = "New name";
  demo.syncProfiles([profile]);

  assertEquals(label.lastChild.nodeValue, "Profile A — New name");
  assertStrictEquals(demo.togglesWrap.children[0], label);
  assertStrictEquals(demo.togglesWrap.children[0].checkbox, checkbox);
  assertEquals(demo.lastAngle.get(0), 30);
});

Deno.test("paused tick detects profile renames", () => {
  const profile = makeProfile("Old name");
  const { demo, label } = makeDemo(profile);
  profile.name = "New name";
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

  assertEquals(label.lastChild.nodeValue, "Profile A — New name");
});

Deno.test("syncProfiles resets comparison state when a profile is replaced", () => {
  const oldProfile = makeProfile("Old name");
  const { demo } = makeDemo(oldProfile);
  const replacement = makeProfile("New name");

  demo.syncProfiles([replacement]);

  assertEquals(demo.elapsed, 0);
  assertEquals(demo.script, null);
  assertEquals(demo.scriptStart, 0);
  assertEquals(demo.stick, 0);
  assertEquals(demo.prevStick, 0);
  assertEquals(demo.trails.size, 0);
  assertEquals(demo.lastAngle.size, 0);
  assertEquals(demo.lastRate.size, 0);
  assertEquals(demo.profileRefs[0], replacement);
});
