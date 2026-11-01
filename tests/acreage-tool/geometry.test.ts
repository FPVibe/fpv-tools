import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  circleArea,
  circleRing,
  haversine,
  offsetLatLng,
  polygonCentroid,
  rectArea,
  rectRing,
  ringPerimeter,
  shoelaceArea,
  sphericalArea,
  squareArea,
} from "../../acreage-tool/src/geometry.js";

// Reference point: Stoughton, Wisconsin
const LAT = 42.9157;
const LON = -89.2253;

Deno.test("geometry - haversine matches a known longitude offset", () => {
  // 0.001 deg of longitude at this latitude is 81.434 m
  assert(Math.abs(haversine(LAT, LON, LAT, LON + 0.001) - 81.4344) < 0.01);
  // 0.001 deg of latitude is 111.195 m
  assert(Math.abs(haversine(LAT, LON, LAT + 0.001, LON) - 111.1951) < 0.01);
});

Deno.test("geometry - offset round trips through haversine", () => {
  const east = offsetLatLng(LAT, LON, 100, 0);
  assert(Math.abs(haversine(LAT, LON, east[0], east[1]) - 100) < 1e-6);
  const north = offsetLatLng(LAT, LON, 0, 100);
  assert(Math.abs(haversine(LAT, LON, north[0], north[1]) - 100) < 1e-6);
  const diagonal = offsetLatLng(LAT, LON, 60, 80);
  // A combined east+north offset is laid out on a flat frame, so the
  // great-circle check-back differs by a fraction of a millimetre.
  assert(Math.abs(haversine(LAT, LON, diagonal[0], diagonal[1]) - 100) < 1e-3);
});

Deno.test("geometry - shoelace area of a locally projected ring", () => {
  // A 0.001 deg square ring near Stoughton covers 9055.05 m2
  const ring: [number, number][] = [
    [LAT, LON],
    [LAT, LON + 0.001],
    [LAT + 0.001, LON + 0.001],
    [LAT + 0.001, LON],
    [LAT, LON],
  ];
  assert(Math.abs(shoelaceArea(ring) - 9055.05) < 0.5);
});

Deno.test("geometry - planar and spherical areas agree at parcel scale", () => {
  const ring: [number, number][] = [
    [LAT, LON],
    [LAT, LON + 0.001],
    [LAT + 0.001, LON + 0.001],
    [LAT + 0.001, LON],
    [LAT, LON],
  ];
  const planar = shoelaceArea(ring);
  const spherical = sphericalArea(ring);
  const diffPct = Math.abs(planar - spherical) / planar * 100;
  assert(diffPct < 0.001, `planar vs spherical differ by ${diffPct}%`);
});

Deno.test("geometry - degenerate rings have zero area", () => {
  assertEquals(shoelaceArea([]), 0);
  assertEquals(shoelaceArea([[LAT, LON]]), 0);
  assertEquals(shoelaceArea([[LAT, LON], [LAT + 0.001, LON]]), 0);
  assertEquals(sphericalArea([]), 0);
});

Deno.test("geometry - closed-form shape areas are exact", () => {
  assert(Math.abs(circleArea(100) - Math.PI * 10000) < 1e-9);
  assertEquals(squareArea(40), 1600);
  assertEquals(rectArea(100, 200), 20000);
});

Deno.test("geometry - circle ring approximates the circle area", () => {
  const ring = circleRing(LAT, LON, 100, 72);
  assertEquals(ring.length, 73);
  // An inscribed 72-gon sits 0.127% under the true circle area.
  assert(Math.abs(shoelaceArea(ring) - Math.PI * 10000) / (Math.PI * 10000) < 0.002);
});

Deno.test("geometry - rectangle ring encloses width x height", () => {
  const ring = rectRing(LAT, LON, 100, 200);
  assertEquals(ring.length, 5);
  assert(Math.abs(shoelaceArea(ring) - 20000) / 20000 < 0.001);
});

Deno.test("geometry - polygon centroid lands inside the ring", () => {
  const ring: [number, number][] = [
    [LAT, LON],
    [LAT, LON + 0.002],
    [LAT + 0.001, LON + 0.002],
    [LAT + 0.001, LON],
  ];
  const c = polygonCentroid(ring);
  if (c === null) throw new Error("centroid expected for a 4-point ring");
  assert(Math.abs(c[0] - (LAT + 0.0005)) < 0.00005);
  assert(Math.abs(c[1] - (LON + 0.001)) < 0.00005);
});

Deno.test("geometry - ring perimeter sums the edges", () => {
  const ring: [number, number][] = [
    [LAT, LON],
    [LAT, LON + 0.001],
    [LAT + 0.001, LON + 0.001],
    [LAT + 0.001, LON],
  ];
  const expected = haversine(LAT, LON, LAT, LON + 0.001) +
    haversine(LAT, LON + 0.001, LAT + 0.001, LON + 0.001) +
    haversine(LAT + 0.001, LON + 0.001, LAT + 0.001, LON) +
    haversine(LAT + 0.001, LON, LAT, LON);
  assert(Math.abs(ringPerimeter(ring) - expected) < 1e-6);
});
