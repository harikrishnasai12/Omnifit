// Face shape for the Style Scan, worked out on the device.
//
// Runs in the browser with MediaPipe Face Landmarker (model and engine are
// served by OmniFit from /mediapipe), so the selfie isn't sent anywhere for
// this. It measures proportions between landmarks (face length, cheekbone,
// jaw and forehead widths) and picks the closest of six shapes. It reads the
// face's outline only: nothing about age, gender or who the person is.
// The result is an estimate, shown for the user to accept or ignore.

// Landmark numbers in MediaPipe Face Mesh
const P = {
  top: 10, chin: 152,            // upper forehead, bottom of the chin
  cheekLeft: 234, cheekRight: 454,   // widest points of the face
  jawLeft: 172, jawRight: 397,       // jaw corners
  browLeft: 54, browRight: 284,      // forehead width at the temples
  nose: 1,
};

// What suits each shape (same guidance the stylist uses)
const ACCESSORY_TIPS = {
  oval: "Most earring, frame and necklace styles work for you; try statement pieces and any frame shape.",
  round: "Angular or rectangular frames, long drop or linear earrings, and V-necklines or longer necklaces suit you.",
  square: "Round or oval frames, hoops and rounded earrings, and scoop necklines with softer curves suit you.",
  heart: "Teardrop or chandelier earrings that are fuller at the bottom, light or rimless frames, and chokers suit you.",
  long: "Wide or oversized frames, studs and cluster earrings, and chokers or shorter necklaces suit you.",
  diamond: "Oval or cat-eye frames, studs or teardrop earrings, and collar-length necklaces suit you.",
};

let landmarkerPromise = null;

const loadLandmarker = () => {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate: "CPU" },
        runningMode: "IMAGE",
        numFaces: 2,
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

// The shape whose proportions are closest. `ratios`: length, jaw and forehead
// widths, each relative to the cheekbone width.
const classify = ({ length, jaw, forehead }) => {
  if (length >= 1.45) return "long";
  if (forehead - jaw >= 0.1 && jaw < 0.78) return "heart";
  if (forehead < 0.8 && jaw < 0.8) return "diamond";
  if (length <= 1.27 && jaw >= 0.85) return "square";
  if (length <= 1.2) return "round";
  return "oval";
};

// Returns { ok: false, message } or
// { ok: true, face_shape, face_shape_confidence, accessory_tip, ratios }
export const scanFace = async (file) => {
  const landmarker = await loadLandmarker();
  const { image, url } = await loadImage(file);
  let result;
  try {
    result = landmarker.detect(image);
  } finally {
    URL.revokeObjectURL(url);
  }

  const faces = result?.faceLandmarks || [];
  if (faces.length === 0) {
    return { ok: false, message: "I couldn't find a face. Face the camera in good light, with your whole face in view." };
  }
  if (faces.length > 1) {
    return { ok: false, message: "I can see more than one face. Please scan just yourself." };
  }

  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const points = Object.fromEntries(
    Object.entries(P).map(([name, index]) => [name, { x: faces[0][index].x * width, y: faces[0][index].y * height }])
  );
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // Turned to one side: the nose sits far from the middle of the face
  const cheek = distance(points.cheekLeft, points.cheekRight);
  const offCentre = Math.abs(points.nose.x - (points.cheekLeft.x + points.cheekRight.x) / 2) / cheek;
  if (offCentre > 0.12) {
    return { ok: false, message: "Please face the camera straight on, with your chin level." };
  }

  const ratios = {
    length: distance(points.top, points.chin) / cheek,
    jaw: distance(points.jawLeft, points.jawRight) / cheek,
    forehead: distance(points.browLeft, points.browRight) / cheek,
  };
  const shape = classify(ratios);

  // Proportions close to another shape's range are only a best guess
  const nudged = [
    { ...ratios, length: ratios.length + 0.04 },
    { ...ratios, length: ratios.length - 0.04 },
    { ...ratios, jaw: ratios.jaw + 0.03 },
    { ...ratios, jaw: ratios.jaw - 0.03 },
  ];
  const stable = nudged.every((nearby) => classify(nearby) === shape);

  return {
    ok: true,
    face_shape: shape,
    face_shape_confidence: stable ? "medium" : "low",
    accessory_tip: ACCESSORY_TIPS[shape],
    ratios,
  };
};
