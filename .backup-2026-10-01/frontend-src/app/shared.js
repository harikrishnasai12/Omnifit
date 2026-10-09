// Constants and helpers shared by the app (moved out of App.jsx).
export const PERSONALIZE_STORAGE_KEY = "omnifit.personalize";
export const SHARE_CACHE = "omnifit-share";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const REGION_STORAGE_KEY = "omnifit.region";
export const SHOPPING_STORAGE_KEY = "omnifit.shopping";
export const TASTE_STORAGE_KEY = "omnifit.taste";
export const SIZES_STORAGE_KEY = "omnifit.sizes";
export const MEASUREMENTS_STORAGE_KEY = "omnifit.measurements";
export const AGE_GROUP_STORAGE_KEY = "omnifit.ageGroup";
export const PERSONAL_STORAGE_KEY = "omnifit.personal";

// Chosen by the user, never detected; only used for accessories and colours
export const FACE_SHAPE_CHOICES = [
  { key: "oval", label: "Oval", hint: "Longer than wide, gently rounded jaw" },
  { key: "round", label: "Round", hint: "About as wide as long, soft curves" },
  { key: "square", label: "Square", hint: "Wide forehead and a strong, angular jaw" },
  { key: "heart", label: "Heart", hint: "Wider forehead, narrower chin" },
  { key: "long", label: "Long", hint: "Clearly longer than wide, straight sides" },
  { key: "diamond", label: "Diamond", hint: "Widest at the cheekbones" },
];

export const UNDERTONE_CHOICES = [
  { key: "warm", label: "Warm", hint: "Gold jewellery tends to glow on you; veins look greenish" },
  { key: "cool", label: "Cool", hint: "Silver tends to glow on you; veins look bluish or purple" },
  { key: "neutral", label: "Neutral", hint: "Both gold and silver work; hard to tell" },
];

// Chosen by the user (never estimated from a photo); OmniFit is 12+
export const AGE_GROUP_CHOICES = [
  { key: "gen_z", label: "Gen Z", ages: "12–29" },
  { key: "millennial", label: "Millennials", ages: "30–45" },
  { key: "gen_x", label: "Gen X", ages: "46–61" },
  { key: "boomer", label: "Boomers", ages: "62+" },
];

// Size choices in "My Style"; waist in inches, footwear in UK sizes
export const SIZE_CHOICES = {
  top: { label: "Tops", hint: "Shirts, tees, kurtas, jackets", options: ["XS", "S", "M", "L", "XL", "XXL", "3XL"] },
  bottom: { label: "Bottoms (waist)", hint: "Jeans, trousers, chinos", options: ["26", "28", "30", "32", "34", "36", "38", "40", "42"] },
  footwear: { label: "Footwear (UK)", hint: "Sneakers, loafers, heels", options: ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] },
};

// Same rules as normalize_size in backend/catalog.py: "UK 8" -> "8", "2XL" -> "XXL"
export const normalizeSize = (label) => {
  let text = String(label || "").toUpperCase().replace(/[\s-]+/g, "");

  if (["FREE", "FREESIZE", "ONESIZE", "OS", "ONESIZEFITSALL"].includes(text)) {
    return "FREE";
  }

  text = text.replace(/^(UK|IND|IN)/, "");
  text = { "2XL": "XXL", "3XL": "XXXL", "4XL": "XXXXL" }[text] || text;

  const number = text.match(/^(\d{1,2})(W|UK|IN)?$/);
  return number ? number[1] : text;
};

// Per-browser conveniences only; the page works without them
export const readStored = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || null;
  } catch {
    return null;
  }
};

export const writeStored = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, blocked site data): ignore
  }
};

export const readSavedRegion = () => readStored(REGION_STORAGE_KEY);
export const saveRegion = (value) => writeStored(REGION_STORAGE_KEY, value);

export const DEPARTMENT_OPTIONS = [
  { value: "auto", label: "Auto ✨" },
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "unisex", label: "Unisex" },
];

