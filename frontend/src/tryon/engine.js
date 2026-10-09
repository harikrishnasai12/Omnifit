// Live Try-On: the real-time engine (body tracking + drawing the garment).
//
// Every video frame: MediaPipe Pose finds the person's joints in 3D (across,
// down and depth), and the garment cut-out (tryon/garment.js) is drawn over
// them in pieces: torso, upper arms, forearms, and for the lower body the
// hips and each leg (or one piece for skirts and dresses).
//
// Each piece is a rounded 3D shape (a tube around that body part). The
// garment photo is wrapped around it: it curves away at the sides, turns when
// the person turns, is shaded by its angle to the camera, and a piece nearer
// the camera (an arm across the chest) is drawn over one further away. The
// side of the garment the photo doesn't show is filled with the photo
// mirrored and darkened.
//
// Runs entirely in the browser: no frame leaves the device.

const JOINTS = {
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  // The outer corners of the eyes: hats and eyewear are placed by these
  leftEye: 3, rightEye: 6,
};
const VISIBLE = 0.5;
// Less jitter: each joint moves part of the way to its new position per frame
// (depth is noisier than position, so it moves more slowly)
const SMOOTHING = 0.55;
const DEPTH_SMOOTHING = 0.3;

// How wide each body part's piece is, as a share of the shoulder width
const TORSO_WIDEN = 1.34;
const UPPER_ARM_HALF = 0.3;
const FOREARM_HALF = 0.24;
const THIGH_HALF = 0.34;
const SHIN_HALF = 0.26;

// The 3D shape of each piece: how deep it is front-to-back compared with its
// width (a torso is flatter than it is wide; arms and legs are round)
const TORSO_DEPTH = 0.62;
const SKIRT_DEPTH = 0.8;
const LIMB_DEPTH = 1;
// How many slices each piece is wrapped in, all the way round
const STRIPS = 18;
// How dark the garment gets where it curves away from the camera, and how
// much darker the side the photo doesn't show is
const EDGE_SHADE = 0.45;
const BACK_SHADE = 0.22;
// An arm is drawn over the torso when it is this much nearer the camera, in
// shoulder widths
const IN_FRONT = 0.35;

let posePromise = null;

const loadPose = () => {
  if (!posePromise) {
    posePromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const create = (delegate) =>
        PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/mediapipe/pose_landmarker_full.task", delegate },
          runningMode: "VIDEO",
          numPoses: 1,
        });
      // The graphics chip when the device has one, else the processor
      try {
        return await create("GPU");
      } catch {
        return create("CPU");
      }
    })().catch((error) => {
      posePromise = null;
      throw error;
    });
  }
  return posePromise;
};

// ---------- geometry ----------

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (v) => {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
};
const depthOf = (...points) => points.reduce((sum, point) => sum + (point.z || 0), 0) / points.length;

// How far a pair of joints (the shoulders, or the hips) has turned away from
// facing the camera, from their depths. `across` points along the pair as the
// camera sees a person facing it (their left is on the right of the picture);
// `width` is the pair's real width, however much of it the turn hides.
const turnOf = (left, right) => {
  const seen = dist(left, right);
  const facing = left.x >= right.x ? 1 : -1;
  const deep = (left.z || 0) - (right.z || 0);
  const width = Math.hypot(seen, deep) || 1;
  return {
    cos: (seen * facing) / width,
    sin: -deep / width,
    width,
    across: unit({ x: (left.x - right.x) * facing, y: (left.y - right.y) * facing }),
  };
};

// A piece's place in the picture: the middle of its top and bottom edges,
// the direction across it, and half its width at each end
const boneFrame = (a, b, half, overlap = 0.12) => {
  const along = sub(b, a);
  const length = Math.hypot(along.x, along.y) || 1;
  const direction = { x: along.x / length, y: along.y / length };
  const normal = { x: -direction.y, y: direction.x };
  // Reaches a little past both ends so neighbouring pieces overlap
  return {
    top: add(a, direction, -length * overlap), bottom: add(b, direction, length * overlap),
    topAcross: normal, bottomAcross: normal, topHalf: half, bottomHalf: half,
  };
};

