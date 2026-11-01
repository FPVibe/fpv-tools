import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  decodeShapeEntry,
  decodeShapes,
  encodeShape,
  encodeShapes,
  shareUrl,
} from "../../acreage-tool/src/share.js";

const CIRCLE = { type: "circle", lat: 42.9157, lon: -89.22525, r: 481.53 };
const SQUARE = { type: "square", lat: 42.9157, lon: -89.22525, s: 201.17 };
const RECT = { type: "rect", lat: 42.9157, lon: -89.22525, w: 160, h: 120 };
const POLYGON = {
  type: "polygon",
  pts: [
    [42.9157, -89.22525],
    [42.92, -89.23],
    [42.918, -89.23],
  ],
};

Deno.test("share - a circle round trips", () => {
  const decoded = decodeShapes("#" + encodeShape(CIRCLE, "ac"));
  if (decoded === null) throw new Error("expected a decoded payload");
  assertEquals(decoded.shapes.length, 1);
  const shape = decoded.shapes[0];
  assertEquals(shape.type, "circle");
  assert(Math.abs(shape.lat - CIRCLE.lat) < 1e-6);
  assert(Math.abs(shape.lon - CIRCLE.lon) < 1e-6);
  assert(Math.abs(shape.r - CIRCLE.r) < 0.01);
  assertEquals(decoded.areaUnit, "ac");
});

Deno.test("share - every shape type round trips", () => {
  for (const original of [CIRCLE, SQUARE, RECT, POLYGON]) {
    const decoded = decodeShapes("#" + encodeShape(original, "ac"));
    if (decoded === null) throw new Error(`expected ${original.type} to decode`);
    const shape = decoded.shapes[0];
    assertEquals(shape.type, original.type);
    if (original.type === "polygon") {
      assertEquals(shape.pts.length, original.pts.length);
      for (let i = 0; i < shape.pts.length; i++) {
        assert(Math.abs(shape.pts[i][0] - original.pts[i][0]) < 1e-6);
        assert(Math.abs(shape.pts[i][1] - original.pts[i][1]) < 1e-6);
      }
    }
  }
});

Deno.test("share - several shapes travel in one link", () => {
  const payload = encodeShapes([CIRCLE, POLYGON], "ha");
  const decoded = decodeShapes("#" + payload);
  if (decoded === null) throw new Error("expected a decoded payload");
  assertEquals(decoded.shapes.length, 2);
  assertEquals(decoded.shapes[0].type, "circle");
  assertEquals(decoded.shapes[1].type, "polygon");
  assertEquals(decoded.areaUnit, "ha");
});

Deno.test("share - the area unit travels with the link", () => {
  for (const unit of ["ac", "ha", "m2", "ft2", "km2", "mi2"]) {
    const decoded = decodeShapes("#" + encodeShape(CIRCLE, unit));
    if (decoded === null) throw new Error("expected a decoded payload");
    assertEquals(decoded.areaUnit, unit);
  }
});

Deno.test("share - links stay readable and URL safe", () => {
  const payload = encodeShape(CIRCLE, "ac");
  assert(!payload.includes(" "), "no spaces in a link");
  assert(payload.includes("circle,"), "type should stay legible");
  assert(!payload.includes("%2C"), "commas stay literal");
});

Deno.test("share - a percent-encoded payload still decodes", () => {
  const decoded = decodeShapes("#s=circle%2C42.9157%2C-89.22525%2C481.53&u=ac");
  if (decoded === null) throw new Error("expected a decoded payload");
  assertEquals(decoded.shapes[0].type, "circle");
  assertEquals(decoded.areaUnit, "ac");
});

Deno.test("share - shareUrl replaces any existing hash", () => {
  const url = shareUrl("https://example.com/tool/index.html#old=stuff", [CIRCLE], "ac");
  assert(url.startsWith("https://example.com/tool/index.html#"));
  assert(!url.includes("old=stuff"));
  assert(url.includes("circle,"));
});

Deno.test("share - malformed payloads are rejected outright", () => {
  const bad = [
    "#",
    "#s=",
    "#u=ac",
    "#s=blob,42.9,-89.2,10",
    "#s=circle,42.9,-89.2", // missing radius
    "#s=circle,42.9,-89.2,10,20", // too many numbers
    "#s=circle,42.9,-89.2,0", // zero radius
    "#s=circle,42.9,-89.2,-5", // negative radius
    "#s=circle,91,-89.2,10", // latitude out of range
    "#s=circle,42.9,-181,10", // longitude out of range
    "#s=circle,42.9abc,-89.2,10", // trailing junk in a number
    "#s=circle,42.9,-89.2,10junk", // trailing junk in the radius
    "#s=square,42.9,-89.2,0",
    "#s=rect,42.9,-89.2,10,0",
    "#s=polygon,42.9,-89.2", // two points only
    "#s=polygon,42.9,-89.2,42.91,-89.21,42.92", // odd coordinate count
    "#s=circle,42.9,-89.2,10&s=blob,1,2,3", // one bad shape spoils the payload
  ];
  for (const payload of bad) {
    assertEquals(decodeShapes(payload), null, `should reject: ${payload}`);
  }
});

Deno.test("share - an unknown area unit is dropped rather than trusted", () => {
  const decoded = decodeShapes("#s=circle,42.9,-89.2,10&u=bogus");
  if (decoded === null) throw new Error("expected a decoded payload");
  assertEquals(decoded.areaUnit, null);
});

Deno.test("share - an empty hash decodes to null", () => {
  assertEquals(decodeShapes(""), null);
  assertEquals(decodeShapes("#"), null);
  assertEquals(decodeShapes(undefined), null);
});

Deno.test("share - a single shape entry decodes on its own", () => {
  const shape = decodeShapeEntry("rect,42.9,-89.2,10,20");
  if (shape === null) throw new Error("expected a decoded shape");
  assertEquals(shape.type, "rect");
  assertEquals(shape.w, 10);
  assertEquals(shape.h, 20);
  assertEquals(decodeShapeEntry("rect,42.9,-89.2,10"), null);
});
