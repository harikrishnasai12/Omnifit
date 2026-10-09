// My Mannequin, step 1: reading a person's photos.
//
// From a front photo (and, better, a side and a back one) plus the person's
// height, this works out their body measurements and the outline the 3D
// mannequin is shaped from. It runs in the browser with MediaPipe (models
// served by OmniFit from /mediapipe):
//   - the pose: where the shoulders, hips, knees and ankles are, and
//   - the silhouette: which pixels are the person.
// The front photo gives widths, the side photo depths; together they give
// the distance round the chest, waist and hips. Without a side photo, depth
// is estimated from width and the result says so.
//
// Each photo is checked first (one person, whole body in view, turned the
// right way), so a bad photo is refused with a reason instead of measured.

const JOINTS = {
  nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
};
const VISIBLE = 0.5;
// Enough to say an ankle is in the picture at all
const FAINT = 0.2;
// Top of the head to the hip joints, as a share of a person's height
const HEAD_TO_HIPS = 0.47;
const MAX_SIDE = 960;
// The part of the photo the person is in, for the outline finder: how far
// above the highest joint (the head and hair) and below the ankles (the
// feet) it reaches, in shoulder-to-hip lengths
const PERSON_ABOVE_JOINTS = 0.75;
const PERSON_BELOW_ANKLES = 0.4;
// The longer side of that part, in pixels, when it is drawn for the finders
const PERSON_SIDE = 768;
// MediaPipe's multiclass segmenter: 0 background, 1 hair, 2 body skin,
// 3 face skin, 4 clothes, 5 accessories and others
const BACKGROUND = 0;
const HAIR = 1;
const CLOTHES = 4;

// Down the torso, as a share of the shoulder-to-hip distance: where each
// measurement is taken, and the levels the mannequin's outline is sampled at
export const LEVELS = { chest: 0.26, waist: 0.7, hip: 1.06 };
export const PROFILE_LEVELS = [0, 0.12, 0.26, 0.42, 0.56, 0.7, 0.84, 0.96, 1.06, 1.18];

// Without a side photo: how deep the body usually is compared with its width
const USUAL_DEPTH = { chest: 0.74, waist: 0.8, hip: 0.76 };
// The pose finder puts the shoulder joints inside the body; its outer width is wider
const SHOULDER_BREADTH = 1.18;
// The widest a torso is, in shoulder-joint widths. A run wider than this
// includes an arm, so it isn't a measurement of the torso.
const TORSO_LIMIT = 1.12;
// How wide a torso usually is at each level, in shoulder-joint widths: used
// only where the photo can't be measured
const usualWidth = (level) => {
  const points = [[0, 1.04], [0.26, 0.92], [0.7, 0.8], [1.06, 0.98], [1.18, 0.96]];
  for (let i = 1; i < points.length; i += 1) {
    if (level <= points[i][0]) {
      const [l0, w0] = points[i - 1];
      const [l1, w1] = points[i];
      return w0 + ((w1 - w0) * (level - l0)) / (l1 - l0);
    }
  }
  return points.at(-1)[1];
};

let toolsPromise = null;
const loadTools = () => {
  if (!toolsPromise) {
    toolsPromise = (async () => {
      const { FilesetResolver, ImageSegmenter, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const [segmenter, pose] = await Promise.all([
        ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/mediapipe/selfie_multiclass_256x256.tflite", delegate: "CPU" },
          runningMode: "IMAGE", outputCategoryMask: true, outputConfidenceMasks: false,
        }),
        PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/mediapipe/pose_landmarker_full.task", delegate: "CPU" },
          runningMode: "IMAGE", numPoses: 2,
        }),
      ]);
      return { segmenter, pose };
    })().catch((error) => {
      toolsPromise = null;
      throw error;
    });
  }
  return toolsPromise;
};

const loadImage = (source) =>
  new Promise((resolve, reject) => {
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => reject(new Error("Couldn't read that photo."));
    image.src = url;
  });

const VIEW_NAMES = { front: "front", side: "side", back: "back" };

