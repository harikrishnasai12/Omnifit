// Body Scan: estimates body measurements from one full-length photo.
//
// Runs entirely in the browser with MediaPipe Pose (model and engine are
// served by OmniFit from /mediapipe), so the photo never leaves the device.
// The user's height sets the scale; body proportions from the pose give the
// rest. Circumferences from a single front photo are approximate, so every
// result is shown for the user to confirm or edit before it is saved.

const CM_PER_INCH = 2.54;

// Eye height is about 93.6% of standing height (adult anthropometric average)
const EYE_HEIGHT_RATIO = 0.936;

// From pose joint positions to body measurements (averages; see results note)
const SHOULDER_BREADTH_FACTOR = 1.12; // shoulder joints -> outer shoulders
const CHEST_FROM_SHOULDERS = 2.4; //      shoulder breadth -> chest circumference
const HIP_BREADTH_FACTOR = 1.55; //       hip joints -> hip breadth
const HIP_FROM_BREADTH = 2.75; //         hip breadth -> hip circumference
const WAIST_FROM_HIP = { men: 0.9, women: 0.78, default: 0.84 };

// Landmark numbers in MediaPipe Pose
const L = {
  nose: 0, leftEye: 2, rightEye: 5,
  leftShoulder: 11, rightShoulder: 12,
  leftHip: 23, rightHip: 24,
  leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
  leftFoot: 31, rightFoot: 32,
};

const REQUIRED = ["nose", "leftShoulder", "rightShoulder", "leftHip", "rightHip", "leftAnkle", "rightAnkle"];

let landmarkerPromise = null;

const loadLandmarker = () => {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/mediapipe/pose_landmarker_full.task", delegate: "CPU" },
        runningMode: "IMAGE",
        numPoses: 2,
      });
    })().catch((error) => {
      landmarkerPromise = null;
      throw error;
    });
  }
  return landmarkerPromise;
};

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read the photo."));
    };
    image.src = url;
  });

const roundHalf = (inches) => Math.round(inches * 2) / 2;

// Returns { ok, message } or { ok, measurements: {chest, waist, hip, shoulder, inseam} (inches), notes }
export const scanBody = async (file, heightCm, section = "default") => {
  if (!(heightCm >= 120 && heightCm <= 220)) {
    return { ok: false, message: "Enter your height (120–220 cm) so I can measure to scale." };
  }

  const landmarker = await loadLandmarker();
  const { image, url } = await loadImage(file);
  let result;
  try {
    result = landmarker.detect(image);
  } finally {
    URL.revokeObjectURL(url);
  }

  const poses = result?.landmarks || [];
  if (poses.length === 0) {
    return { ok: false, message: "I couldn't find a person. Stand 2–3 metres from the camera, head to toe in the frame." };
  }
  if (poses.length > 1) {
    return { ok: false, message: "I can see more than one person. Please scan just yourself." };
  }

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const points = Object.fromEntries(
    Object.entries(L).map(([name, index]) => {
      const point = poses[0][index];
      return [name, { x: point.x * width, y: point.y * height, visible: (point.visibility ?? 1) > 0.5 }];
    })
  );

  if (REQUIRED.some((name) => !points[name].visible)) {
    return { ok: false, message: "Your whole body needs to be in view, from head to feet. Step back a little." };
  }

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const shoulderPx = distance(points.leftShoulder, points.rightShoulder);
  const hipPx = distance(points.leftHip, points.rightHip);
  const torsoPx = distance(
    { x: (points.leftShoulder.x + points.rightShoulder.x) / 2, y: (points.leftShoulder.y + points.rightShoulder.y) / 2 },
    { x: (points.leftHip.x + points.rightHip.x) / 2, y: (points.leftHip.y + points.rightHip.y) / 2 }
  );

  // Turned sideways: shoulders look narrow next to the torso
  if (shoulderPx < torsoPx * 0.45) {
    return { ok: false, message: "Please face the camera straight on, arms slightly away from your body." };
  }

  // Scale from the user's height: eyes to the floor ≈ 93.6% of height
  const eyeY = Math.min(
    points.leftEye.visible ? points.leftEye.y : points.nose.y,
    points.rightEye.visible ? points.rightEye.y : points.nose.y
  );
  const floorY = Math.max(
    ...["leftHeel", "rightHeel", "leftFoot", "rightFoot", "leftAnkle", "rightAnkle"]
      .filter((name) => points[name].visible)
      .map((name) => points[name].y)
  );
  const staturePx = (floorY - eyeY) / EYE_HEIGHT_RATIO;
  const cmPerPx = heightCm / staturePx;

  const shoulderCm = shoulderPx * cmPerPx * SHOULDER_BREADTH_FACTOR;
  const chestCm = shoulderCm * CHEST_FROM_SHOULDERS;
  const hipCm = hipPx * cmPerPx * HIP_BREADTH_FACTOR * HIP_FROM_BREADTH;
  const waistCm = hipCm * (WAIST_FROM_HIP[section] || WAIST_FROM_HIP.default);
  const inseamCm = ((distance(points.leftHip, points.leftAnkle) + distance(points.rightHip, points.rightAnkle)) / 2) * cmPerPx;

  const measurements = {
    chest: roundHalf(chestCm / CM_PER_INCH),
    waist: roundHalf(waistCm / CM_PER_INCH),
    hip: roundHalf(hipCm / CM_PER_INCH),
    shoulder: roundHalf(shoulderCm / CM_PER_INCH),
    inseam: roundHalf(inseamCm / CM_PER_INCH),
  };

  // Outside normal adult ranges: the photo was probably taken at an angle
  const plausible = measurements.chest >= 26 && measurements.chest <= 60 && measurements.hip >= 28 && measurements.hip <= 64;
  if (!plausible) {
    return { ok: false, message: "The measurements came out unusual. Hold the camera straight, at waist height, and try again." };
  }

  return {
    ok: true,
    measurements,
    notes: [
      "Chest, waist and hip are estimated from your proportions and can be off by 1–2 inches: check them against a tape if you can.",
      "Shoulder and inseam are measured more directly from the photo.",
    ],
  };
};