// The torso piece: from the shoulders to the hips, widened, and stretched up
// to the collar and down to `below` (a share of the torso length past the hips)
const torsoFrame = (p, above, below, shoulders, hips) => {
  const top = mid(p.leftShoulder, p.rightShoulder);
  const bottom = mid(p.leftHip, p.rightHip);
  const down = sub(bottom, top);
  return {
    top: add(top, down, -above), bottom: add(bottom, down, below),
    topAcross: shoulders.across, bottomAcross: hips.across,
    topHalf: (shoulders.width / 2) * TORSO_WIDEN, bottomHalf: (hips.width / 2) * TORSO_WIDEN,
  };
};

// One hanging piece from the waist to the hem (skirts, dresses, kurtas)
const hangFrame = (p, hips, drop, scale, flare) => {
  const centre = mid(p.leftHip, p.rightHip);
  const down = { x: -hips.across.y, y: hips.across.x };
  const sign = down.y < 0 ? -1 : 1;
  return {
    top: add(centre, down, -scale * 0.28 * sign), bottom: add(centre, down, drop * sign),
    topAcross: hips.across, bottomAcross: hips.across,
    topHalf: scale * 0.5, bottomHalf: scale * 0.5 * flare,
  };
};

// Draws the part of `image` inside triangle s0-s1-s2 onto triangle d0-d1-d2
// (or, with `whole`, the entire image placed by those three points)
const drawTriangle = (ctx, image, s0, s1, s2, d0, d1, d2, whole = false) => {
  const denominator = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(denominator) < 1e-6) return;
  // The affine map taking each source corner to its destination corner
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / denominator;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / denominator;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / denominator;
  const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / denominator;
  const e = d0.x - a * s0.x - c * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;

  ctx.save();
  if (!whole) {
    // Clip slightly outside the triangle so no seam shows between neighbours
    const centre = { x: (d0.x + d1.x + d2.x) / 3, y: (d0.y + d1.y + d2.y) / 3 };
    const grow = (point) => add(centre, sub(point, centre), 1.03);
    const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
    ctx.beginPath();
    ctx.moveTo(g0.x, g0.y);
    ctx.lineTo(g1.x, g1.y);
    ctx.lineTo(g2.x, g2.y);
    ctx.closePath();
    ctx.clip();
  }
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
};

