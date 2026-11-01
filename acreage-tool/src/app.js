/**
 * Acreage & Shape Tool — map interaction layer.
 *
 * Wires Leaflet up to the pure geometry/units modules: the user picks a point
 * on the map, chooses a shape and a size, then drags handles to move and
 * resize it while the enclosed area updates live.
 *
 * Leaflet itself is vendored in ../vendor/leaflet.js and loaded as a classic
 * script, so this module picks it up from the global scope.
 */

import {
  circleArea,
  circleRing,
  localDistance,
  localOffset,
  polygonCentroid,
  rectArea,
  rectRing,
  ringPerimeter,
  shoelaceArea,
  sphericalArea,
  squareArea,
} from "./geometry.js";
import {
  AREA_UNIT_NAMES,
  LEN_UNIT_NAMES,
  formatArea,
  formatLength,
  fromMeters,
  toMeters,
} from "./units.js";

const PALETTE = ["#e8710a", "#2e8b57", "#1f6fb4", "#b02a2a", "#7b4fa8", "#0f7f8f", "#a5820b", "#b03a6a"];

/** Base layers. Tile requests are runtime-only — they are not precached. */
const TILES = {
  topo: {
    label: "OpenTopoMap",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenTopoMap (CC-BY-SA) &middot; &copy; OpenStreetMap contributors",
  },
  carto: {
    label: "Carto Light",
    url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  },
  esri: {
    label: "Esri satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
  },
  osm: {
    label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
};

const TYPE_NAME = { circle: "Circle", square: "Square", rect: "Rectangle", polygon: "Polygon" };

const STORAGE_KEY = "acreage-tool-state";

/**
 * Build the tool.
 *
 * @returns {object} the tool API (also exposed on window for debugging)
 */
export function createAcreageTool() {
  const state = {
    shapes: [],
    nextId: 1,
    selected: null,
    mode: "idle",
    type: "circle",
    lenUnit: "ft",
    areaUnit: "ac",
    colorIdx: 0,
  };
  const layers = new Map();
  let map = null;
  let tileLayer = null;
  let preview = null;

  const el = (id) => document.getElementById(id);

  /* ------------------------------------------------------------- geometry */

  function computeShape(sh) {
    if (sh.type === "circle") {
      sh.areaM2 = circleArea(sh.r);
      sh.perimM = 2 * Math.PI * sh.r;
      sh.ring = circleRing(sh.lat, sh.lon, sh.r);
    } else if (sh.type === "square") {
      sh.areaM2 = squareArea(sh.s);
      sh.perimM = 4 * sh.s;
      sh.ring = rectRing(sh.lat, sh.lon, sh.s, sh.s);
    } else if (sh.type === "rect") {
      sh.areaM2 = rectArea(sh.w, sh.h);
      sh.perimM = 2 * (sh.w + sh.h);
      sh.ring = rectRing(sh.lat, sh.lon, sh.w, sh.h);
    } else {
      sh.areaM2 = shoelaceArea(sh.pts);
      sh.perimM = ringPerimeter(sh.pts);
      sh.ring = sh.pts;
      const centroid = polygonCentroid(sh.pts);
      if (centroid) {
        sh.lat = centroid[0];
        sh.lon = centroid[1];
      }
      // Cross-check against the spherical-excess measure. The two differ by
      // roughly 0.17% at Wisconsin latitudes because one is an ellipsoid
      // measure and the other a sphere measure; anything beyond that points
      // at a degenerate ring.
      const spherical = sphericalArea(sh.pts);
      if (sh.areaM2 > 0 && Math.abs(spherical - sh.areaM2) / sh.areaM2 > 0.005) {
        console.warn("acreage-tool: area cross-check diverged", sh.areaM2, spherical);
      }
    }
    return sh;
  }

  function sizeText(sh) {
    if (sh.type === "circle") return "r " + formatLength(sh.r, state.lenUnit);
    if (sh.type === "square") return "side " + formatLength(sh.s, state.lenUnit);
    if (sh.type === "rect") {
      return formatLength(sh.w, state.lenUnit) + " × " + formatLength(sh.h, state.lenUnit);
    }
    return sh.pts.length + " points";
  }

  /* ---------------------------------------------------------------- shapes */

  function newShape(type, lat, lon, color) {
    const col = color || PALETTE[state.colorIdx++ % PALETTE.length];
    const sh = { id: state.nextId++, type, color: col, visible: true, lat, lon };
    if (type === "circle") {
      sh.r = toMeters(parseFloat(el("in-radius").value) || 0, state.lenUnit);
    }
    if (type === "square") {
      sh.s = toMeters(parseFloat(el("in-side").value) || 0, state.lenUnit);
    }
    if (type === "rect") {
      sh.w = toMeters(parseFloat(el("in-w").value) || 0, state.lenUnit);
      sh.h = toMeters(parseFloat(el("in-h").value) || 0, state.lenUnit);
    }
    if (type === "polygon") sh.pts = [];
    return computeShape(sh);
  }

  function addShape(sh) {
    computeShape(sh);
    if (!state.shapes.includes(sh)) state.shapes.push(sh);
    const group = L.layerGroup().addTo(map);
    const geometry = L.polygon(sh.ring.map((p) => L.latLng(p[0], p[1])), {
      color: sh.color,
      weight: 2,
      fillColor: sh.color,
      fillOpacity: 0.12,
    });
    geometry.addTo(group);
    geometry.on("click", (e) => {
      if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
      select(sh.id);
    });
    layers.set(sh.id, { group, geometry, handles: [] });
    select(sh.id);
  }

  function removeShape(id) {
    const entry = layers.get(id);
    if (entry) map.removeLayer(entry.group);
    layers.delete(id);
    state.shapes = state.shapes.filter((s) => s.id !== id);
    if (state.selected === id) state.selected = null;
    refresh();
  }

  function select(id) {
    state.selected = id;
    clearHandles();
    const sh = state.shapes.find((s) => s.id === id);
    if (!sh) {
      refresh();
      return;
    }
    buildHandles(sh);
    fillInputsFromShape(sh);
    refresh();
  }

  /* --------------------------------------------------------------- handles */

  function clearHandles() {
    for (const entry of layers.values()) {
      for (const h of entry.handles) map.removeLayer(h.marker);
      entry.handles.length = 0;
    }
  }

  function handleMarker(latlng, cls, onDrag) {
    const marker = L.marker(latlng, {
      draggable: true,
      icon: L.divIcon({
        className: "handle " + (cls || ""),
        iconSize: [17, 17],
        iconAnchor: [8, 8],
      }),
    }).addTo(map);
    marker.on("drag", () => onDrag(marker.getLatLng()));
    marker.on("dragend", () => save());
    return marker;
  }

  function buildHandles(sh) {
    const entry = layers.get(sh.id);
    if (!entry) return;
    const centre = L.latLng(sh.lat, sh.lon);

    if (sh.type === "polygon") {
      // The centre handle translates every vertex by the drag delta.
      let grab = null;
      const marker = handleMarker(centre, "", (ll) => {
        if (!grab) grab = { lat: sh.lat, lon: sh.lon };
        const dLat = ll.lat - grab.lat;
        const dLon = ll.lon - grab.lon;
        sh.pts = sh.pts.map((p) => [p[0] + dLat, p[1] + dLon]);
        recomputeAndRender(sh);
      });
      marker.on("dragend", () => {
        grab = null;
        save();
      });
      entry.handles.push({ marker, kind: "centre" });
    } else {
      const marker = handleMarker(centre, "", (ll) => {
        sh.lat = ll.lat;
        sh.lon = ll.lng;
        recomputeAndRender(sh);
      });
      entry.handles.push({ marker, kind: "centre" });
    }

    if (sh.type === "circle") {
      const edge = localOffset(sh.lat, sh.lon, sh.r, 0);
      const marker = handleMarker(L.latLng(edge[0], edge[1]), "edge", (ll) => {
        sh.r = localDistance(sh.lat, sh.lon, ll.lat, ll.lng);
        recomputeAndRender(sh);
      });
      entry.handles.push({ marker, kind: "edge" });
    } else if (sh.type === "square") {
      const corner = localOffset(sh.lat, sh.lon, sh.s / 2, sh.s / 2);
      const marker = handleMarker(L.latLng(corner[0], corner[1]), "edge", (ll) => {
        const dx = localDistance(sh.lat, sh.lon, ll.lat, sh.lon);
        const dy = localDistance(sh.lat, sh.lon, sh.lat, ll.lng);
        sh.s = 2 * Math.max(dx, dy);
        recomputeAndRender(sh);
      });
      entry.handles.push({ marker, kind: "edge" });
    } else if (sh.type === "rect") {
      const east = localOffset(sh.lat, sh.lon, sh.w / 2, 0);
      const markerE = handleMarker(L.latLng(east[0], east[1]), "edge", (ll) => {
        sh.w = 2 * localDistance(sh.lat, sh.lon, ll.lat, sh.lon);
        recomputeAndRender(sh);
      });
      entry.handles.push({ marker: markerE, kind: "edge" });
      const north = localOffset(sh.lat, sh.lon, 0, sh.h / 2);
      const markerN = handleMarker(L.latLng(north[0], north[1]), "vert", (ll) => {
        sh.h = 2 * localDistance(sh.lat, sh.lon, sh.lat, ll.lng);
        recomputeAndRender(sh);
      });
      entry.handles.push({ marker: markerN, kind: "vert" });
    } else if (sh.type === "polygon") {
      sh.pts.forEach((p, i) => {
        const marker = handleMarker(L.latLng(p[0], p[1]), "", (ll) => {
          sh.pts[i] = [ll.lat, ll.lng];
          recomputeAndRender(sh);
        });
        entry.handles.push({ marker, kind: "vertex", idx: i });
      });
    }
  }

  function repositionHandles(sh) {
    const entry = layers.get(sh.id);
    if (!entry) return;
    for (const h of entry.handles) {
      if (h.kind === "centre") {
        h.marker.setLatLng(L.latLng(sh.lat, sh.lon));
      } else if (h.kind === "edge" && sh.type === "circle") {
        const p = localOffset(sh.lat, sh.lon, sh.r, 0);
        h.marker.setLatLng(L.latLng(p[0], p[1]));
      } else if (h.kind === "edge" && sh.type === "square") {
        const p = localOffset(sh.lat, sh.lon, sh.s / 2, sh.s / 2);
        h.marker.setLatLng(L.latLng(p[0], p[1]));
      } else if (h.kind === "edge" && sh.type === "rect") {
        const p = localOffset(sh.lat, sh.lon, sh.w / 2, 0);
        h.marker.setLatLng(L.latLng(p[0], p[1]));
      } else if (h.kind === "vert" && sh.type === "rect") {
        const p = localOffset(sh.lat, sh.lon, 0, sh.h / 2);
        h.marker.setLatLng(L.latLng(p[0], p[1]));
      } else if (h.kind === "vertex") {
        const p = sh.pts[h.idx];
        h.marker.setLatLng(L.latLng(p[0], p[1]));
      }
    }
  }

  function recomputeAndRender(sh) {
    computeShape(sh);
    const entry = layers.get(sh.id);
    if (!entry) return;
    const rings = sh.type === "polygon" ? sh.pts : sh.ring;
    entry.geometry.setLatLngs(rings.map((p) => L.latLng(p[0], p[1])));
    entry.geometry.setStyle({ color: sh.color, fillColor: sh.color });
    updateLabel(sh);
    repositionHandles(sh);
    updateList();
  }

  function updateLabel(sh) {
    const entry = layers.get(sh.id);
    if (!entry) return;
    const html = "<b>" + formatArea(sh.areaM2, state.areaUnit) + "</b> <span class=\"tip-muted\">" +
      sizeText(sh) + "</span>";
    if (entry.geometry.getTooltip()) {
      entry.geometry.setTooltipContent(html);
    } else {
      entry.geometry.bindTooltip(html, {
        permanent: true,
        direction: "top",
        offset: [0, -14],
        className: "area-tip",
      });
    }
  }

  /* ------------------------------------------------------------- polygon  */

  function drawPolygonDraft(sh) {
    const entry = layers.get(sh.id);
    if (entry) map.removeLayer(entry.group);
    const group = L.layerGroup().addTo(map);
    const poly = L.polygon(sh.pts.map((p) => L.latLng(p[0], p[1])), {
      color: sh.color,
      weight: 2,
      dashArray: "6,5",
      fillOpacity: 0.12,
    }).addTo(group);
    layers.set(sh.id, { group, geometry: poly, handles: [], draft: true });
  }

  function addPolygonPoint(latlng) {
    const sh = state.shapes[state.shapes.length - 1];
    if (!sh || sh.type !== "polygon") return;
    sh.pts.push([latlng.lat, latlng.lng]);
    computeShape(sh);
    drawPolygonDraft(sh);
    updateList();
    setStatus(
      "Polygon: " + sh.pts.length + " points · area " + formatArea(sh.areaM2, state.areaUnit) +
        " · <b>Enter</b> to close",
    );
  }

  function closePolygon() {
    const sh = state.shapes[state.shapes.length - 1];
    if (!sh || sh.type !== "polygon") return;
    if (sh.pts.length < 3) {
      state.shapes.pop();
      const entry = layers.get(sh.id);
      if (entry) map.removeLayer(entry.group);
      layers.delete(sh.id);
      setMode("idle");
      refresh();
      setStatus("A polygon needs at least 3 points");
      return;
    }
    const entry = layers.get(sh.id);
    if (entry) map.removeLayer(entry.group);
    layers.delete(sh.id);
    addShape(sh);
    setMode("idle");
    setStatus("Polygon closed — area " + formatArea(sh.areaM2, state.areaUnit) + " · drag the dots to reshape");
  }

  /* ------------------------------------------------------------ map input */

  function onMapClick(e) {
    if (state.mode === "place") {
      const sh = newShape(state.type, e.latlng.lat, e.latlng.lng);
      if (state.type === "polygon") {
        state.shapes.push(sh);
        sh.pts.push([e.latlng.lat, e.latlng.lng]);
        computeShape(sh);
        drawPolygonDraft(sh);
        setMode("draw");
        setStatus("Polygon: click to add points · <b>Enter</b> to close · <b>Esc</b> to cancel");
      } else {
        addShape(sh);
        setMode("idle");
        setStatus("Shape added — drag the centre dot to move, the coloured handle to resize");
      }
      refresh();
      return;
    }
    if (state.mode === "draw") addPolygonPoint(e.latlng);
  }

  function onMapMove(e) {
    if (state.mode !== "place" || state.type === "polygon") return;
    if (!preview) preview = L.layerGroup().addTo(map);
    preview.clearLayers();
    const sh = newShape(state.type, e.latlng.lat, e.latlng.lng, PALETTE[state.colorIdx % PALETTE.length]);
    L.polygon(sh.ring.map((p) => L.latLng(p[0], p[1])), {
      color: sh.color,
      weight: 2,
      dashArray: "5,4",
      fillColor: sh.color,
      fillOpacity: 0.1,
    }).addTo(preview);
    L.circleMarker(L.latLng(sh.lat, sh.lon), {
      radius: 5,
      color: "#fff",
      weight: 2,
      fillColor: sh.color,
      fillOpacity: 1,
    }).addTo(preview);
  }

  function setTiles(key) {
    if (tileLayer) map.removeLayer(tileLayer);
    const spec = TILES[key];
    tileLayer = L.tileLayer(spec.url, { maxZoom: 19, attribution: spec.attribution });
    tileLayer.addTo(map);
  }

  /* ------------------------------------------------------------------- UI  */

  function setStatus(html) {
    const status = el("status");
    if (!status) return;
    if (!html) {
      status.classList.remove("show");
      return;
    }
    status.innerHTML = html;
    status.classList.add("show");
    clearTimeout(setStatus.timer);
    setStatus.timer = setTimeout(() => status.classList.remove("show"), 6000);
  }

  function setMode(mode) {
    state.mode = mode;
    const button = el("btn-add");
    button.textContent = mode === "place"
      ? "Click the map… (Esc to cancel)"
      : mode === "draw"
      ? "Drawing polygon…"
      : "+ Add shape";
    button.classList.toggle("on", mode !== "idle");
    updateHint();
  }

  function updateHint() {
    const hint = el("hint");
    if (state.mode === "place") {
      hint.innerHTML = "Move the mouse to preview, <b>click</b> to drop the shape. <b>Esc</b> cancels.";
    } else if (state.mode === "draw") {
      hint.innerHTML =
        "Click to add points. <b>Enter</b>/double-click closes, <b>Backspace</b> undoes a point, <b>Esc</b> cancels.";
    } else {
      hint.innerHTML =
        "Pick a shape and size, then <b>Add shape</b>. Drag any shape afterwards to move or resize it.";
    }
  }

  function syncUnitLabels() {
    document.querySelectorAll("[data-lenu]").forEach((node) => {
      node.textContent = LEN_UNIT_NAMES[state.lenUnit];
    });
    el("unit-len").value = state.lenUnit;
    el("unit-area").value = state.areaUnit;
  }

  /** Size-box contents expressed in metres for the active shape type. */
  function readSizeMeters() {
    const num = (id) => parseFloat(el(id).value) || 0;
    const meters = {};
    if (state.type === "circle") meters.radius = toMeters(num("in-radius"), state.lenUnit);
    if (state.type === "square") meters.side = toMeters(num("in-side"), state.lenUnit);
    if (state.type === "rect") {
      meters.w = toMeters(num("in-w"), state.lenUnit);
      meters.h = toMeters(num("in-h"), state.lenUnit);
    }
    return meters;
  }

  /** Write metre values back into the size boxes, converted to the active unit. */
  function writeSizeMeters(meters) {
    const dp = state.lenUnit === "ft" ? 1 : state.lenUnit === "m" ? 1 : state.lenUnit === "km" ? 3 : 2;
    if (meters.radius !== undefined) {
      el("in-radius").value = +fromMeters(meters.radius, state.lenUnit).toFixed(dp);
    }
    if (meters.side !== undefined) {
      el("in-side").value = +fromMeters(meters.side, state.lenUnit).toFixed(dp);
    }
    if (meters.w !== undefined) el("in-w").value = +fromMeters(meters.w, state.lenUnit).toFixed(dp);
    if (meters.h !== undefined) el("in-h").value = +fromMeters(meters.h, state.lenUnit).toFixed(dp);
  }

  /** Switch length unit without changing the physical size on screen. */
  function setLenUnit(unit) {
    const meters = readSizeMeters();
    state.lenUnit = unit;
    writeSizeMeters(meters);
    syncUnitLabels();
    refresh();
  }

  /** Mirror a shape's size into the size boxes. */
  function fillInputsFromShape(sh) {
    if (!sh) return;
    if (sh.type === "circle") writeSizeMeters({ radius: sh.r });
    else if (sh.type === "square") writeSizeMeters({ side: sh.s });
    else if (sh.type === "rect") writeSizeMeters({ w: sh.w, h: sh.h });
  }

  function updateList() {
    const list = el("shape-list");
    list.innerHTML = "";
    for (const sh of state.shapes) {
      const li = document.createElement("li");
      li.className = (sh.id === state.selected ? "sel " : "") + (sh.visible ? "" : "off");
      li.innerHTML =
        '<span class="sw" style="background:' + sh.color + '"></span>' +
        '<span class="meta"><span class="t">' + TYPE_NAME[sh.type] + "</span><br>" +
        '<span class="a">' + formatArea(sh.areaM2, state.areaUnit) + " · " + sizeText(sh) + "</span></span>" +
        '<button class="iconbtn" data-act="vis" title="Show/hide">' + (sh.visible ? "👁" : "🚫") + "</button>" +
        '<button class="iconbtn" data-act="del" title="Delete">✕</button>';
      li.querySelector("[data-act=vis]").onclick = (ev) => {
        ev.stopPropagation();
        sh.visible = !sh.visible;
        const entry = layers.get(sh.id);
        if (entry) {
          if (sh.visible) entry.group.addTo(map);
          else map.removeLayer(entry.group);
        }
        updateList();
        save();
      };
      li.querySelector("[data-act=del]").onclick = (ev) => {
        ev.stopPropagation();
        removeShape(sh.id);
        save();
      };
      li.onclick = () => select(sh.id);
      list.appendChild(li);
    }
  }

  function refresh() {
    for (const sh of state.shapes) {
      const entry = layers.get(sh.id);
      if (entry && !entry.draft) updateLabel(sh);
    }
    updateList();
    save();
  }

  /* --------------------------------------------------------- persistence  */

  function save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          shapes: state.shapes.map((sh) => ({
            type: sh.type,
            color: sh.color,
            visible: sh.visible,
            lat: sh.lat,
            lon: sh.lon,
            r: sh.r,
            s: sh.s,
            w: sh.w,
            h: sh.h,
            pts: sh.pts,
          })),
          lenUnit: state.lenUnit,
          areaUnit: state.areaUnit,
          colorIdx: state.colorIdx,
        }),
      );
    } catch (err) {
      // Private browsing or a full quota — the tool still works, it just
      // won't remember shapes between reloads.
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      state.lenUnit = data.lenUnit || "ft";
      state.areaUnit = data.areaUnit || "ac";
      state.colorIdx = data.colorIdx || 0;
      for (const saved of data.shapes || []) {
        const sh = Object.assign({ id: state.nextId++ }, saved);
        computeShape(sh);
        addShape(sh);
        const entry = layers.get(sh.id);
        if (entry && !sh.visible) map.removeLayer(entry.group);
      }
      state.selected = null;
      clearHandles();
    } catch (err) {
      // Corrupt state — start clean rather than failing to boot.
    }
  }

  /* --------------------------------------------------------------- export  */

  function exportGeoJSON() {
    const features = state.shapes.filter((s) => s.visible).map((sh) => ({
      type: "Feature",
      properties: {
        tool: "acreage-tool",
        shape: sh.type,
        area_sqm: +sh.areaM2.toFixed(2),
        area_acres: +(sh.areaM2 / 4046.8564224).toFixed(4),
        perimeter_m: +sh.perimM.toFixed(2),
        size: sizeText(sh),
      },
      geometry: {
        type: "Polygon",
        coordinates: [sh.ring.map((p) => [+p[1].toFixed(7), +p[0].toFixed(7)])],
      },
    }));
    const blob = new Blob([JSON.stringify({ type: "FeatureCollection", features }, null, 2)], {
      type: "application/geo+json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "shapes.geojson";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  /* ----------------------------------------------------------------- wire  */

  function wire() {
    document.querySelectorAll("#shape-type button").forEach((button) => {
      button.onclick = () => {
        document.querySelectorAll("#shape-type button").forEach((b) => b.classList.remove("on"));
        button.classList.add("on");
        state.type = button.dataset.t;
        document.querySelectorAll("[data-for]").forEach((field) => {
          field.hidden = field.dataset.for !== state.type;
        });
        updateHint();
      };
    });

    el("btn-add").onclick = () => {
      if (state.mode === "idle") {
        setMode("place");
        setStatus(
          state.type === "polygon"
            ? "Polygon mode: click to start placing points"
            : "Click anywhere on the map to drop the " + TYPE_NAME[state.type].toLowerCase(),
        );
      } else if (state.mode === "place") {
        setMode("idle");
      }
    };

    el("preset").onclick = (ev) => {
      const button = ev.target.closest("button");
      if (!button) return;
      document.querySelectorAll("#preset button").forEach((b) => b.classList.remove("on"));
      button.classList.add("on");
      if (button.dataset.p === "metric") {
        state.areaUnit = "ha";
        setLenUnit("m");
      } else {
        state.areaUnit = "ac";
        setLenUnit("ft");
      }
      el("unit-area").value = state.areaUnit;
      refresh();
    };

    el("unit-len").onchange = (ev) => setLenUnit(ev.target.value);
    el("unit-area").onchange = (ev) => {
      state.areaUnit = ev.target.value;
      refresh();
    };

    el("tiles").onchange = (ev) => setTiles(ev.target.value);
    el("btn-goto").onclick = () => {
      const parts = el("goto").value.split(",").map((s) => parseFloat(s.trim()));
      if (parts.length === 2 && parts.every((n) => !isNaN(n))) map.setView([parts[0], parts[1]], 16);
    };
    el("btn-export").onclick = exportGeoJSON;
    el("btn-clear").onclick = () => {
      if (!state.shapes.length) return;
      for (const sh of state.shapes) {
        const entry = layers.get(sh.id);
        if (entry) map.removeLayer(entry.group);
      }
      layers.clear();
      state.shapes = [];
      state.selected = null;
      clearHandles();
      refresh();
    };
    el("panel-toggle").onclick = () => el("side").classList.toggle("open");

    ["in-radius", "in-side", "in-w", "in-h"].forEach((id) => {
      el(id).oninput = () => {
        const sh = state.shapes.find((s) => s.id === state.selected);
        if (!sh) return;
        const value = parseFloat(el(id).value) || 0;
        if (id === "in-radius") sh.r = toMeters(value, state.lenUnit);
        if (id === "in-side") sh.s = toMeters(value, state.lenUnit);
        if (id === "in-w") sh.w = toMeters(value, state.lenUnit);
        if (id === "in-h") sh.h = toMeters(value, state.lenUnit);
        recomputeAndRender(sh);
      };
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT") return;
      if (ev.key === "Escape") {
        if (state.mode === "draw") {
          const sh = state.shapes.pop();
          if (sh) {
            const entry = layers.get(sh.id);
            if (entry) map.removeLayer(entry.group);
            layers.delete(sh.id);
          }
        }
        setMode("idle");
        refresh();
        setStatus("");
      } else if (ev.key === "Enter" && state.mode === "draw") {
        closePolygon();
      } else if (ev.key === "Backspace" && state.mode === "draw") {
        const sh = state.shapes[state.shapes.length - 1];
        if (sh) {
          sh.pts.pop();
          computeShape(sh);
          drawPolygonDraft(sh);
          updateList();
        }
        ev.preventDefault();
      } else if ((ev.key === "Delete" || ev.key === "Backspace") && state.selected) {
        removeShape(state.selected);
        save();
      }
    });

    map.on("dblclick", () => {
      if (state.mode === "draw") closePolygon();
    });
  }

  function init() {
    map = L.map("map", { zoomControl: true }).setView([42.9157, -89.2253], 15);
    setTiles("topo");
    map.on("click", onMapClick);
    map.on("mousemove", onMapMove);
    wire();
    syncUnitLabels();
    load();
    updateHint();
    refresh();
  }

  init();

  return {
    state,
    layers,
    get map() {
      return map;
    },
    newShape,
    computeShape,
    addShape,
    select,
    removeShape,
    setMode,
    formatArea: (m2) => formatArea(m2, state.areaUnit),
    areaUnitName: () => AREA_UNIT_NAMES[state.areaUnit],
  };
}