export const DEPARTMENT_NAMES = {
  men: "Menswear",
  women: "Womenswear",
  unisex: "Unisex",
};

// The conversation, kept per browser tab (sessionStorage). Photos are
// browser-only links that don't survive a refresh, so they're left out.
export const CHAT_SESSION_KEY = "omnifit.chat";

export const readSessionChat = () => {
  try {
    return JSON.parse(sessionStorage.getItem(CHAT_SESSION_KEY) || "null");
  } catch {
    return null;
  }
};

export const writeSessionChat = (messages, activeId) => {
  try {
    const kept = messages
      .filter((message) => message.status !== "working")
      .slice(-30)
      .map((message) => ({ ...message, photo: message.photo ? null : message.photo, hadPhoto: Boolean(message.photo) || message.hadPhoto }));
    sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify({ messages: kept, activeId }));
  } catch {
    // Storage full or blocked: the chat still works, it just won't survive a refresh
  }
};

// Page shown for the address bar's #hash (Back and Forward work)
export const viewFromHash = () => {
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  const known = ["explore", "stylist", "tryon", "you", "library", "wardrobe"];
  // Links from before the redesign
  const renamed = { "#foryou": "home", "#closet": "you" };
  const legacy = Object.keys(renamed).find((old) => hash.startsWith(old));
  return legacy ? renamed[legacy] : known.find((view) => hash.startsWith(`#${view}`)) || "home";
};

// Voice input: the browser records, OmniFit's own server turns it into text
// (works in every modern browser; no outside speech service)
export const CAN_RECORD =
  typeof window !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof window.MediaRecorder !== "undefined";

export const MAX_RECORDING_MS = 20000;

export const VOICE_LANGUAGES = [
  { code: "en-IN", label: "English" },
  { code: "ta-IN", label: "தமிழ்" },
  { code: "hi-IN", label: "हिन्दी" },
];

export const VOICE_LANGUAGE_KEY = "omnifit.voiceLanguage";

export const OCCASION_ICONS = {
  wedding: "💍",
  festival: "🪔",
  office: "💼",
  party: "🎉",
  casual: "🎒",
  date: "☕",
  travel: "✈️",
};

export const WEATHER_ICONS = {
  hot: "☀️",
  warm: "🌤️",
  mild: "⛅",
  cool: "🌥️",
  cold: "❄️",
  rain: "🌧️",
};

// Fabric words in product titles, and when they suit today's weather
export const BREATHABLE_FABRICS = /\b(linen|cotton|khadi|chambray|seersucker|mul|muslin|chikankari)\b/i;
export const WARM_FABRICS = /\b(wool|woollen|woolen|merino|fleece|knit|knitted|corduroy|flannel|velvet|sherpa)\b/i;

export const fabricNote = (title, weather) => {
  if (!weather || !title) {
    return null;
  }
  const breathable = title.match(BREATHABLE_FABRICS);
  if (breathable && (weather.feel === "hot" || weather.feel === "warm")) {
    return `🌿 ${breathable[1].charAt(0).toUpperCase()}${breathable[1].slice(1).toLowerCase()}: breathable for today`;
  }
  const warm = title.match(WARM_FABRICS);
  if (warm && (weather.feel === "cool" || weather.feel === "cold")) {
    return `🧣 ${warm[1].charAt(0).toUpperCase()}${warm[1].slice(1).toLowerCase()}: warm for today`;
  }
  return null;
};

export const BUDGET_PRESETS = [
  { id: "any", min: null, max: null },
  { id: "under-500", min: null, max: 500 },
  { id: "500-1500", min: 500, max: 1500 },
  { id: "1500-3000", min: 1500, max: 3000 },
  { id: "3000-plus", min: 3000, max: null },
];

export const NO_BUDGET = { preset: "any", min: null, max: null };

// Most-used entries first, e.g. the styles a user keeps asking for
export const topKeys = (counts, limit) =>
  Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);

export const getBrowserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
};