// Wraps one piece of the garment round its 3D shape. The piece is cut into
// slices all the way round; each slice is drawn where that part of the
// surface is now, if it faces the camera, and shaded by how far it is turned
// away. `layer` is a spare canvas the same size as `ctx`'s.
const drawWrapped = (ctx, layer, image, piece) => {
  const { source, target, turn, depth } = piece;
  const reach = Math.max(target.topHalf, target.bottomHalf) * Math.max(1, depth) + 4;
  const corners = [target.top, target.bottom];
  const left = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.x)) - reach));
  const top = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.y)) - reach));
  const right = Math.min(layer.canvas.width, Math.ceil(Math.max(...corners.map((point) => point.x)) + reach));
  const bottom = Math.min(layer.canvas.height, Math.ceil(Math.max(...corners.map((point) => point.y)) + reach));
  if (right <= left || bottom <= top) return;

  // Each line round the piece: where it is in the photo, where it is on the
  // person, and how squarely that part of the surface faces the camera
  const lines = [];
  for (let index = 0; index <= STRIPS; index += 1) {
    const angle = -Math.PI + (2 * Math.PI * index) / STRIPS;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const onPerson = sin * turn.cos - depth * cos * turn.sin;
    lines.push({
      back: cos < 0,
      facing: (cos * turn.cos + depth * sin * turn.sin) / Math.hypot(depth * sin, cos),
      sourceTop: add(source.top, source.topAcross, source.topHalf * sin),
      sourceBottom: add(source.bottom, source.bottomAcross, source.bottomHalf * sin),
      targetTop: add(target.top, target.topAcross, target.topHalf * onPerson),
      targetBottom: add(target.bottom, target.bottomAcross, target.bottomHalf * onPerson),
    });
  }
  const shade = (line) => Math.min(0.75, (1 - Math.max(0, line.facing)) ** 2 * EDGE_SHADE + (line.back ? BACK_SHADE : 0));

  layer.clearRect(left, top, right - left, bottom - top);
  const seen = [];
  for (let index = 0; index < STRIPS; index += 1) {
    const [a, b] = [lines[index], lines[index + 1]];
    if ((a.facing + b.facing) / 2 <= 0.03) continue;
    seen.push([a, b]);
    drawTriangle(layer, image, a.sourceTop, b.sourceTop, b.sourceBottom, a.targetTop, b.targetTop, b.targetBottom);
    drawTriangle(layer, image, a.sourceTop, b.sourceBottom, a.sourceBottom, a.targetTop, b.targetBottom, a.targetBottom);
  }

  // Shading, only where the garment was drawn
  layer.save();
  layer.globalCompositeOperation = "source-atop";
  for (const [a, b] of seen) {
    const from = mid(a.targetTop, a.targetBottom);
    const to = mid(b.targetTop, b.targetBottom);
    const gradient = layer.createLinearGradient(from.x, from.y, to.x, to.y);
    gradient.addColorStop(0, `rgba(0, 0, 0, ${shade(a)})`);
    gradient.addColorStop(1, `rgba(0, 0, 0, ${shade(b)})`);
    layer.fillStyle = gradient;
    layer.beginPath();
    layer.moveTo(a.targetTop.x, a.targetTop.y);
    layer.lineTo(b.targetTop.x, b.targetTop.y);
    layer.lineTo(b.targetBottom.x, b.targetBottom.y);
    layer.lineTo(a.targetBottom.x, a.targetBottom.y);
    layer.closePath();
    layer.fill();
  }
  layer.restore();

  ctx.drawImage(layer.canvas, left, top, right - left, bottom - top, left, top, right - left, bottom - top);
};

// ---------- which pieces a garment has ----------

const has = (points, ...names) => names.every((name) => points[name]);

// Trousers and suits bend at the knee; skirts, dresses and kurtas hang as one
const LEGGED = /trouser|pant|jean|jogger|legging|short|chino|cargo|jumpsuit|suit|tracksuit|palazzo/;
const DRAPED = /skirt|dress|gown|saree|lehenga|kurta|anarkali|kaftan/;

const hasLegs = (garment) => {
  const name = (garment.garment || "").toLowerCase();
  return LEGGED.test(name) && !DRAPED.test(name);
};

// Where a lower-body garment's hem is on the person, from how far it reaches
const hemOnBody = (body, length) => {
  const hips = mid(body.leftHip, body.rightHip);
  const hipWidth = dist(body.leftHip, body.rightHip);
  const knees = has(body, "leftKnee", "rightKnee") ? mid(body.leftKnee, body.rightKnee) : add(hips, { x: 0, y: hipWidth * 2.4 });
  const ankles = has(body, "leftAnkle", "rightAnkle") ? mid(body.leftAnkle, body.rightAnkle) : add(knees, sub(knees, hips));
  switch (length) {
    case "cropped": case "waist": case "hip": return add(hips, sub(knees, hips), 0.3);
    case "thigh": return add(hips, sub(knees, hips), 0.55);
    case "knee": return knees;
    case "calf": return add(knees, sub(ankles, knees), 0.55);
    default: return ankles;
  }
};

