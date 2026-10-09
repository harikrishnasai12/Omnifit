// My Mannequin: the person's face, for the mannequin's head.
//
// Found with MediaPipe Face Landmarker, on this device. The face is cut from
// the photo at its ORIGINAL resolution (the copy used for measuring the body
// is much smaller), straightened so the eyes are level, and framed the same
// way every time, so it sits correctly on the head: chin on the chin, eyes on
// the eyes. A close-up photo of the face gives the clearest result; from a
// full-length photo the face is only as sharp as that photo's few face pixels.

const SIZE = 512;
// Landmark numbers in MediaPipe Face Mesh
const P = { top: 10, chin: 152, cheekLeft: 234, cheekRight: 454, eyeLeft: 263, eyeRight: 33, nose: 1 };
// The framing of the picture: how much wider than the cheeks, and taller
// than forehead-to-chin, the square is
const FRAME_WIDTH = 1.5;
const FRAME_HEIGHT = 1.42;
// Fewer face pixels than this across the cheeks looks soft on the mannequin
const SHARP_ENOUGH = 110;

let landmarkerPromise = null;
const loadLandmarker = () => {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate: "CPU" },
        runningMode: "IMAGE",
        numFaces: 1,
      });
    })().catch((error) => {
      landmarkerPromise = null;
      throw error;
    });
  }
  return landmarkerPromise;
};

const loadImage = (source) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => reject(new Error("Couldn't read that photo."));
    image.src = url;
  });

const colourAt = (context, x, y, size = 10) => {
  const data = context.getImageData(Math.max(0, Math.round(x - size / 2)), Math.max(0, Math.round(y - size / 2)), size, size).data;
  let r = 0, g = 0, b = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    r += data[offset]; g += data[offset + 1]; b += data[offset + 2];
  }
  const count = data.length / 4;
  return [r / count, g / count, b / count];
};
const rgb = (...colours) => {
  const mean = (channel) => Math.round(colours.reduce((sum, colour) => sum + colour[channel], 0) / colours.length);
  return `rgb(${mean(0)}, ${mean(1)}, ${mean(2)})`;
};