// Reads one photo. `view`: "front", "side" or "back".
// Returns { ok: false, message } or { ok: true, view, canvas, joints, ... }
// with what measure() needs.
export const readPhoto = async (source, view) => {
  const { segmenter, pose } = await loadTools();
  const image = await loadImage(source);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0, width, height);

  // The joints found in a picture, placed in the photo by `place` (a point of
  // the picture, 0 to 1 across and down, to photo pixels)
  const jointsIn = (picture, place) => {
    const found = pose.detect(picture).landmarks || [];
    const joints = {};
    for (const [joint, index] of Object.entries(JOINTS)) {
      const point = found[0]?.[index];
      if (point) joints[joint] = { ...place(point), seen: (point.visibility ?? 1) >= VISIBLE, faint: (point.visibility ?? 1) >= FAINT };
    }
    return { people: found.length, joints };
  };
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const frameOf = (joints) => {
    const shoulders = mid(joints.leftShoulder, joints.rightShoulder);
    const hips = mid(joints.leftHip, joints.rightHip);
    return {
      shoulders, hips,
      torso: Math.hypot(hips.x - shoulders.x, hips.y - shoulders.y),
      across: Math.abs(joints.leftShoulder.x - joints.rightShoulder.x),
      // Feet in the picture: the whole height gives the scale. Long trousers,
      // dark shoes or a dark floor make ankles hard to see, so a faint sighting
      // of either one is enough. Without them the photo is still used: the scale
      // then comes from the upper body, and the legs take usual proportions.
      feet: (joints.leftAnkle.faint || joints.rightAnkle.faint) && Math.max(joints.leftAnkle.y, joints.rightAnkle.y) < height * 0.995,
    };
  };

  const whole = jointsIn(canvas, (point) => ({ x: point.x * width, y: point.y * height }));
  const name = VIEW_NAMES[view];
  if (!whole.people) {
    return { ok: false, message: `I couldn't find a person in the ${name} photo. Stand 2 to 3 metres away, head to feet in view.` };
  }
  if (whole.people > 1) {
    return { ok: false, message: `There's more than one person in the ${name} photo. Please use one of just you.` };
  }
  let joints = whole.joints;
  // What must be in the photo: the shoulders and the hips. Each missing part
  // is named, so the person knows what to change.
  const has = (...names) => names.every((joint) => joints[joint].seen);
  if (!has("leftShoulder", "rightShoulder")) {
    return { ok: false, message: `I can't see both your shoulders in the ${name} photo. Stand facing the camera with nothing in front of you.` };
  }
  if (!has("leftHip", "rightHip")) {
    return { ok: false, message: `The ${name} photo stops above your hips. Step back until the picture shows you at least from your head to your hips; head to feet measures best.` };
  }

  // The joint finder and the outline finder both work on a small fixed grid
  // whatever they are given, so how big the person is in the photo changes
  // what they report. So the photo is read twice: once whole, to find the
  // person, then just the part they are in, drawn at one standard size from
  // the photo as it was given. The same person then gets the same detail
  // whether they fill the photo or stand small in a corner of it, and a
  // measurement doesn't change with how the photo was framed.
  const first = frameOf(joints);
  const seenJoints = Object.values(joints).filter((joint) => joint.seen);
  const reach = Math.max(first.across, first.torso * 0.35) * 0.9;
  const feetBelow = first.feet ? Math.max(joints.leftAnkle.y, joints.rightAnkle.y) + first.torso * PERSON_BELOW_ANKLES : height;
  const box = {
    left: Math.max(0, Math.floor(Math.min(...seenJoints.map((joint) => joint.x)) - reach)),
    top: Math.max(0, Math.floor(Math.min(...seenJoints.map((joint) => joint.y)) - first.torso * PERSON_ABOVE_JOINTS)),
    right: Math.min(width, Math.ceil(Math.max(...seenJoints.map((joint) => joint.x)) + reach)),
    bottom: Math.min(height, Math.ceil(Math.max(feetBelow, ...seenJoints.map((joint) => joint.y)))),
  };
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;
  const cropScale = PERSON_SIDE / Math.max(box.width, box.height);
  const cropped = document.createElement("canvas");
  cropped.width = Math.round(box.width * cropScale);
  cropped.height = Math.round(box.height * cropScale);
  cropped.getContext("2d", { willReadFrequently: true }).drawImage(
    image, box.left / scale, box.top / scale, box.width / scale, box.height / scale, 0, 0, cropped.width, cropped.height,
  );

  // The joints again, from the person-sized picture: used when it finds the
  // same one person with shoulders and hips in view
  const close = jointsIn(cropped, (point) => ({ x: box.left + point.x * box.width, y: box.top + point.y * box.height }));
  if (close.people === 1 && ["leftShoulder", "rightShoulder", "leftHip", "rightHip"].every((joint) => close.joints[joint]?.seen)) {
    joints = close.joints;
  }
  const { shoulders, hips, torso, across, feet } = frameOf(joints);
  // Facing the camera (or away from it) the shoulders are wide; side-on they overlap
  if (view !== "side" && across < torso * 0.42) {
    return { ok: false, message: `In the ${name} photo, please face ${view === "back" ? "away from" : ""} the camera squarely.` };
  }
  if (view === "side" && across > torso * 0.36) {
    return { ok: false, message: "In the side photo, please turn fully sideways to the camera." };
  }

  // The silhouette: every pixel that is part of the person
  const mask = segmenter.segment(cropped).categoryMask;
  const labels = mask.getAsUint8Array().slice();
  const maskWidth = mask.width;
  const maskHeight = mask.height;
  mask.close();
  // What the outline finder says is at a point of the photo (background outside the person's box)
  const labelAt = (x, y) => {
    if (x < box.left || y < box.top || x >= box.right || y >= box.bottom) return BACKGROUND;
    const column = Math.min(maskWidth - 1, Math.floor(((x - box.left) / box.width) * maskWidth));
    const row = Math.min(maskHeight - 1, Math.floor(((y - box.top) / box.height) * maskHeight));
    return labels[row * maskWidth + column];
  };
  const person = (x, y) => labelAt(x, y) !== BACKGROUND;

  // Head to floor, for the scale: followed outwards from the body itself
  // (up from the nose, down from the ankles), within the body's own width,
  // so a busy background or a second figure far away isn't taken for it.
  const xs = Object.values(joints).filter((joint) => joint.seen).map((joint) => joint.x);
  const margin = Math.max(across, torso * 0.35) * 0.6;
  const bandLeft = Math.max(0, Math.floor(Math.min(...xs) - margin));
  const bandRight = Math.min(width - 1, Math.ceil(Math.max(...xs) + margin));
  const rowHasPerson = (y) => {
    let count = 0;
    for (let x = bandLeft; x <= bandRight; x += 2) if (person(x, y)) count += 1;
    return count * 2 > torso * 0.04;
  };
  // A few empty rows are tolerated (a gap in the outline at the neck or ankle)
  const follow = (from, step) => {
    let edge = Math.round(from);
    let empty = 0;
    for (let y = edge; y >= 0 && y < height && empty < torso * 0.04; y += step) {
      if (rowHasPerson(y)) {
        edge = y;
        empty = 0;
      } else {
        empty += 1;
      }
    }
    return edge;
  };
  const top = follow(joints.nose.seen ? joints.nose.y : shoulders.y, -1);
  const bottom = feet ? follow(Math.max(joints.leftAnkle.y, joints.rightAnkle.y), 1) : height - 1;
  // How much of the person's height the measured span is: all of it head to
  // floor, or head to hip joints (about 47% of a person's height)
  const span = feet ? { pixels: bottom - top, share: 1 } : { pixels: hips.y - top, share: HEAD_TO_HIPS };
  if (span.pixels < height * 0.25) {
    return { ok: false, message: `You're too small in the ${name} photo to measure. Stand closer, or crop the photo so you fill most of it.` };
  }
  // With no space left above the head or below the feet the scale is less sure
  const tight = top <= 1 || (feet && bottom >= height - 2);

  const body = (x, y) => {
    const label = labelAt(x, y);
    return label !== BACKGROUND && label !== HAIR;
  };

  // The unbroken run of the body through (x, y), left to right. Long hair
  // over the shoulders is not body. With `torsoOnly`, bare skin beyond the
  // edge of the clothing ends the run: that is an arm lying against the body,
  // not more of the torso.
  const runAt = (x, y, torsoOnly = false) => {
    const row = Math.round(y);
    let centre = Math.round(x);
    // The spine may fall in a gap (an open jacket, a gap in the mask): look nearby
    for (let step = 0; !body(centre, row) && step < width * 0.06; step += 1) {
      if (body(centre + step, row)) centre += step;
      else if (body(centre - step, row)) centre -= step;
    }
    if (!body(centre, row)) return null;
    const edge = (direction) => {
      let at = centre;
      let clothed = labelAt(centre, row) === CLOTHES;
      for (;;) {
        const next = at + direction;
        if (!body(next, row)) break;
        const clothes = labelAt(next, row) === CLOTHES;
        if (torsoOnly && clothed && !clothes) break;
        clothed = clothed || clothes;
        at = next;
      }
      return at;
    };
    const left = edge(-1);
    const right = edge(1);
    return { left, right, width: right - left + 1 };
  };

  return {
    ok: true, view, canvas, width, height, joints, shoulders, hips, torso, top, bottom, tight, feet, span, runAt,
    // The photo as it was given, for the face (the measuring copy is smaller)
    original: image, originalScale: scale,
  };
};

