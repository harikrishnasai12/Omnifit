// My Mannequin, step 3: the product on the mannequin, and how it fits.
//
// PHASE-1 GARMENT. The garment's SHAPE is built here from a template: it
// follows the person's mannequin with the room a garment of the chosen size
// has, with the sleeve and hem lengths Gemma read from the product. Only its
// SURFACE is the real product (its photo, wrapped on the front). The back,
// which the photo doesn't show, is the garment's own plain colour. This is
// not yet the product itself in 3D; a product-specific 3D model would
// replace this builder.
//
// Fit is worked out against the standard Indian size chart (sizing.js): the
// catalogue knows which sizes are in stock, not each brand's own measurements.

import {
  BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshPhysicalMaterial, SRGBColorSpace, Vector3,
} from "three";

const AROUND = 64;
const INCH = 2.54;

// The largest chest each size is cut for, in inches (sizing.js uses the same)
const TOP_CHART = {
  men: [["XS", 36], ["S", 38], ["M", 40], ["L", 42], ["XL", 44], ["XXL", 46], ["3XL", 48]],
  women: [["XS", 32], ["S", 34], ["M", 36], ["L", 38], ["XL", 40], ["XXL", 42], ["3XL", 44]],
};
const WAIST_SIZES = [26, 28, 30, 32, 34, 36, 38, 40, 42];
// How much bigger than the body a garment of each cut is made, round the chest (cm)
const DESIGN_EASE = { fitted: 4, regular: 9, relaxed: 15, oversized: 24, straight: 9, flared: 8, "a-line": 8 };
const LEGGED = /trouser|pant|jean|jogger|legging|short|chino|cargo|jumpsuit|suit|tracksuit|palazzo/;
const DRAPED = /skirt|dress|gown|saree|lehenga|kurta|anarkali|kaftan/;

const chartFor = (section) => TOP_CHART[section === "women" ? "women" : "men"];

// The sizes to offer for a garment: the chart's, marked with those in stock
export const sizesFor = (garment, section, inStock = []) => {
  const lower = garment.region === "lower";
  const labels = lower ? WAIST_SIZES.map(String) : chartFor(section).map(([label]) => label);
  // Stores write sizes many ways ("L-42", "2XL", "32W"): keep the part the chart knows
  const known = (label) => {
    const first = String(label).toUpperCase().trim().split(/[\s\-/]+/)[0].replace(/W$/, "");
    return { "2XL": "XXL", XXXL: "3XL" }[first] || first;
  };
  const stocked = new Set(inStock.map(known));
  return labels.map((label) => ({ label, inStock: inStock.length ? stocked.has(label) : null }));
};

// How a size fits this person. Returns
// { size, verdict: "too small" | "snug" | "regular" | "loose", parts: [{ part, easeCm, verdict }], best }
export const fitOf = (garment, section, size, measurements) => {
  const m = measurements;
  const judge = (ease) => (ease < -2 ? "too small" : ease < 3 ? "snug" : ease < 11 ? "regular" : "loose");
  const parts = [];
  let best;

  if (garment.region === "lower") {
    const waist = Number(size) * INCH;
    parts.push({ part: "Waist", easeCm: Math.round(waist - m.waist), verdict: judge(waist - m.waist + 2) });
    // A waist size is cut for hips about 9 inches bigger
    parts.push({ part: "Hip", easeCm: Math.round(waist + 9 * INCH - m.hip + 4), verdict: judge(waist + 9 * INCH - m.hip + 4) });
    const need = Math.max(m.waist / INCH, section === "women" ? m.hip / INCH - 9 : 0);
    best = String(WAIST_SIZES.find((entry) => entry >= need - 0.5) || WAIST_SIZES.at(-1));
  } else {
    const chart = chartFor(section);
    const bound = (chart.find(([label]) => label === size) || chart[2])[1] * INCH;
    const design = DESIGN_EASE[garment.shape] ?? 9;
    const garmentChest = bound + design;
    parts.push({ part: "Chest", easeCm: Math.round(garmentChest - m.chest), verdict: judge(garmentChest - m.chest - (design - 6)) });
    parts.push({ part: "Waist", easeCm: Math.round(garmentChest - 4 - m.waist), verdict: judge(garmentChest - 4 - m.waist - (design - 6)) });
    if (garment.region === "full" || ["thigh", "knee", "calf", "ankle", "floor"].includes(garment.length)) {
      parts.push({ part: "Hip", easeCm: Math.round(garmentChest + 4 - m.hip), verdict: judge(garmentChest + 4 - m.hip - (design - 6)) });
    }
    best = (chart.find(([, upTo]) => m.chest / INCH <= upTo) || chart.at(-1))[0];
  }

  const order = ["too small", "snug", "regular", "loose"];
  // The tightest part decides: a shirt that is right at the waist but too small at the chest is too small
  const verdict = parts.map((part) => part.verdict).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
  return { size, verdict, parts, best };
};