// A garment photographed alone has no separate sleeves or legs to move: it
// is placed as one piece by three points
const flatPieces = (cut, garment, body) => {
  const s = cut.anchors;
  if (garment.region === "lower") {
    if (!has(body, "leftHip", "rightHip")) return [];
    return [{ whole: true, source: [s.leftHip, s.rightHip, s.hem],
              target: [body.leftHip, body.rightHip, hemOnBody(body, garment.length)] }];
  }
  if (!has(body, "leftShoulder", "rightShoulder", "leftHip", "rightHip")) return [];
  return [{ whole: true, source: [s.leftShoulder, s.rightShoulder, mid(s.leftHip, s.rightHip)],
            target: [body.leftShoulder, body.rightShoulder, mid(body.leftHip, body.rightHip)] }];
};

const isAccessory = (garment) => garment.region === "head" || garment.region === "face";

// A hat or eyewear: one piece that keeps its shape, moved, turned and sized
// so the eye corners it was cut out with sit on the person's eye corners
const accessoryPieces = (cut, body) => {
  const s = cut.anchors;
  if (!has(s, "leftEye", "rightEye") || !has(body, "leftEye", "rightEye")) return [];
  const square = (a, b) => ({ x: a.x - (b.y - a.y), y: a.y + (b.x - a.x) });
  return [{ whole: true, source: [s.leftEye, s.rightEye, square(s.leftEye, s.rightEye)],
            target: [body.leftEye, body.rightEye, square(body.leftEye, body.rightEye)] }];
};