// Finds the face inside one region of an image and returns it framed for
// the head, or null when no face is found there.
const frameFace = async (image, region) => {
  const landmarker = await loadLandmarker();
  // The region, no larger than the landmarker needs
  const scale = Math.min(1, 900 / Math.max(region.width, region.height));
  const work = document.createElement("canvas");
  work.width = Math.max(1, Math.round(region.width * scale));
  work.height = Math.max(1, Math.round(region.height * scale));
  work.getContext("2d").drawImage(image, region.x, region.y, region.width, region.height, 0, 0, work.width, work.height);

  const found = landmarker.detect(work).faceLandmarks?.[0];
  if (!found) return null;
  // Landmarks, in the image's own pixels
  const at = (index) => ({
    x: region.x + (found[index].x * work.width) / scale,
    y: region.y + (found[index].y * work.height) / scale,
  });
  const points = Object.fromEntries(Object.entries(P).map(([name, index]) => [name, at(index)]));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // How far the eyes are from level
  const roll = Math.atan2(points.eyeLeft.y - points.eyeRight.y, points.eyeLeft.x - points.eyeRight.x);
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  // The face as it is seen, with the eyes level: the box round every point
  // of it. Straight on, that is cheek to cheek and forehead to chin; with the
  // head turned it is still the whole face that shows, and nothing else.
  const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (let index = 0; index < found.length; index += 1) {
    const point = at(index);
    const across = point.x * cos + point.y * sin;
    const down = point.y * cos - point.x * sin;
    box.left = Math.min(box.left, across);
    box.right = Math.max(box.right, across);
    box.top = Math.min(box.top, down);
    box.bottom = Math.max(box.bottom, down);
  }
  const cheeks = box.right - box.left;
  const length = box.bottom - box.top;
  const middle = { across: (box.left + box.right) / 2, down: (box.top + box.bottom) / 2 };
  const centre = { x: middle.across * cos - middle.down * sin, y: middle.across * sin + middle.down * cos };
  const frame = Math.max(cheeks * FRAME_WIDTH, length * FRAME_HEIGHT);

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingQuality = "high";
  context.translate(SIZE / 2, SIZE / 2);
  context.rotate(-roll);
  context.scale(SIZE / frame, SIZE / frame);
  context.drawImage(image, -centre.x, -centre.y);
  context.setTransform(1, 0, 0, 1, 0, 0);

  const pixelsPerUnit = SIZE / frame;
  const turned = Math.abs(points.nose.x - (points.cheekLeft.x + points.cheekRight.x) / 2) / distance(points.cheekLeft, points.cheekRight);
  const skin = [-0.22, 0.22].map((side) => colourAt(context, SIZE / 2 + cheeks * side * pixelsPerUnit, SIZE / 2 + length * 0.12 * pixelsPerUnit));
  // Hair: just above the forehead, at the spot least like the skin (a high
  // forehead puts skin where hair would be on someone else)
  const unlikeSkin = (colour) => skin.reduce((sum, tone) => sum + Math.hypot(colour[0] - tone[0], colour[1] - tone[1], colour[2] - tone[2]), 0);
  const light = (colour) => colour[0] * 0.3 + colour[1] * 0.59 + colour[2] * 0.11;
  const skinLight = (light(skin[0]) + light(skin[1])) / 2;
  const above = [[0, 0.6], [0, 0.68], [-0.2, 0.62], [0.2, 0.62], [-0.34, 0.5], [0.34, 0.5]]
    .map(([side, up]) => colourAt(context, SIZE / 2 + cheeks * side * pixelsPerUnit, Math.max(6, SIZE / 2 - length * up * pixelsPerUnit), 8));
  // Much brighter than the skin is a lit wall or the sky behind, not hair
  const likely = above.filter((colour) => light(colour) < skinLight + 30);
  const hair = (likely.length ? likely : above).sort((a, b) => unlikeSkin(b) - unlikeSkin(a))[0];
  return {
    canvas,
    // Where the face is in the picture, as shares of its size: used to put it on the head
    cheekShare: cheeks / frame,
    lengthShare: length / frame,
    // Longer or rounder: the head takes the face's own proportions
    aspect: length / cheeks,
    // Skin from both cheeks' inner sides; hair from just above the forehead
    skin: rgb(...skin),
    hair: rgb(hair),
    // How many of the photo's own pixels the face is across: its real sharpness
    sharpness: Math.round(cheeks),
    soft: cheeks < SHARP_ENOUGH,
    turned: turned > 0.1,
  };
};

// The face from a full-length photo read by measure.js readPhoto(): looked
// for around the head, in the photo's original pixels.
export const faceFromBodyPhoto = async (photo) => {
  const j = photo.joints;
  if (!j.nose.seen) return null;
  const k = 1 / photo.originalScale;
  const ears = j.leftEar.seen && j.rightEar.seen ? Math.abs(j.leftEar.x - j.rightEar.x) : photo.torso * 0.3;
  const size = Math.max(ears * 3.4, photo.torso * 0.75) * k;
  const image = photo.original;
  const x = Math.max(0, j.nose.x * k - size / 2);
  const y = Math.max(0, j.nose.y * k - size / 2);
  const region = { x, y, width: Math.min(size, image.naturalWidth - x), height: Math.min(size, image.naturalHeight - y) };
  return frameFace(image, region);
};

// The face from a close-up photo (a selfie): the clearest
export const faceFromCloseUp = async (file) => {
  const image = await loadImage(file);
  return frameFace(image, { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight });
};

// The framed face as a small file, to keep in the profile
export const faceForProfile = (face) =>
  new Promise((resolve) => {
    face.canvas.toBlob(resolve, "image/jpeg", 0.9);
  });

// A face saved earlier (already framed): read back as it was
export const faceFromSaved = async (blob, details) => {
  const image = await loadImage(blob);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0, SIZE, SIZE);
  return { ...details, canvas };
};