// The distance round an ellipse (Ramanujan), from its two half-widths
const around = (a, b) => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
const round1 = (value) => Math.round(value * 10) / 10;

// A point down the torso: 0 at the shoulders, 1 at the hip joints
const down = (photo, level) => ({
  x: photo.shoulders.x + (photo.hips.x - photo.shoulders.x) * level,
  y: photo.shoulders.y + (photo.hips.y - photo.shoulders.y) * level,
});

// Body measurements and the mannequin's outline, in centimetres.
// `photos`: { front, side?, back? } from readPhoto(); `heightCm`: the
// person's height. Returns { ok: false, message } or { ok: true, ... }.
export const measure = (photos, heightCm) => {
  const { front, side, back } = photos;
  if (!front) return { ok: false, message: "A front photo is needed to measure." };
  if (!(heightCm >= 120 && heightCm <= 220)) return { ok: false, message: "Enter your height (120 to 220 cm) so the photos can be measured to scale." };

  // Centimetres per pixel: the person's height over the part of them the photo shows
  const scaleOf = (photo) => (heightCm * photo.span.share) / photo.span.pixels;
  const frontScale = scaleOf(front);
  const jointWidth = Math.hypot(front.joints.leftShoulder.x - front.joints.rightShoulder.x, front.joints.leftShoulder.y - front.joints.rightShoulder.y);

  // The body's width at a level, from the front (and the back, when given):
  // the torso's own run through the spine. When an arm in a sleeve lies
  // against the body the two can't be told apart, and the run comes out
  // wider than a torso can be next to these shoulders: that level is then
  // NOT measured, and takes the usual proportion instead (and says so).
  let estimatedLevels = 0;
  const widthAt = (level) => {
    const widths = [];
    let estimated = false;
    for (const photo of [front, back]) {
      if (!photo) continue;
      const point = down(photo, level);
      const run = photo.runAt(point.x, point.y, true);
      if (!run) continue;
      const shoulder = Math.hypot(photo.joints.leftShoulder.x - photo.joints.rightShoulder.x, photo.joints.leftShoulder.y - photo.joints.rightShoulder.y);
      const merged = run.width > shoulder * TORSO_LIMIT;
      // Too narrow to be a torso: the outline broke up (a strap, a shadow)
      const broken = run.width < shoulder * 0.45;
      if (merged || broken) estimated = true;
      widths.push((merged || broken ? shoulder * usualWidth(level) : run.width) * scaleOf(photo));
    }
    if (estimated) estimatedLevels += 1;
    return widths.length ? widths.reduce((sum, value) => sum + value, 0) / widths.length : null;
  };
  // Front to back, from the side photo
  const depthAt = (level) => {
    if (!side) return null;
    const point = down(side, level);
    const run = side.runAt(point.x, point.y);
    return run ? run.width * scaleOf(side) : null;
  };

  const usual = (level) => (level < 0.5 ? USUAL_DEPTH.chest : level < 0.9 ? USUAL_DEPTH.waist : USUAL_DEPTH.hip);
  const profile = [];
  for (const level of PROFILE_LEVELS) {
    const width = widthAt(level);
    if (!width) return { ok: false, message: "I couldn't follow your outline in the front photo. Try a plainer background and clothes that fit closely." };
    const measuredDepth = depthAt(level);
    // An arm hanging at the side adds to the depth seen side-on; never deeper than wide
    const depth = Math.min(measuredDepth || width * usual(level), width * 1.05);
    profile.push({ level, halfWidth: round1(width / 2), halfDepth: round1(depth / 2) });
  }
  const ring = (level) => {
    const nearest = profile.reduce((best, entry) => (Math.abs(entry.level - level) < Math.abs(best.level - level) ? entry : best));
    return around(nearest.halfWidth, nearest.halfDepth);
  };
  // The waist is the narrowest part of the torso and the hip the widest part
  // below it, wherever on this person (and under these clothes) they fall
  const between = (from, to) => profile.filter((entry) => entry.level >= from && entry.level <= to);
  const waistRing = between(0.42, 0.84).reduce((best, entry) => (entry.halfWidth < best.halfWidth ? entry : best));
  const hipRing = between(0.96, 1.18).reduce((best, entry) => (entry.halfWidth > best.halfWidth ? entry : best));

  const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * frontScale;
  const j = front.joints;
  const arm = (sideName) =>
    j[`${sideName}Elbow`].seen && j[`${sideName}Wrist`].seen
      ? length(j[`${sideName}Shoulder`], j[`${sideName}Elbow`]) + length(j[`${sideName}Elbow`], j[`${sideName}Wrist`])
      : null;
  const arms = [arm("left"), arm("right")].filter(Boolean);
  const torsoLength = front.torso * frontScale;
  // Without the feet in the photo, the legs are as long as legs usually are
  const hipJointHeight = front.feet ? (front.bottom - front.hips.y) * frontScale : heightCm * (1 - HEAD_TO_HIPS);

  // A leg's width part of the way down it
  const legWidth = (from, to, share) => {
    const widths = ["left", "right"].map((sideName) => {
      const a = j[`${sideName}${from}`];
      const b = j[`${sideName}${to}`];
      if (!a.seen || !b.seen) return null;
      const run = front.runAt(a.x + (b.x - a.x) * share, a.y + (b.y - a.y) * share);
      // Legs together read as one run: no more than a leg can be
      return run ? Math.min(run.width * frontScale, heightCm * 0.13) : null;
    }).filter(Boolean);
    return widths.length ? widths.reduce((sum, value) => sum + value, 0) / widths.length : null;
  };

  const measurements = {
    height: heightCm,
    shoulder: round1(jointWidth * frontScale * SHOULDER_BREADTH),
    chest: round1(ring(LEVELS.chest)),
    waist: round1(around(waistRing.halfWidth, waistRing.halfDepth)),
    hip: round1(around(hipRing.halfWidth, hipRing.halfDepth)),
    torso: round1(torsoLength),
    arm: round1(arms.length ? arms.reduce((sum, value) => sum + value, 0) / arms.length : heightCm * 0.33),
    // Crotch to floor: the hip joints are a little above the crotch
    inseam: round1(hipJointHeight - torsoLength * 0.16),
    hipJointHeight: round1(hipJointHeight),
    thigh: round1(legWidth("Hip", "Knee", 0.35) || heightCm * 0.1),
    calf: round1(legWidth("Knee", "Ankle", 0.35) || heightCm * 0.065),
  };

  // Outside what an adult body can be: the photo was taken at an angle, or the outline was wrong
  if (measurements.chest < 60 || measurements.chest > 160 || measurements.hip < 65 || measurements.hip > 170 || measurements.waist < 50) {
    return { ok: false, message: "The measurements came out unusual. Use photos taken straight on at waist height, against a plain background." };
  }

  const notes = [];
  if (!front.feet) {
    notes.push("Your feet aren't in the front photo, so the scale comes from your upper body and your legs use usual proportions. A head-to-feet photo measures better.");
  }
  if (!side) notes.push("No side photo: how deep your body is was estimated from its width, so chest, waist and hip may be off by a few centimetres.");
  if (!back) notes.push("No back photo: widths come from the front photo alone.");
  if (estimatedLevels >= PROFILE_LEVELS.length / 2) {
    notes.push("Your arms were against your body in the photo, so its width couldn't be measured there and usual proportions were used. Hold your arms a little away from your sides for a real measurement.");
  }
  // The face is copied from the front photo as it is: a turned head gives a skewed face
  if (j.nose.seen && j.leftEar.seen && j.rightEar.seen) {
    // Facing the camera, the nose is midway between the ears
    const toLeft = Math.abs(j.leftEar.x - j.nose.x);
    const toRight = Math.abs(j.rightEar.x - j.nose.x);
    if (Math.max(toLeft, toRight) > Math.min(toLeft, toRight) * 1.7 + 1) {
      notes.push("Your head is turned in the front photo, so the face on the mannequin is skewed. Look straight at the camera for a better one.");
    }
  }
  if ([front, side, back].some((photo) => photo?.tight)) {
    notes.push("A photo has no space above your head or below your feet, so every measurement may be a little small. A photo with a margin measures better.");
  }
  notes.push("Measured from photos: loose clothes add to the numbers. Check them against a tape if you can, and correct any that are off.");

  return { ok: true, measurements, profile, depthMeasured: Boolean(side), notes };
};

// A photo small enough to keep in the profile (the server's limit is 1.5 MB)
export const photoForProfile = (photo) =>
  new Promise((resolve) => {
    const scale = Math.min(1, 800 / Math.max(photo.canvas.width, photo.canvas.height));
    const small = document.createElement("canvas");
    small.width = Math.round(photo.canvas.width * scale);
    small.height = Math.round(photo.canvas.height * scale);
    small.getContext("2d").drawImage(photo.canvas, 0, 0, small.width, small.height);
    small.toBlob(resolve, "image/jpeg", 0.82);
  });