// The pieces to draw, furthest from the camera first. A wrapped piece is
// { source, target, turn, depth }: its place in the cut-out (the product
// photo shows the front, facing the camera) and on the person, how far that
// part of the body has turned, and how deep it is.
const pieces = (cut, garment, body) => {
  if (isAccessory(garment)) return accessoryPieces(cut, body);
  if (cut.source === "flat") return flatPieces(cut, garment, body);
  const s = cut.anchors;
  const list = [];
  const upper = garment.region !== "lower" && has(s, "leftShoulder", "rightShoulder", "leftHip", "rightHip")
    && has(body, "leftShoulder", "rightShoulder", "leftHip", "rightHip");
  const sourceShoulders = has(s, "leftShoulder", "rightShoulder") ? turnOf(s.leftShoulder, s.rightShoulder) : null;
  const bodyShoulders = has(body, "leftShoulder", "rightShoulder") ? turnOf(body.leftShoulder, body.rightShoulder) : null;
  const sourceHipLine = has(s, "leftHip", "rightHip") ? turnOf(s.leftHip, s.rightHip) : null;
  const bodyHipLine = has(body, "leftHip", "rightHip") ? turnOf(body.leftHip, body.rightHip) : null;

  // An arm or leg turns with the body. Its own "across" may point the other
  // way from the body's, which reverses the direction of the turn.
  const limb = (frame, turn) => {
    const same = frame.topAcross.x * turn.across.x + frame.topAcross.y * turn.across.y >= 0;
    return { cos: turn.cos, sin: same ? turn.sin : -turn.sin };
  };

  if (upper) {
    const sourceTorso = dist(mid(s.leftShoulder, s.rightShoulder), mid(s.leftHip, s.rightHip));
    const hipsY = mid(s.leftHip, s.rightHip).y;
    const shouldersY = mid(s.leftShoulder, s.rightShoulder).y;
    // How far the garment reaches above the shoulders and below the hips, in torso lengths
    const above = Math.min(0.45, Math.max(0.1, shouldersY / sourceTorso));
    const full = garment.region === "full";
    const below = full ? 0.02 : Math.max(0, Math.min(1.2, (cut.height - hipsY) / sourceTorso));
    const torsoDepth = depthOf(body.leftShoulder, body.rightShoulder, body.leftHip, body.rightHip);

    // Sleeves go under the body of the garment (so it sits over their tops),
    // unless the arm is clearly nearer the camera than the torso
    const behind = [];
    const inFront = [];
    for (const side of ["left", "right"]) {
      const [shoulder, elbow, wrist] = [`${side}Shoulder`, `${side}Elbow`, `${side}Wrist`];
      if (has(s, shoulder, elbow) && has(body, shoulder, elbow) && garment.sleeves !== "sleeveless" && garment.sleeves !== "none") {
        const upperArm = boneFrame(body[shoulder], body[elbow], bodyShoulders.width * UPPER_ARM_HALF);
        behind.push({ source: boneFrame(s[shoulder], s[elbow], sourceShoulders.width * UPPER_ARM_HALF),
                      target: upperArm, turn: limb(upperArm, bodyShoulders), depth: LIMB_DEPTH });
        const long = garment.sleeves === "long" || garment.sleeves === "three-quarter";
        if (long && has(s, elbow, wrist) && has(body, elbow, wrist)) {
          const forearm = boneFrame(body[elbow], body[wrist], bodyShoulders.width * FOREARM_HALF);
          const nearer = torsoDepth - depthOf(body[elbow], body[wrist]) > bodyShoulders.width * IN_FRONT;
          (nearer ? inFront : behind).push({
            source: boneFrame(s[elbow], s[wrist], sourceShoulders.width * FOREARM_HALF),
            target: forearm, turn: limb(forearm, bodyShoulders), depth: LIMB_DEPTH,
          });
        }
      }
    }
    list.push(...behind);
    list.push({ source: torsoFrame(s, above, below, sourceShoulders, sourceHipLine),
                target: torsoFrame(body, above, below, bodyShoulders, bodyHipLine),
                turn: bodyShoulders, depth: TORSO_DEPTH });
    list.push(...inFront);
  }

  const lower = garment.region !== "upper" && sourceHipLine && bodyHipLine;
  if (lower) {
    // Without the shoulders, the hip width stands in for the body's scale
    const sourceScale = sourceShoulders ? sourceShoulders.width : sourceHipLine.width * 1.6;
    const bodyScale = bodyShoulders ? bodyShoulders.width : bodyHipLine.width * 1.6;

    if (hasLegs(garment) && has(s, "leftKnee", "rightKnee") && has(body, "leftKnee", "rightKnee")) {
      for (const side of ["left", "right"]) {
        const [hip, knee, ankle] = [`${side}Hip`, `${side}Knee`, `${side}Ankle`];
        const thigh = boneFrame(body[hip], body[knee], bodyScale * THIGH_HALF, 0.2);
        list.push({ source: boneFrame(s[hip], s[knee], sourceScale * THIGH_HALF, 0.2),
                    target: thigh, turn: limb(thigh, bodyHipLine), depth: LIMB_DEPTH });
        if (has(s, knee, ankle) && has(body, knee, ankle)) {
          const shin = boneFrame(body[knee], body[ankle], bodyScale * SHIN_HALF);
          list.push({ source: boneFrame(s[knee], s[ankle], sourceScale * SHIN_HALF),
                      target: shin, turn: limb(shin, bodyHipLine), depth: LIMB_DEPTH });
        }
      }
    } else {
      // One hanging piece from the waist to the hem
      const sourceDrop = Math.max(sourceScale * 0.3, cut.height - mid(s.leftHip, s.rightHip).y);
      const bodyDrop = sourceDrop * (bodyScale / sourceScale);
      const flare = garment.shape === "flared" || garment.shape === "a-line" ? 1.25 : 1.0;
      list.push({ source: hangFrame(s, sourceHipLine, sourceDrop, sourceScale, flare),
                  target: hangFrame(body, bodyHipLine, bodyDrop, bodyScale, flare),
                  turn: bodyHipLine, depth: SKIRT_DEPTH });
    }
  }
  return list;
};

