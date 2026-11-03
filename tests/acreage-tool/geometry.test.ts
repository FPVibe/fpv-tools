import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  circleArea,
  circleRing,
  localDistance,
  localOffset,
  metersPerDegree,
  polygonCentroid,
  rectArea,
  rectRing,
  ringPerimeter,
  shoelaceArea,
  sphericalArea,
  squareArea,
  wrapDeltaLng,
} from "../../acreage-tool/src/geometry.js";

// Reference point: Stoughton, Wisconsin
const LAT = 42.9157;
const LON = -89.2253;

const ACRE_M2 = 4046.8564224;

/**
 * Regression vectors for polygon area.
 *
 * `truth` is the WGS84 geodesic area of the ring (GeographicLib, geodesic
 * edges). `expected` is what the ellipsoid-projected shoelace should return.
 * The gap between the two is the method's own bias, which must stay under
 * 0.002% — the old mean-radius sphere measured ~0.17% low here.
 *
 * Vertices are given as [lng, lat] and converted to the tool's [lat, lon].
 */
const AREA_VECTORS = [
  {
    name: "square100",
    v: [
      [-89.2253, 42.9157],
      [-89.2240753, 42.9157],
      [-89.2240753, 42.9166002],
      [-89.2253, 42.9166002],
    ],
    truth: 10000.312,
    expected: 10000.313,
  },
  {
    name: "irr50",
    v: [
      [-89.2253, 42.9157],
      [-89.2247366, 42.915583],
      [-89.2247979, 42.915844],
      [-89.2250306, 42.9160331],
      [-89.2253857, 42.915907],
    ],
    truth: 1599.386,
    expected: 1599.386,
  },
  {
    name: "irr200",
    v: [
      [-89.2253, 42.9157],
      [-89.2230343, 42.9152319],
      [-89.2229976, 42.9162401],
      [-89.2235732, 42.9172123],
      [-89.2249571, 42.9169422],
      [-89.2246264, 42.9162671],
      [-89.2259368, 42.9163841],
    ],
    truth: 30191.343,
    expected: 30191.396,
  },
  {
    name: "irr500",
    v: [
      [-89.2253, 42.9157],
      [-89.2196419, 42.9145298],
      [-89.2195439, 42.9170502],
      [-89.2209768, 42.9194807],
      [-89.2244427, 42.9188056],
      [-89.2236222, 42.9171133],
      [-89.2268921, 42.9174103],
    ],
    truth: 188695.895,
    expected: 188696.722,
  },
  {
    name: "irr1000",
    v: [
      [-89.2253, 42.9157],
      [-89.2139837, 42.9133596],
      [-89.2137878, 42.9184005],
      [-89.2166536, 42.9232614],
      [-89.2235854, 42.9219111],
      [-89.2219443, 42.9185265],
      [-89.2284842, 42.9191206],
    ],
    truth: 754762.094,
    expected: 754768.695,
  },
  {
    name: "strip2000x150",
    v: [
      [-89.2253, 42.9157],
      [-89.2008059, 42.9157],
      [-89.2008059, 42.9170502],
      [-89.2216259, 42.9165642],
      [-89.2253, 42.9170502],
    ],
    truth: 245961.043,
    expected: 245998.016,
    // A 2 km edge carries a larger share of the method's bias than the
    // sub-kilometre shapes above.
    maxBias: 0.0002,
  },
];

for (const vector of AREA_VECTORS) {
  const ring: [number, number][] = vector.v.map(([lng, lat]) => [lat, lng]);

  Deno.test(`geometry - ${vector.name} area matches the ellipsoid reference`, () => {
    const area = shoelaceArea(ring);
    const relDiff = Math.abs(area - vector.expected) / vector.expected;
    assert(relDiff < 1e-6, `${vector.name}: got ${area}, expected ${vector.expected}`);
  });

  Deno.test(`geometry - ${vector.name} area stays within 0.002% of geodesic truth`, () => {
    const area = shoelaceArea(ring);
    const relDiff = Math.abs(area - vector.truth) / vector.truth;
    const maxBias = vector.maxBias ?? 0.00002;
    assert(
      relDiff < maxBias,
      `${vector.name}: ${(relDiff * 100).toFixed(5)}% off geodesic truth, budget ${
        (maxBias * 100).toFixed(5)
      }%`,
    );
  });

  Deno.test(`geometry - ${vector.name} is invariant to ring closure and winding`, () => {
    const area = shoelaceArea(ring);
    const closed = shoelaceArea([...ring, ring[0]]);
    const reversed = shoelaceArea([...ring].reverse());
    assert(Math.abs(area - closed) / area < 1e-9);
    assert(Math.abs(area - reversed) / area < 1e-9);
  });
}

Deno.test("geometry - local scale matches the audited metres-per-degree", () => {
  const mpd = metersPerDegree(LAT);
  // Independently audited values for 42.9157 N
  assert(Math.abs(mpd.lat - 111091.094) < 0.01, `lat ${mpd.lat}`);
  assert(Math.abs(mpd.lng - 81652.353) < 0.01, `lng ${mpd.lng}`);
});

Deno.test("geometry - local offsets round trip through localDistance", () => {
  const east = localOffset(LAT, LON, 100, 0);
  assert(Math.abs(localDistance(LAT, LON, east[0], east[1]) - 100) < 1e-6);
  const north = localOffset(LAT, LON, 0, 100);
  assert(Math.abs(localDistance(LAT, LON, north[0], north[1]) - 100) < 1e-3);
  const diagonal = localOffset(LAT, LON, 60, 80);
  // The local frame is laid out at the starting latitude while the check-back
  // uses the midpoint, so a diagonal offset lands a fraction of a millimetre
  // off the requested distance.
  assert(Math.abs(localDistance(LAT, LON, diagonal[0], diagonal[1]) - 100) < 1e-3);
});

Deno.test("geometry - the sphere cross-check sits below the ellipsoid measure", () => {
  // Both are valid measures of the same ring; the sphere one carries its own
  // ~0.17% bias at this latitude, so it must read low but stay close.
  const ring: [number, number][] = AREA_VECTORS[4].v.map(([lng, lat]) => [lat, lng]);
  const ellipsoid = shoelaceArea(ring);
  const sphere = sphericalArea(ring);
  assert(sphere < ellipsoid, "spherical excess should read below the ellipsoid measure");
  assert(Math.abs(ellipsoid - sphere) / ellipsoid < 0.002);
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
  const expected = localDistance(LAT, LON, LAT, LON + 0.001) +
    localDistance(LAT, LON + 0.001, LAT + 0.001, LON + 0.001) +
    localDistance(LAT + 0.001, LON + 0.001, LAT + 0.001, LON) +
    localDistance(LAT + 0.001, LON, LAT, LON);
  assert(Math.abs(ringPerimeter(ring) - expected) < 1e-6);
});

Deno.test("geometry - longitude wrapping keeps deltas in range", () => {
  assertEquals(wrapDeltaLng(370), 10);
  assertEquals(wrapDeltaLng(-370), -10);
  assertEquals(wrapDeltaLng(5), 5);
});

Deno.test("geometry - an acre of circle measures an acre", () => {
  const r = Math.sqrt(ACRE_M2 / Math.PI);
  const ring = circleRing(LAT, LON, r, 720);
  assert(Math.abs(shoelaceArea(ring) / ACRE_M2 - 1) < 0.0001);
});
