// Size advice from body measurements (inches), using standard Indian size
// charts. Brands vary, so results are labelled as a starting point.
// Everything here runs in the browser: measurements never leave the device.

// Top sizes by chest / bust: the largest measurement each size fits
const TOP_CHARTS = {
  men: [["XS", 36], ["S", 38], ["M", 40], ["L", 42], ["XL", 44], ["XXL", 46], ["3XL", 48]],
  women: [["XS", 32], ["S", 34], ["M", 36], ["L", 38], ["XL", 40], ["XXL", 42], ["3XL", 44]],
};

const BOTTOM_SIZES = [26, 28, 30, 32, 34, 36, 38, 40, 42];

// Accepted ranges, to catch typos (e.g. centimetres typed as inches)
export const MEASUREMENT_FIELDS = [
  { key: "chest", label: "Chest / bust", hint: "Around the fullest part, under the arms", min: 26, max: 60 },
  { key: "waist", label: "Waist", hint: "Where you wear your trousers", min: 22, max: 56 },
  { key: "hip", label: "Hip", hint: "Around the widest part", min: 28, max: 64 },
  { key: "foot", label: "Foot length", hint: "Heel to longest toe, standing", min: 7, max: 13 },
];

export const FIT_PREFERENCES = [
  { key: "snug", label: "Snug" },
  { key: "regular", label: "Regular" },
  { key: "relaxed", label: "Relaxed" },
];

const valid = (value, field) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= field.min && number <= field.max ? number : null;
};

export const measurementError = (measurements) => {
  for (const field of MEASUREMENT_FIELDS) {
    const raw = measurements?.[field.key];
    if (raw !== undefined && raw !== "" && valid(raw, field) === null) {
      return `${field.label} should be between ${field.min} and ${field.max} inches.`;
    }
  }
  return "";
};

const topSize = (chest, chart, fit, notes) => {
  const sizes = TOP_CHARTS[chart];
  let index = sizes.findIndex(([, upTo]) => chest <= upTo);
  if (index === -1) {
    index = sizes.length - 1;
    notes.push(`Your chest is above this chart's largest size (${sizes.at(-1)[0]}); check the brand's own chart.`);
  }

  // Within half an inch of the next size: say so
  const [label, upTo] = sizes.at(index);
  const next = sizes.at(index + 1);
  if (next && upTo - chest <= 0.5 && fit !== "relaxed") {
    notes.push(`Tops: you're between ${label} and ${next[0]}. ${label} for a closer fit, ${next[0]} for a looser one.`);
  }

  if (fit === "relaxed" && index < sizes.length - 1) {
    index += 1;
    notes.push(`Tops: one size up (${sizes.at(index)[0]}) for the relaxed fit you prefer. Oversized styles already run big, so keep ${label} for those.`);
  }
  return sizes.at(index)[0];
};

const bottomSize = (waist, hip, chart, notes) => {
  const fromWaist = Math.ceil(waist / 2) * 2;
  // Women's bottoms are often limited by the hip: size 28 fits hips up to
  // about 37″, 30 up to 39″, 32 up to 41″ (size ≈ hip − 9)
  const fromHip = chart === "women" && hip ? Math.ceil((hip - 9) / 2) * 2 : 0;
  const size = Math.max(fromWaist, fromHip);

  if (size > BOTTOM_SIZES.at(-1)) {
    notes.push(`Bottoms: you're above this chart's largest waist (${BOTTOM_SIZES.at(-1)}); check the brand's own chart.`);
    return String(BOTTOM_SIZES.at(-1));
  }
  if (fromHip > fromWaist) {
    notes.push(`Bottoms: size ${size} fits your hips; a belt or a stretch fabric takes care of the waist.`);
  }
  return String(Math.max(size, BOTTOM_SIZES[0]));
};

// UK shoe size from foot length: UK ≈ 3 × foot (in) − 23
const footwearSize = (foot) => String(Math.min(12, Math.max(3, Math.round(3 * foot - 23))));

export const suggestSizes = (measurements, chart, fit = "regular") => {
  const notes = [];
  const value = (key) => valid(measurements?.[key], MEASUREMENT_FIELDS.find((f) => f.key === key));
  const chest = value("chest");
  const waist = value("waist");
  const hip = value("hip");
  const foot = value("foot");

  const sizes = {};
  if (chest && TOP_CHARTS[chart]) {
    sizes.top = topSize(chest, chart, fit, notes);
  }
  if (waist) {
    sizes.bottom = bottomSize(waist, hip, chart, notes);
  }
  if (foot) {
    sizes.footwear = footwearSize(foot);
  }
  return { sizes, notes };
};

// A note about the garment's cut, from the product title (never about the person)
export const fitNote = (title) => {
  const text = String(title || "").toLowerCase();
  if (/\b(oversized?|boxy|baggy|drop[- ]shoulder)\b/.test(text)) {
    return "Oversized cut: take your usual size for the loose look, or one size down for a closer fit.";
  }
  if (/\b(slim|skinny|muscle|fitted|bodycon)\b/.test(text)) {
    return "Slim cut: if you're between sizes, size up.";
  }
  if (/\b(relaxed|loose|wide[- ]leg|straight)\b/.test(text)) {
    return "Relaxed cut: your usual size gives an easy fit.";
  }
  if (/\b(regular|classic)\b/.test(text)) {
    return "Regular fit: your usual size.";
  }
  return null;
};