// What the camera needs to show for this garment, and whether it does
const visibility = (garment, body) => {
  if (isAccessory(garment)) return has(body, "leftEye", "rightEye") ? "" : "Bring your face into view";
  const needsUpper = garment.region !== "lower";
  const needsLower = garment.region !== "upper";
  const upperSeen = has(body, "leftShoulder", "rightShoulder", "leftHip", "rightHip");
  const lowerSeen = has(body, "leftHip", "rightHip", "leftKnee", "rightKnee");
  if (!Object.keys(body).length) return "Stand in front of the camera";
  if (needsUpper && !upperSeen) return "Step back so your shoulders and hips are in view";
  if (needsLower && !lowerSeen) return garment.region === "full"
    ? "Step back so your whole body is in view (showing the top half for now)"
    : "Step back so your hips and knees are in view";
  return "";
};

// Draws the garment on the person for one frame. `body` holds the joints
// found, as { x, y, z } in canvas pixels (z: depth, smaller is nearer).
export const drawTryOn = (ctx, layer, cut, garment, body) => {
  for (const piece of pieces(cut, garment, body)) {
    if (piece.whole) {
      drawTriangle(ctx, cut.canvas, ...piece.source, ...piece.target, true);
    } else {
      drawWrapped(ctx, layer, cut.canvas, piece);
    }
  }
};

// ---------- the engine ----------

// Starts the live try-on on a playing <video>, drawing onto <canvas> (same
// size as the video). Returns { setGarment, stop, snapshot }.
export const startTryOn = async ({ video, canvas, onStatus }) => {
  const pose = await loadPose();
  const ctx = canvas.getContext("2d");
  // A spare canvas each piece is built on before it joins the picture
  const layer = document.createElement("canvas").getContext("2d");
  let current = null; // { cut, garment }
  let smoothed = {};
  let running = true;
  let lastStatus = null;
  let lastVideoTime = -1;
  let frames = 0;
  let since = performance.now();

  const say = (status) => {
    if (status !== lastStatus) {
      lastStatus = status;
      onStatus?.(status);
    }
  };

  const frame = () => {
    if (!running) return;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
      if (layer.canvas.width !== canvas.width) layer.canvas.width = canvas.width;
      if (layer.canvas.height !== canvas.height) layer.canvas.height = canvas.height;

      const found = pose.detectForVideo(video, performance.now()).landmarks?.[0];
      const body = {};
      if (found) {
        for (const [name, index] of Object.entries(JOINTS)) {
          const point = found[index];
          if ((point.visibility ?? 1) < VISIBLE) continue;
          // Depth is given on the same scale as the width
          const now = { x: point.x * canvas.width, y: point.y * canvas.height, z: point.z * canvas.width };
          const before = smoothed[name];
          body[name] = before
            ? { ...add(before, sub(now, before), SMOOTHING), z: before.z + (now.z - before.z) * DEPTH_SMOOTHING }
            : now;
        }
      }
      smoothed = body;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (current) {
        drawTryOn(ctx, layer, current.cut, current.garment, body);
        say(visibility(current.garment, body));
      }

      frames += 1;
      const elapsed = performance.now() - since;
      if (elapsed >= 2000) {
        canvas.dataset.fps = String(Math.round((frames * 1000) / elapsed));
        frames = 0;
        since = performance.now();
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    setGarment(cut, garment) {
      current = cut && garment ? { cut, garment } : null;
      lastStatus = null;
    },
    stop() {
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    // The camera frame with the garment on it, as the person sees it (mirrored).
    // Made on the device; nothing is uploaded.
    snapshot() {
      const shot = document.createElement("canvas");
      shot.width = canvas.width;
      shot.height = canvas.height;
      const shotContext = shot.getContext("2d");
      shotContext.translate(shot.width, 0);
      shotContext.scale(-1, 1);
      shotContext.drawImage(video, 0, 0, shot.width, shot.height);
      shotContext.drawImage(canvas, 0, 0);
      return new Promise((resolve) => shot.toBlob(resolve, "image/jpeg", 0.92));
    },
  };
};