// Collects a mesh: points, where each is in the product photo, and which
// faces are the front (the photo's side) and which the back
const makeMesh = () => {
  const data = { position: [], uv: [], front: [], back: [] };
  return {
    data,
    ring(points) {
      const first = data.position.length / 3;
      for (const point of points) {
        data.position.push(point.x, point.y, point.z);
        data.uv.push(point.u, point.v);
      }
      return first;
    },
    join(a, b) {
      for (let i = 0; i < AROUND; i += 1) {
        const next = (i + 1) % AROUND;
        const side = Math.cos(((i + 0.5) / AROUND) * Math.PI * 2) >= 0 ? data.front : data.back;
        side.push(a + i, b + i, a + next, a + next, b + i, b + next);
      }
    },
  };
};

// How points on the mannequin map onto the product photo. `cut.anchors` are
// the body points found in the photo (tryon/garment.js), in its pixels.
const photoMap = (cut, layout, hemY, alpha) => {
  const a = cut.anchors;
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

  // The garment in the photo is a flat outline; on the mannequin it is a
  // whole 3D shape. A point that falls outside the outline (round the side
  // of the body, past the photo's hem) takes the nearest part of the garment
  // instead, so the surface has no holes.
  const solid = (x, y) => x >= 0 && y >= 0 && x < cut.width && y < cut.height && alpha[(y * cut.width + x) * 4 + 3] > 128;
  const spans = [];
  let firstRow = -1;
  let lastRow = -1;
  for (let y = 0; y < cut.height; y += 1) {
    let left = 0;
    let right = cut.width - 1;
    while (left < right && !solid(left, y)) left += 1;
    while (right > left && !solid(right, y)) right -= 1;
    spans.push(solid(left, y) && right - left > 4 ? { left, right } : null);
    if (spans[y]) {
      if (firstRow < 0) firstRow = y;
      lastRow = y;
    }
  }
  const settle = (point, towards, below) => {
    let y = Math.round(Math.min(lastRow - 2, Math.max(firstRow + 2, point.y)));
    while (!spans[y] && y < lastRow) y += 1;
    let span = spans[y] || { left: 0, right: cut.width - 1 };
    let x = Math.round(Math.min(span.right - 2, Math.max(span.left + 2, point.x)));
    if (below && !solid(x, y)) {
      // In the opening of the neck: the cloth just below it, not cloth
      // dragged in from the shoulders either side
      let down = y;
      while (down < lastRow && down - y < cut.height * 0.2 && !solid(x, down)) down += 1;
      if (solid(x, down)) {
        y = Math.min(lastRow, down + 2);
        span = spans[y] || span;
      }
    }
    // In a gap inside the outline (between a sleeve and the body): move
    // towards the middle of this part of the garment until on it again
    const target = Math.round(Math.min(span.right, Math.max(span.left, towards.x)));
    for (let step = 0; !solid(x, y) && x !== target && step < cut.width; step += 1) x += x < target ? 1 : -1;
    return { x, y };
  };
  const uv = (point, towards, below) => {
    const on = settle(point, towards, below);
    return { u: (on.x + 0.5) / cut.width, v: 1 - (on.y + 0.5) / cut.height };
  };

  let origin;
  let originY;
  let perCm;
  if (a.leftShoulder && a.rightShoulder) {
    origin = mid(a.leftShoulder, a.rightShoulder);
    originY = layout.shoulderY;
    perCm = (a.leftShoulder.x - a.rightShoulder.x) / (2 * layout.shoulderJointHalf);
  } else {
    origin = mid(a.leftHip, a.rightHip);
    originY = layout.hipJointY;
    perCm = (a.leftHip.x - a.rightHip.x) / (2 * layout.hipJointHalf);
  }
  // Down the body the photo has its own scale: its model may be taller or
  // shorter in the torso than this person
  let perCmDown = Math.abs(perCm);
  if (a.leftShoulder && a.leftHip && a.rightHip) {
    perCmDown = (mid(a.leftHip, a.rightHip).y - origin.y) / (layout.shoulderY - layout.hipJointY);
  } else if (a.leftKnee && a.rightKnee && a.leftHip) {
    perCmDown = (mid(a.leftKnee, a.rightKnee).y - origin.y) / (layout.hipJointY - layout.legs.left.kneeY);
  } else if (a.hem) {
    perCmDown = (a.hem.y - origin.y) / Math.max(10, layout.hipJointY - hemY);
  }
  // The body of the garment at one row of the photo: the run through its
  // middle, not out along a sleeve hanging beside it
  const limit = Math.abs(perCm) * layout.shoulderJointHalf * 1.55;
  const spanCache = new Map();
  const bodySpan = (rowIn) => {
    let y = Math.round(Math.min(lastRow - 2, Math.max(firstRow + 2, rowIn)));
    while (!spans[y] && y < lastRow) y += 1;
    if (spanCache.has(y)) return spanCache.get(y);
    const whole = spans[y] || { left: 0, right: cut.width - 1 };
    const centre = Math.round(Math.min(whole.right, Math.max(whole.left, origin.x)));
    let left = centre;
    let right = centre;
    // The middle may be the opening of the neck: the body of the garment
    // then starts at the cloth on each side of it
    while (!solid(left, y) && left > whole.left && centre - left < limit) left -= 1;
    while (!solid(right, y) && right < whole.right && right - centre < limit) right += 1;
    while (solid(left - 1, y) && centre - left < limit) left -= 1;
    while (solid(right + 1, y) && right - centre < limit) right += 1;
    const span = { left, right };
    spanCache.set(y, span);
    return span;
  };
  // Evened out over nearby rows, so the surface doesn't ripple with every
  // notch in the outline
  const evenSpan = (row) => {
    let left = 0;
    let right = 0;
    let count = 0;
    for (let offset = -6; offset <= 6; offset += 3) {
      const span = bodySpan(row + offset);
      left += span.left;
      right += span.right;
      count += 1;
    }
    return { left: left / count, right: right / count };
  };

  // A point on a band round the body (`rx`: the band's half-width). Across
  // the band the photo is used edge to edge: the garment in the photo is
  // spread over the garment on the mannequin, whatever size is being tried,
  // so the print stays whole and no edge is smeared round the side.
  const mirrored = perCm < 0 ? -1 : 1;
  const frontal = (x, y, rx) => {
    const row = origin.y + (originY - y) * perCmDown;
    if (!rx) return uv({ x: origin.x + x * perCm, y: row }, { x: origin.x, y: row });
    const span = evenSpan(row);
    const middle = (span.left + span.right) / 2;
    const half = ((span.right - span.left) / 2) * 0.96;
    return uv({ x: middle + (x / rx) * half * mirrored, y: row }, { x: middle, y: row }, true);
  };

  // A sleeve or a trouser leg: along its own bone in the photo, where it may hang at any angle
  const limb = (from, to, fallbackCm, startAt) => {
    const start = a[from] || startAt;
    if (!start) return null;
    const end = a[to] || { x: start.x, y: start.y + fallbackCm * perCmDown };
    const along = { x: end.x - start.x, y: end.y - start.y };
    const length = Math.hypot(along.x, along.y) || 1;
    // How far along the bone the garment goes in the photo (a short sleeve
    // stops part-way down the arm): the bare arm past it is never used
    let until = 1;
    for (let share = 0.1; share <= 1.001; share += 0.05) {
      if (!solid(Math.round(start.x + along.x * share), Math.round(start.y + along.y * share))) {
        until = Math.max(0.15, share - 0.05);
        break;
      }
    }
    let normal = { x: -along.y / length, y: along.x / length };
    // Away from the middle of the body
    if ((start.x - origin.x) * normal.x < 0) normal = { x: -normal.x, y: -normal.y };
    const mapper = (share, outwardCm) => {
      const centre = { x: start.x + along.x * share, y: start.y + along.y * share };
      return uv(
        { x: centre.x + normal.x * outwardCm * Math.abs(perCm), y: centre.y + normal.y * outwardCm * Math.abs(perCm) },
        centre
      );
    };
    mapper.end = end;
    mapper.until = until;
    return mapper;
  };
  return { frontal, limb };
};

