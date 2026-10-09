// Live Try-On: the garment's shape, cut out of the product photo.
//
// Runs in the browser with MediaPipe (models served by OmniFit from
// /mediapipe). Two things are read from the store's photo:
//   - which pixels are clothing (image segmentation), and
//   - the pose of the model wearing it (shoulders, elbows, hips, knees...).
// Together with what Gemma said about the garment (the body region it covers
// and how far it reaches), that gives a cut-out of just this garment, plus
// the body points it sits on. The try-on engine lines those points up with
// the same points on the person in the camera.

// Landmark numbers in MediaPipe Pose
const JOINTS = {
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  // The outer corners of the eyes: hats and eyewear are placed by these
  leftEye: 3, rightEye: 6,
};

// Clothing in MediaPipe's multiclass segmenter (0 background, 1 hair,
// 2 body skin, 3 face skin, 4 clothes, 5 accessories and others)
const CLOTHES = 4;
const ACCESSORIES = 5;
const VISIBLE = 0.5;
const MAX_SIDE = 720;

let toolsPromise = null;

const loadTools = () => {
  if (!toolsPromise) {
    toolsPromise = (async () => {
      const { FilesetResolver, ImageSegmenter, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const [segmenter, pose] = await Promise.all([
        ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/mediapipe/selfie_multiclass_256x256.tflite", delegate: "CPU" },
          runningMode: "IMAGE",
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        }),
        PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/mediapipe/pose_landmarker_full.task", delegate: "CPU" },
          runningMode: "IMAGE",
          numPoses: 1,
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

const loadPhoto = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    // The stores' image host allows this, so the pixels can be read
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Couldn't load the product photo."));
    image.src = url;
  });

// How far down the body the garment's lowest edge is, as a y position
// worked out from the model's own joints
const hemLine = (length, y) => {
  const torso = y.hip - y.shoulder;
  switch (length) {
    case "cropped": return y.shoulder + torso * 0.7;
    case "waist": return y.hip - torso * 0.05;
    case "hip": return y.hip + torso * 0.22;
    case "thigh": return y.hip + (y.knee - y.hip) * 0.55;
    case "knee": return y.knee + (y.ankle - y.knee) * 0.08;
    case "calf": return y.knee + (y.ankle - y.knee) * 0.55;
    case "ankle": return y.ankle;
    default: return y.ankle + torso * 0.25; // floor
  }
};

// Returns { ok: false, message } or
// { ok: true, canvas, width, height, anchors, region, source }
//   canvas  : the garment on a transparent background
//   anchors : body points in canvas pixels (only those found), e.g.
//             { leftShoulder: {x, y}, rightHip: {x, y}, ... }
//   source  : "model" (photo of someone wearing it) or "flat" (garment alone)
export const cutGarment = async (photoUrl, garment) => {
  const { segmenter, pose } = await loadTools();
  const photo = await loadPhoto(photoUrl);

  const scale = Math.min(1, MAX_SIDE / Math.max(photo.naturalWidth, photo.naturalHeight));
  const width = Math.round(photo.naturalWidth * scale);
  const height = Math.round(photo.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(photo, 0, 0, width, height);

  // The model's pose in the photo (none for a garment photographed alone)
  const posed = pose.detect(canvas).landmarks?.[0];
  const anchors = {};
  if (posed) {
    for (const [name, index] of Object.entries(JOINTS)) {
      const point = posed[index];
      if ((point.visibility ?? 1) >= VISIBLE) {
        anchors[name] = { x: point.x * width, y: point.y * height };
      }
    }
  }
  const hasTorso = anchors.leftShoulder && anchors.rightShoulder && anchors.leftHip && anchors.rightHip;

  if (garment.region === "head" || garment.region === "face") {
    return cutAccessory({ canvas, context, width, height, anchors, garment, segmenter });
  }

  // Clothing pixels
  const segmented = segmenter.segment(canvas);
  const mask = segmented.categoryMask;
  const labels = mask.getAsUint8Array();
  const maskWidth = mask.width;
  const maskHeight = mask.height;

  // The part of the body this garment covers, from top to its hem
  let top = 0;
  let bottom = height;
  if (hasTorso) {
    const average = (a, b, fallback) => (a && b ? (a.y + b.y) / 2 : a?.y ?? b?.y ?? fallback);
    const y = { shoulder: average(anchors.leftShoulder, anchors.rightShoulder), hip: average(anchors.leftHip, anchors.rightHip) };
    const torso = y.hip - y.shoulder;
    y.knee = average(anchors.leftKnee, anchors.rightKnee, y.hip + torso * 0.95);
    y.ankle = average(anchors.leftAnkle, anchors.rightAnkle, y.knee + torso * 0.95);
    const waist = y.hip - torso * 0.22;
    top = garment.region === "lower" ? waist : Math.max(0, y.shoulder - torso * 0.35);
    bottom = Math.min(height, hemLine(garment.length, y));
  }

  const pixels = context.getImageData(0, 0, width, height);
  let kept = 0;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let row = 0; row < height; row += 1) {
    const maskRow = Math.min(maskHeight - 1, Math.floor((row / height) * maskHeight));
    const inRange = row >= top && row <= bottom;
    for (let column = 0; column < width; column += 1) {
      const maskColumn = Math.min(maskWidth - 1, Math.floor((column / width) * maskWidth));
      const clothing = inRange && labels[maskRow * maskWidth + maskColumn] === CLOTHES;
      const offset = (row * width + column) * 4;
      if (clothing) {
        kept += 1;
        if (column < minX) minX = column;
        if (column > maxX) maxX = column;
        if (row < minY) minY = row;
        if (row > maxY) maxY = row;
      } else {
        pixels.data[offset + 3] = 0;
      }
    }
  }
  mask.close();

  // A garment photographed alone (no model): the clothing detector only knows
  // clothes on a person, so remove the plain background by colour instead
  let flat = false;
  if (kept < width * height * 0.02 && !hasTorso) {
    context.drawImage(photo, 0, 0, width, height);
    const alone = context.getImageData(0, 0, width, height);
    const outline = removeBackground(alone, width, height);
    if (outline) {
      flat = true;
      pixels.data.set(alone.data);
      ({ minX, minY, maxX, maxY } = outline);
      kept = outline.kept;
    }
  }

  // Too little clothing found to draw anything recognisable
  if (kept < width * height * 0.02) {
    return { ok: false, message: "I couldn't pick the garment out of this product's photo. Try another product." };
  }
  context.putImageData(pixels, 0, 0);

  // Trim to the garment, and soften its edge a little
  const cutWidth = maxX - minX + 1;
  const cutHeight = maxY - minY + 1;
  const cut = document.createElement("canvas");
  cut.width = cutWidth;
  cut.height = cutHeight;
  const cutContext = cut.getContext("2d");
  cutContext.filter = "blur(0.6px)";
  cutContext.drawImage(canvas, minX, minY, cutWidth, cutHeight, 0, 0, cutWidth, cutHeight);

  // Trousers and skirts are often photographed from the waist down. The pose
  // finder needs more of a body than that, so no hips are found: place the
  // garment by its own outline instead, like one photographed alone.
  if (garment.region === "lower" && !(anchors.leftHip && anchors.rightHip)) {
    flat = true;
  }

  const placed = {};
  if (flat) {
    const solid = (x, y) => pixels.data[((y + minY) * width + x + minX) * 4 + 3] > 0;
    Object.assign(placed, flatAnchors(garment, cutWidth, cutHeight, solid));
  } else {
    for (const [name, point] of Object.entries(anchors)) {
      placed[name] = { x: point.x - minX, y: point.y - minY };
    }
  }

  return {
    ok: true,
    canvas: cut,
    width: cutWidth,
    height: cutHeight,
    anchors: placed,
    region: garment.region,
    source: flat ? "flat" : "model",
  };
};

// How a hat or eyewear relates to the outer corners of the eyes, in
// eye-to-eye distances: how wide it is, and (for a hat) how far above the
// eyes its band sits
const HAT_CROWN_WIDTH = 1.8;
const HAT_BAND_ABOVE_EYES = 0.4;
const EYEWEAR_WIDTH = 1.45;

// A hat ("head") or eyewear ("face"). Its anchors are the two eye corners:
// the model's own when the photo shows it being worn, estimated from its
// outline when it was photographed alone.
const cutAccessory = ({ canvas, context, width, height, anchors, garment, segmenter }) => {
  const failed = { ok: false, message: "I couldn't pick this out of the product's photo. Try another product." };
  const head = garment.region === "head";
  const pixels = context.getImageData(0, 0, width, height);
  const worn = anchors.leftEye && anchors.rightEye;
  let bounds;

  if (worn) {
    // Worn by a model: the accessory pixels around the head or the eyes
    const eyes = { x: (anchors.leftEye.x + anchors.rightEye.x) / 2, y: (anchors.leftEye.y + anchors.rightEye.y) / 2 };
    const apart = Math.hypot(anchors.leftEye.x - anchors.rightEye.x, anchors.leftEye.y - anchors.rightEye.y);
    const box = head
      ? { left: eyes.x - apart * 2.5, right: eyes.x + apart * 2.5, top: 0, bottom: eyes.y - apart * 0.15 }
      : { left: eyes.x - apart * 1.2, right: eyes.x + apart * 1.2, top: eyes.y - apart * 0.55, bottom: eyes.y + apart * 0.55 };
    const mask = segmenter.segment(canvas).categoryMask;
    const labels = mask.getAsUint8Array();
    let kept = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let row = 0; row < height; row += 1) {
      const maskRow = Math.min(mask.height - 1, Math.floor((row / height) * mask.height));
      for (let column = 0; column < width; column += 1) {
        const maskColumn = Math.min(mask.width - 1, Math.floor((column / width) * mask.width));
        const label = labels[maskRow * mask.width + maskColumn];
        const inBox = row >= box.top && row <= box.bottom && column >= box.left && column <= box.right;
        if (inBox && (label === ACCESSORIES || (head && label === CLOTHES))) {
          kept += 1;
          if (column < minX) minX = column;
          if (column > maxX) maxX = column;
          if (row < minY) minY = row;
          if (row > maxY) maxY = row;
        } else {
          pixels.data[(row * width + column) * 4 + 3] = 0;
        }
      }
    }
    mask.close();
    if (kept < apart * apart * 0.3) return failed;
    bounds = { minX, minY, maxX, maxY };
  } else {
    bounds = removeBackground(pixels, width, height);
    if (!bounds || bounds.kept < width * height * 0.02) return failed;
  }
  context.putImageData(pixels, 0, 0);

  const { minX, minY } = bounds;
  const cutWidth = bounds.maxX - minX + 1;
  const cutHeight = bounds.maxY - minY + 1;
  const cut = document.createElement("canvas");
  cut.width = cutWidth;
  cut.height = cutHeight;
  const cutContext = cut.getContext("2d");
  cutContext.filter = "blur(0.6px)";
  cutContext.drawImage(canvas, minX, minY, cutWidth, cutHeight, 0, 0, cutWidth, cutHeight);

  let placed;
  if (worn) {
    placed = {
      leftEye: { x: anchors.leftEye.x - minX, y: anchors.leftEye.y - minY },
      rightEye: { x: anchors.rightEye.x - minX, y: anchors.rightEye.y - minY },
    };
  } else if (head) {
    // The crown (above any brim) is about as wide as the head; the band is
    // near the bottom of the outline, and the eyes are below it
    const crownY = Math.round(cutHeight * 0.3);
    const solid = (x, y) => pixels.data[((y + minY) * width + x + minX) * 4 + 3] > 0;
    let left = 0;
    let right = cutWidth - 1;
    while (left < right && !solid(left, crownY)) left += 1;
    while (right > left && !solid(right, crownY)) right -= 1;
    const apart = (right - left) / HAT_CROWN_WIDTH;
    const centre = (left + right) / 2;
    const eyeY = cutHeight * 0.8 + apart * HAT_BAND_ABOVE_EYES;
    placed = { leftEye: { x: centre + apart / 2, y: eyeY }, rightEye: { x: centre - apart / 2, y: eyeY } };
  } else {
    const apart = cutWidth / EYEWEAR_WIDTH;
    placed = {
      leftEye: { x: cutWidth / 2 + apart / 2, y: cutHeight * 0.45 },
      rightEye: { x: cutWidth / 2 - apart / 2, y: cutHeight * 0.45 },
    };
  }

  return { ok: true, canvas: cut, width: cutWidth, height: cutHeight, anchors: placed, region: garment.region, source: worn ? "model" : "flat" };
};

// Makes the plain background of a garment-only photo transparent: every
// pixel reachable from the photo's edges whose colour is close to the edge
// colour. Returns the garment's bounds, or null if nothing is left.
const BACKGROUND_TOLERANCE = 34;

const removeBackground = (imageData, width, height) => {
  const data = imageData.data;
  const corner = (x, y) => {
    const offset = (y * width + x) * 4;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  // The background colour: the average of the four corners
  const corners = [corner(0, 0), corner(width - 1, 0), corner(0, height - 1), corner(width - 1, height - 1)];
  const background = [0, 1, 2].map((channel) => corners.reduce((sum, colour) => sum + colour[channel], 0) / 4);
  const isBackground = (index) => {
    const offset = index * 4;
    return Math.abs(data[offset] - background[0]) + Math.abs(data[offset + 1] - background[1])
      + Math.abs(data[offset + 2] - background[2]) < BACKGROUND_TOLERANCE * 3;
  };

  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const visit = (index) => {
    if (!seen[index] && isBackground(index)) {
      seen[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < width; x += 1) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index < width * (height - 1)) visit(index + width);
  }

  let kept = 0;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let index = 0; index < width * height; index += 1) {
    if (seen[index]) {
      data[index * 4 + 3] = 0;
      continue;
    }
    kept += 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // Nearly everything kept means the background wasn't plain
  if (!kept || kept > width * height * 0.9) return null;
  return { kept, minX, minY, maxX, maxY };
};

const HIP_JOINTS_IN_WAISTBAND = 0.6;

// Where the body points would be on a garment laid flat, from its outline
// and how far Gemma said it reaches (front view: the wearer's left is on
// the right of the photo)
const flatAnchors = (garment, width, height, solid) => {
  if (garment.region === "lower") {
    // The hip joints sit inside the waistband, about 0.6 of its width apart.
    // The waistband is measured from the outline (wide legs or a flared hem
    // make the whole cut-out much wider than the waist).
    const waistY = Math.round(height * 0.06);
    let left = 0;
    let right = width - 1;
    while (left < right && !solid(left, waistY)) left += 1;
    while (right > left && !solid(right, waistY)) right -= 1;
    const centre = (left + right) / 2;
    const half = (right - left) * HIP_JOINTS_IN_WAISTBAND * 0.5;
    return {
      leftHip: { x: centre + half, y: waistY },
      rightHip: { x: centre - half, y: waistY },
      hem: { x: centre, y: height },
    };
  }
  const shoulderY = Math.round(height * 0.13);
  // The garment's hem: its lowest point down the middle (sleeves, which can
  // hang lower or lie out to the sides, are not in the middle)
  let hemY = 0;
  for (let x = Math.round(width * 0.42); x <= width * 0.58; x += 1) {
    let y = height - 1;
    while (y > shoulderY && !solid(x, y)) y -= 1;
    if (y > hemY) hemY = y;
  }
  // The shoulders: a little inside the outline at shoulder height, and never
  // out on a sleeve lying to the side
  let left = 0;
  let right = width - 1;
  while (left < right && !solid(left, shoulderY)) left += 1;
  while (right > left && !solid(right, shoulderY)) right -= 1;
  const sleeveless = garment.sleeves === "sleeveless" || garment.sleeves === "none";
  const centre = (left + right) / 2;
  const half = Math.min((right - left) * 0.38, width * (sleeveless ? 0.5 : 0.31));
  // The torso length that puts the hips where this length of garment has them
  const reach = { cropped: 0.7, waist: 0.95, hip: 1.22, thigh: 1.6, knee: 2.0, calf: 2.5, ankle: 3.0, floor: 3.2 }[garment.length] || 1.22;
  const torso = (hemY - shoulderY) / reach;
  return {
    leftShoulder: { x: centre + half, y: shoulderY },
    rightShoulder: { x: centre - half, y: shoulderY },
    leftHip: { x: centre + half * 0.8, y: shoulderY + torso },
    rightHip: { x: centre - half * 0.8, y: shoulderY + torso },
  };
};
