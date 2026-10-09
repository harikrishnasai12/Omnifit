// Optional part of the Style Scan: a guess at the age group and shopping
// section from the selfie, for the user to confirm or correct.
//
// Runs entirely in the browser (face-api's small age/gender model, served by
// OmniFit from /faceapi): the photo is not sent anywhere for this and nothing
// is stored. Only used when the user ticks the box on the consent screen.
// The model is often wrong (age is typically off by several years), so the
// result is only ever a suggestion: it is never applied by itself and never
// used to decide whether someone is an adult.

// Sure enough to suggest a section; below this, no section is suggested
const SECTION_CONFIDENCE = 0.9;

let apiPromise = null;

const loadApi = () => {
  if (!apiPromise) {
    apiPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("/faceapi"),
        faceapi.nets.ageGenderNet.loadFromUri("/faceapi"),
      ]);
      return faceapi;
    })().catch((error) => {
      apiPromise = null;
      throw error;
    });
  }
  return apiPromise;
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

// The app's age groups (the same keys as Style DNA)
const ageGroupFor = (age) => {
  if (age < 30) return "gen_z";
  if (age < 46) return "millennial";
  if (age < 62) return "gen_x";
  return "boomer";
};

// Returns { age_group, section } (section may be null), or null when no
// guess could be made. Never throws for a missing face.
export const suggestAgeAndSection = async (file) => {
  const faceapi = await loadApi();
  const { image, url } = await loadImage(file);
  let detection;
  try {
    detection = await faceapi
      .detectSingleFace(image, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
      .withAgeAndGender();
  } finally {
    URL.revokeObjectURL(url);
  }
  if (!detection || !Number.isFinite(detection.age)) {
    return null;
  }

  const sure = detection.genderProbability >= SECTION_CONFIDENCE;
  return {
    age_group: ageGroupFor(detection.age),
    section: sure ? (detection.gender === "male" ? "men" : "women") : null,
  };
};