// The garment for the mannequin. `garment`: Gemma's reading; `cut`: the
// cut-out of the product photo; `size`: the size being tried.
export const buildGarment = (garment, cut, layout, measurements, size) => {
  const mesh = makeMesh();
  const name = (garment.garment || "").toLowerCase();
  const legged = LEGGED.test(name) && !DRAPED.test(name);
  const { H, section } = layout;
  const hips = layout.at(1.06);
  const leg = layout.legs.left;

  // Where the hem is on this person
  const hemAt = {
    cropped: layout.shoulderY - layout.torso * 0.62, waist: layout.hipJointY + layout.torso * 0.12,
    hip: layout.hipJointY - layout.torso * 0.14, thigh: (layout.crotchY + leg.kneeY) / 2 + H * 0.02,
    knee: leg.kneeY, calf: leg.kneeY * 0.62, ankle: leg.ankleY + H * 0.01, floor: H * 0.012,
  };
  const hemY = hemAt[garment.length] ?? (garment.region === "upper" ? hemAt.hip : hemAt.ankle);

  // The garment's picture, with everything outside its outline filled with
  // its own average colour, so no see-through or black edge shows on the 3D shape
  const picture = document.createElement("canvas");
  picture.width = cut.width;
  picture.height = cut.height;
  const pictureContext = picture.getContext("2d", { willReadFrequently: true });
  pictureContext.drawImage(cut.canvas, 0, 0);
  const pixels = pictureContext.getImageData(0, 0, cut.width, cut.height);
  const alpha = pixels.data.slice();
  // Its ground colour: the commonest colour on it, not the average (white
  // with a red print is white, not pink)
  const shades = new Map();
  for (let offset = 0; offset < alpha.length; offset += 16) {
    if (alpha[offset + 3] > 200) {
      const key = (alpha[offset] >> 4) * 256 + (alpha[offset + 1] >> 4) * 16 + (alpha[offset + 2] >> 4);
      const shade = shades.get(key) || shades.set(key, [0, 0, 0, 0]).get(key);
      shade[0] += alpha[offset]; shade[1] += alpha[offset + 1]; shade[2] += alpha[offset + 2];
      shade[3] += 1;
    }
  }
  const commonest = [...shades.values()].sort((a, b) => b[3] - a[3])[0];
  const ground = commonest
    ? `rgb(${Math.round(commonest[0] / commonest[3])}, ${Math.round(commonest[1] / commonest[3])}, ${Math.round(commonest[2] / commonest[3])})`
    : "#888";
  pictureContext.globalCompositeOperation = "destination-over";
  pictureContext.fillStyle = ground;
  pictureContext.fillRect(0, 0, cut.width, cut.height);

  const map = photoMap(cut, layout, hemY, alpha);
  const flare = garment.shape === "flared" || garment.shape === "a-line" ? 0.5 : 0.08;

  // `droop`: how much lower the ring is at its sides than in its middle
  // (shoulders slope down from the neck)
  const ringOf = (level, rx, rz, cz = 0, droop = 0) => {
    const points = [];
    for (let i = 0; i < AROUND; i += 1) {
      const angle = (i / AROUND) * Math.PI * 2;
      const x = rx * Math.sin(angle);
      const y = level - droop * (x / rx) ** 2;
      const z = cz + rz * Math.cos(angle);
      points.push({ x, y, z, ...map.frontal(x, y, rx) });
    }
    return mesh.ring(points);
  };
  const stack = (rings) => {
    let previous = null;
    for (const ring of rings) {
      const current = ringOf(ring.y, ring.rx, ring.rz, ring.cz, ring.droop);
      if (previous !== null) mesh.join(previous, current);
      previous = current;
    }
  };

  // A tube along a limb of the mannequin, out to `reach` (a share of the limb)
  const tube = (points, radii, reach, mappers, room) => {
    const lengths = [points[0].distanceTo(points[1]), points[1].distanceTo(points[2])];
    const total = lengths[0] + lengths[1];
    let previous = null;
    // Starts as a dome over the round top of the limb (the shoulder), so
    // nothing of the body shows above where the tube begins
    const dome = [0.96, 0.75, 0.45].map((back) => ({ back, scale: Math.sqrt(1 - back * back) }));
    const stations = [...dome, ...Array.from({ length: 11 }, (_, step) => ({ step }))];
    for (const station of stations) {
      const capped = station.back !== undefined;
      const distance = capped ? 0 : Math.min(total * reach, (total * reach * station.step) / 10);
      const onSecond = distance > lengths[0];
      const share = onSecond ? (distance - lengths[0]) / lengths[1] : distance / lengths[0];
      const along = (onSecond ? points[2].clone().sub(points[1]) : points[1].clone().sub(points[0])).normalize();
      const centre = onSecond ? points[1].clone().lerp(points[2], share) : points[0].clone().lerp(points[1], share);
      const full = (onSecond ? radii[1] + (radii[2] - radii[1]) * share : radii[0] + (radii[1] - radii[0]) * share) + room;
      if (capped) centre.addScaledVector(along, -full * station.back);
      // Across the limb, in the plane facing the camera, pointing away from the body
      const across = { x: -along.y, y: along.x };
      const sign = centre.x * across.x < 0 ? -1 : 1;
      const radius = capped ? full * station.scale : full;
      const mapper = (onSecond ? mappers[1] : mappers[0]) || mappers[0];
      // The part of the limb the garment ends on: its whole length here is
      // the garment's whole length there in the photo
      const covered = onSecond ? (total * reach - lengths[0]) / lengths[1] : (total * reach) / lengths[0];
      const endsHere = onSecond || covered <= 1;
      const photoShare = mapper && endsHere && covered > 0 ? (share / Math.min(1, covered)) * Math.min(1, mapper.until) * 0.94 : share;
      const ringPoints = [];
      for (let i = 0; i < AROUND; i += 1) {
        const angle = (i / AROUND) * Math.PI * 2;
        const out = radius * Math.sin(angle);
        const x = centre.x + across.x * sign * out;
        const y = centre.y + across.y * sign * out;
        const z = centre.z + radius * Math.cos(angle);
        const uv = mapper ? mapper(photoShare, out) : map.frontal(x, y);
        ringPoints.push({ x, y, z, ...uv });
      }
      const current = mesh.ring(ringPoints);
      if (previous !== null) mesh.join(previous, current);
      previous = current;
    }
  };

  if (garment.region === "upper" || garment.region === "full") {
    // Room round the chest for this size, shared out as extra radius
    const chart = chartFor(section);
    const bound = (chart.find(([label]) => label === size) || chart[2])[1] * INCH;
    const ease = bound + (DESIGN_EASE[garment.shape] ?? 9) - measurements.chest;
    const room = Math.max(0.7, ease / (2 * Math.PI));
    const chest = layout.at(0.26);
    const boxy = garment.shape !== "fitted";

    // The neckline sits at the base of the neck; the shoulders reach over
    // the tops of the arms, so the sleeves come out from under them
    const acrossShoulders = Math.max(layout.rings[0].rx, measurements.shoulder / 2);
    const rings = [
      { y: layout.neckY - H * 0.004, rx: layout.neckRadius * 1.5, rz: layout.neckRadius * 1.35 },
      { y: layout.rings[0].y + H * 0.018, rx: acrossShoulders * 0.82 + room, rz: layout.rings[0].rz * 0.9 + room },
    ];
    const bodyBottom = garment.region === "full" && legged ? layout.crotchY + 2 : hemY;
    for (const ring of layout.rings) {
      if (ring.y < bodyBottom) break;
      const body = ring === layout.rings[0] ? acrossShoulders : ring.rx;
      // Below the chest a garment hangs from it; only a fitted one follows the waist in
      const rx = boxy && ring.level > 0.26 ? Math.max(ring.rx + room, (chest.rx + room) * 0.97) : body + room;
      const rz = boxy && ring.level > 0.26 ? Math.max(ring.rz + room, (chest.rz + room) * 0.94) : ring.rz + room;
      rings.push({ y: ring.y, rx, rz, cz: ring.cz, droop: ring === layout.rings[0] ? H * 0.008 : 0 });
    }
    // Past the hips it hangs to the hem, widening a little (more if flared)
    const lowest = rings.at(-1);
    for (let y = lowest.y - 14; y > bodyBottom + 6; y -= 14) {
      const widen = 1 + flare * ((lowest.y - y) / (H * 0.5));
      rings.push({ y, rx: Math.max(lowest.rx, hips.rx + room) * widen, rz: Math.max(lowest.rz, hips.rz + room) * widen });
    }
    if (lowest.y > bodyBottom + 1) {
      const widen = 1 + flare * ((lowest.y - bodyBottom) / (H * 0.5));
      rings.push({ y: bodyBottom, rx: Math.max(lowest.rx, hips.rx + room) * widen, rz: Math.max(lowest.rz, hips.rz + room) * widen });
    }
    stack(rings);

    const reach = { short: 0.24, "three-quarter": 0.76, long: 0.97 }[garment.sleeves];
    if (reach) {
      for (const sideName of ["left", "right"]) {
        const arm = layout.arms[sideName];
        const upper = map.limb(`${sideName}Shoulder`, `${sideName}Elbow`, measurements.arm * 0.48);
        const lower = map.limb(`${sideName}Elbow`, `${sideName}Wrist`, measurements.arm * 0.52, upper?.end);
        tube([arm.shoulder, arm.elbow, arm.wrist], arm.radii, reach, [upper, lower], Math.max(0.9, room * 0.55));
      }
    }
  }

  if (garment.region === "lower" || (garment.region === "full" && legged)) {
    const waistSize = garment.region === "lower" ? Number(size) * INCH : measurements.waist + 4;
    const room = Math.max(0.6, (waistSize - measurements.waist) / (2 * Math.PI) + 0.6);
    const waist = layout.at(0.7);
    const top = { y: waist.y - layout.torso * 0.04, rx: waist.rx + room, rz: waist.rz + room };

    if (legged) {
      // The seat, then a leg each
      stack([
        top,
        { y: hips.y, rx: hips.rx + room, rz: hips.rz + room },
        { y: layout.crotchY - 1, rx: hips.rx * 0.98 + room, rz: hips.rz * 0.95 + room },
      ]);
      const wide = /wide|palazzo|baggy|relaxed|cargo/.test(name) || garment.shape === "relaxed" || garment.shape === "oversized";
      // Room round each leg, never so much that the two legs merge into one block
      const legRoom = Math.min(garment.shape === "fitted" ? 0.8 : wide ? 4 : 2.2, Math.max(0.8, Math.abs(leg.x) * 1.08 - leg.radii.thigh));
      const legTop = layout.crotchY + 3;
      const reach = Math.min(1, Math.max(0.12, (legTop - hemY) / (legTop - leg.ankleY)));
      for (const sideName of ["left", "right"]) {
        const l = layout.legs[sideName];
        const upper = map.limb(`${sideName}Hip`, `${sideName}Knee`, layout.hipJointY - l.kneeY);
        const lower = map.limb(`${sideName}Knee`, `${sideName}Ankle`, l.kneeY - l.ankleY, upper?.end);
        const points = [new Vector3(l.x, legTop, 0), new Vector3(l.x, l.kneeY, 0), new Vector3(l.x, l.ankleY, 0)];
        tube(points, [l.radii.thigh, wide ? l.radii.thigh * 0.9 : l.radii.knee, wide ? l.radii.thigh * 0.85 : l.radii.ankle], reach, [upper, lower], legRoom);
      }
    } else {
      // A skirt: one hanging piece from the waist, widening to the hem
      const rings = [top];
      for (let y = top.y - 12; y > hemY + 6; y -= 12) {
        const widen = 1 + (flare + 0.12) * ((top.y - y) / (H * 0.5));
        rings.push({ y, rx: (hips.rx + room) * widen, rz: (hips.rz + room) * widen });
      }
      const widen = 1 + (flare + 0.12) * ((top.y - hemY) / (H * 0.5));
      rings.push({ y: hemY, rx: (hips.rx + room) * widen, rz: (hips.rz + room) * widen });
      stack(rings);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(mesh.data.position, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(mesh.data.uv, 2));
  geometry.setIndex([...mesh.data.front, ...mesh.data.back]);
  geometry.addGroup(0, mesh.data.front.length, 0);
  geometry.addGroup(mesh.data.front.length, mesh.data.back.length, 1);
  geometry.computeVertexNormals();

  const texture = new CanvasTexture(picture);
  texture.colorSpace = SRGBColorSpace;
  const group = new Group();
  group.name = "Garment";
  // Cloth: matt, with the soft sheen fabric has at glancing angles
  const cloth = { side: DoubleSide, roughness: 0.92, metalness: 0, sheen: 0.5, sheenRoughness: 0.7 };
  group.add(new Mesh(geometry, [
    new MeshPhysicalMaterial({ ...cloth, map: texture }),
    new MeshPhysicalMaterial({ ...cloth, color: new Color(ground) }),
  ]));
  return group;
};
