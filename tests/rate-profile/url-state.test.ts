import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildShareUrl,
  decodeProfile,
  decodeProfiles,
  encodeProfile,
  encodeProfiles,
} from "../../rate-profile/src/url-state.js";

const sampleProfile = {
  name: "My Profile",
  ratesType: "ACTUAL",
  rates: {
    roll: { center: 70, maxRate: 670, expo: 0 },
    pitch: { center: 100, maxRate: 800, expo: 25 },
    yaw: { center: 90, maxRate: 500, expo: 10 },
  },
  throttle: { mid: 50, expo: 0, limitType: "OFF", limitPercent: 100 },
};

Deno.test("encode/decode round-trips an ACTUAL profile", () => {
  const decoded = decodeProfile(encodeProfile(sampleProfile));
  assertEquals(decoded, sampleProfile);
});

Deno.test("round-trips a BETAFLIGHT profile (super rate values)", () => {
  const bf = {
    name: "BF",
    ratesType: "BETAFLIGHT",
    rates: {
      roll: { center: 120, maxRate: 70, expo: 30 },
      pitch: { center: 120, maxRate: 70, expo: 30 },
      yaw: { center: 120, maxRate: 70, expo: 30 },
    },
    throttle: { mid: 30, expo: 20, limitType: "SCALE", limitPercent: 80 },
  };
  assertEquals(decodeProfile(encodeProfile(bf)), bf);
});

Deno.test("special characters in names survive round-trip", () => {
  const p = { ...sampleProfile, name: "D7 — 2S «race»: #1/2" };
  assertEquals(decodeProfile(encodeProfile(p)), p);
});

Deno.test("decodeProfile returns null on wrong field count", () => {
  assertStrictEquals(decodeProfile("a:b:c"), null);
  assertStrictEquals(decodeProfile(""), null);
});

Deno.test("decodeProfile returns null on non-integer fields", () => {
  const bad = "X:ACTUAL:abc:670:0:70:670:0:70:670:0:50:0:OFF:100";
  assertStrictEquals(decodeProfile(bad), null);
});

Deno.test("decodeProfile returns null on unsupported ratesType", () => {
  const bad = "X:QUICK:70:670:0:70:670:0:70:670:0:50:0:OFF:100";
  assertStrictEquals(decodeProfile(bad), null);
});

Deno.test("decodeProfile normalizes unknown limitType to OFF", () => {
  const decoded = decodeProfile(
    encodeProfile({ ...sampleProfile, throttle: { ...sampleProfile.throttle, limitType: "BOGUS", limitPercent: 100 } }),
  );
  assertEquals(decoded.throttle.limitType, "OFF");
});

Deno.test("decodeProfile clamps values to slider ranges (ACTUAL)", () => {
  const decoded = decodeProfile("X:ACTUAL:999:9999:150:70:-50:25:90:500:10:200:-5:OFF:10");
  assertEquals(decoded.rates.roll.center, 255);
  assertEquals(decoded.rates.roll.maxRate, 2000);
  assertEquals(decoded.rates.roll.expo, 100);
  assertEquals(decoded.rates.pitch.maxRate, 200); // ACTUAL floor
  assertEquals(decoded.throttle.mid, 100);
  assertEquals(decoded.throttle.expo, 0);
  assertEquals(decoded.throttle.limitPercent, 25);
});

Deno.test("decodeProfile clamps BETAFLIGHT maxRate to 0-100", () => {
  const decoded = decodeProfile("X:BETAFLIGHT:100:180:25:100:-3:25:90:70:10:50:0:OFF:100");
  assertEquals(decoded.rates.roll.maxRate, 100);
  assertEquals(decoded.rates.pitch.maxRate, 0);
});

Deno.test("decodeProfiles parses comma-separated tokens and skips invalid ones", () => {
  const hash = encodeProfiles([sampleProfile, { ...sampleProfile, name: "Two" }]) +
    ",garbage:token";
  const decoded = decodeProfiles(hash);
  assertEquals(decoded.length, 2);
  assertEquals(decoded[0].name, "My Profile");
  assertEquals(decoded[1].name, "Two");
});

Deno.test("decodeProfiles tolerates a leading '#' and returns [] for empty", () => {
  assertEquals(decodeProfiles(""), []);
  const hash = encodeProfiles([sampleProfile]);
  assertEquals(decodeProfiles(`#${hash}`), [sampleProfile]);
});

Deno.test("buildShareUrl builds base + hash", () => {
  const url = buildShareUrl([sampleProfile], "https://fpvibe.github.io/fpv-tools/rate-profile/");
  assertEquals(
    url,
    `https://fpvibe.github.io/fpv-tools/rate-profile/#${encodeProfiles([sampleProfile])}`,
  );
});
