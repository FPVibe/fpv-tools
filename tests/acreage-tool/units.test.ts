import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  AREA_UNITS,
  circleRadiusForArea,
  formatArea,
  formatLength,
  fromMeters,
  fromSquareMeters,
  LEN_UNITS,
  squareSideForArea,
  toMeters,
  toSquareMeters,
} from "../../acreage-tool/src/units.js";

const ACRE_M2 = 4046.8564224;

Deno.test("units - length conversions to metres are exact", () => {
  assertEquals(toMeters(1, "m"), 1);
  assertEquals(toMeters(1, "km"), 1000);
  assertEquals(toMeters(1, "ft"), 0.3048);
  assertEquals(toMeters(1, "yd"), 0.9144);
  assertEquals(toMeters(1, "mi"), 1609.344);
});

Deno.test("units - length conversions round trip", () => {
  for (const unit of Object.keys(LEN_UNITS)) {
    assertEquals(fromMeters(toMeters(123.456, unit), unit), 123.456);
  }
});

Deno.test("units - area conversions to square metres are exact", () => {
  assertEquals(toSquareMeters(1, "ac"), ACRE_M2);
  assertEquals(toSquareMeters(1, "ha"), 10000);
  assertEquals(toSquareMeters(1, "m2"), 1);
  assertEquals(toSquareMeters(1, "ft2"), 0.09290304);
  assertEquals(toSquareMeters(1, "km2"), 1e6);
  assertEquals(toSquareMeters(1, "mi2"), 2589988.110336);
});

Deno.test("units - area conversions round trip", () => {
  for (const unit of Object.keys(AREA_UNITS)) {
    assertEquals(fromSquareMeters(toSquareMeters(7.5, unit), unit), 7.5);
  }
});

Deno.test("units - circle radius for a target acreage", () => {
  // 5 acres is a 80.254 m radius circle, 180 acres a 481.527 m radius circle
  assert(Math.abs(circleRadiusForArea(5 * ACRE_M2) - 80.2544) < 0.001);
  assert(Math.abs(circleRadiusForArea(180 * ACRE_M2) - 481.5265) < 0.001);
  assert(Math.abs(circleRadiusForArea(1 * ACRE_M2) - 35.8909) < 0.001);
});

Deno.test("units - square side for a target acreage", () => {
  assert(Math.abs(squareSideForArea(10 * ACRE_M2) - 201.168) < 0.001);
  assert(Math.abs(squareSideForArea(1 * ACRE_M2) - 63.6149) < 0.001);
});

Deno.test("units - area formatting", () => {
  assertEquals(formatArea(5 * ACRE_M2, "ac"), "5.00 acres");
  assertEquals(formatArea(5 * ACRE_M2, "ha"), "2.02 hectares");
  assertEquals(formatArea(5 * ACRE_M2, "ft2"), "217,800 ft²");
  assertEquals(formatArea(5 * ACRE_M2, "m2"), "20,234 m²");
  assertEquals(formatArea(5 * ACRE_M2, "mi2"), "0.01 mi²");
});

Deno.test("units - length formatting", () => {
  assertEquals(formatLength(95, "ft"), "312 ft");
  assertEquals(formatLength(95, "m"), "95.0 m");
  assertEquals(formatLength(1609.344, "mi"), "1.00 mi");
});
