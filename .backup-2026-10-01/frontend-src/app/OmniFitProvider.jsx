import { useRef, useState, useEffect } from "react";
import { suggestSizes } from "../sizing";
import { API_BASE_URL, api } from "../api";
import { OmniFitContext } from "./context";
import { rememberGuestIntent, uploadGuestSignals } from "./lookFeed";
import { PERSONALIZE_STORAGE_KEY, SHARE_CACHE, ACCEPTED_IMAGE_TYPES, SHOPPING_STORAGE_KEY, TASTE_STORAGE_KEY, SIZES_STORAGE_KEY, MEASUREMENTS_STORAGE_KEY, AGE_GROUP_STORAGE_KEY, PERSONAL_STORAGE_KEY, FACE_SHAPE_CHOICES, UNDERTONE_CHOICES, AGE_GROUP_CHOICES, SIZE_CHOICES, normalizeSize, readStored, writeStored, readSavedRegion, saveRegion, DEPARTMENT_NAMES, readSessionChat, writeSessionChat, viewFromHash, CAN_RECORD, MAX_RECORDING_MS, VOICE_LANGUAGES, VOICE_LANGUAGE_KEY, WEATHER_ICONS, fabricNote, NO_BUDGET, topKeys, getBrowserTimezone } from "./shared";

// The app's state and actions (moved out of App.jsx unchanged). Screens and
// dialogs read them with useOmniFit().
export function OmniFitProvider({ children }) {
  const [image, setImage] = useState(null);
  const [question, setQuestion] = useState("");
  const [recommendation, setRecommendation] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [error, setError] = useState("");

  const [regions, setRegions] = useState([]);
  const [regionCode, setRegionCode] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);

  const [department, setDepartment] = useState(
    () => readStored(SHOPPING_STORAGE_KEY)?.department || "auto"
  );
  const [budget, setBudget] = useState(
    () => readStored(SHOPPING_STORAGE_KEY)?.budget || NO_BUDGET
  );
  // Latest product lookup; `key` identifies which request it answers
  const [productState, setProductState] = useState({ key: null, results: null, priceRange: null });

  // Cards switched to "Show all colours", remembered only for the current answer
  const [anyColour, setAnyColour] = useState({ rec: null, ids: [] });

  // Plain item searches ("wide leg trousers") show every colour and model
  // straight from the catalog instead of stylist cards
  const [browseRequest, setBrowseRequest] = useState(null); // { question, colour }
  const [browseState, setBrowseState] = useState({ key: null, data: null });

  // Rough position + today's weather (see updateWeather)
  const [coords, setCoords] = useState(null);
  const [weather, setWeather] = useState(null);

  // Occasions (For You cards, occasion chips on answers)
  const [occasions, setOccasions] = useState([]);

  // "How to wear it" tips, by piece: { [key]: { status, ways, error } }
  const [howToWear, setHowToWear] = useState({});

  // Index of the look whose share card is being drawn
  const [sharing, setSharing] = useState(null);

  // The AI conversation: messages, the one whose answer is shown in full.
  // Kept for this browser tab, so a refresh doesn't lose the conversation.
  const [messages, setMessages] = useState(() => readSessionChat()?.messages || []);
  const [activeMessageId, setActiveMessageId] = useState(() => readSessionChat()?.activeId || null);
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef(null);

  // For You: the AI-written daily feed { key, status, data, error }
  const [feedState, setFeedState] = useState({ key: null, status: "idle", data: null, error: "" });

  // Camera is used for outfit photos and for the opt-in Style Scan
  const [cameraPurpose, setCameraPurpose] = useState("outfit");
  // Style Scan: { status: "consent" | "scanning" | "result" | "error", result, error }
  const [styleScan, setStyleScan] = useState(null);

  // Body Scan: { status: "intro" | "measuring" | "result" | "error" | "saved", heightCm, values, notes, error }
  const [bodyScan, setBodyScan] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const bodyFileRef = useRef(null);

  // Photo menu in the chat composer
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);

  // Voice input and read-aloud
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voiceLanguage, setVoiceLanguage] = useState(
    () => readStored(VOICE_LANGUAGE_KEY) || "en-IN"
  );
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef(null);

  // Styles and stores this user tends to pick, kept only on their device
  const tasteRef = useRef(readStored(TASTE_STORAGE_KEY) || { styles: {}, stores: {} });

  // --------------------------------
  // ACCOUNT + STYLE LIBRARY STATE
  // --------------------------------

  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  // Taste profile built from the Style Library (server side)
  const [libraryTaste, setLibraryTaste] = useState(null);
  const [googleClientId, setGoogleClientId] = useState(null);
  // { reason } while the sign-in dialog is open
  const [authPrompt, setAuthPrompt] = useState(null);
  const [view, setView] = useState(viewFromHash);
  // Closet = Style DNA ("closet"), My Wardrobe and Saved looks
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  // A look shared into OmniFit from another app (Android share menu)
  const [sharedPayload, setSharedPayload] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  // Off = "Surprise me": answers ignore the Style Library
  const [personalizeOn, setPersonalizeOn] = useState(
    () => readStored(PERSONALIZE_STORAGE_KEY) !== false
  );

  const [mySizes, setMySizes] = useState(() => readStored(SIZES_STORAGE_KEY) || {});
  const [ageGroup, setAgeGroup] = useState(() => readStored(AGE_GROUP_STORAGE_KEY) || "");
  // Face shape + undertone, chosen by the user; this device only
  const [personal, setPersonal] = useState(() => readStored(PERSONAL_STORAGE_KEY) || {});
  // Trending section: the generation shown and its data
  const [trendsTab, setTrendsTab] = useState(() => readStored(AGE_GROUP_STORAGE_KEY) || "all");
  const [trendsData, setTrendsData] = useState(null);
  // Body measurements in inches + size chart + fit preference; this device only
  const [measurements, setMeasurements] = useState(
    () => readStored(MEASUREMENTS_STORAGE_KEY) || { fit: "regular" }
  );
  const [styleOpen, setStyleOpen] = useState(false);
  // Live size check + checkout for one product: { product, status, data, error, size }
  const [cartPicker, setCartPicker] = useState(null);

  const fileInputRef = useRef(null);
  const selectedFileRef = useRef(null);
  // The photo of a turn the stylist answered with a question: the answer to
  // that question must be styled around the same photo
  const questionPhotoRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const questionRef = useRef(null);
  const resultsRef = useRef(null);

  // --------------------------------
  // SHOPPING REGION
  // --------------------------------

  const currentRegion =
    regions.find((region) => region.code === regionCode) || null;

  const selectRegion = (code, source) => {
    setRegionCode(code);
    saveRegion({ code, source });
  };

  // Today's weather where the user is: steers fabrics and layers. Only a
  // rough position (~10 km) is kept, in memory, never stored.
  const updateWeather = async (latitude, longitude) => {
    const rough = {
      latitude: Math.round(latitude * 10) / 10,
      longitude: Math.round(longitude * 10) / 10,
    };
    setCoords(rough);

    try {
      const response = await fetch(`${API_BASE_URL}/api/weather`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rough),
      });
      const data = await response.json().catch(() => null);
      setWeather(data?.weather || null);
    } catch {
      // No weather: advice simply isn't weather-aware
    }
  };

  const detectWeatherOnly = () => {
    navigator.geolocation?.getCurrentPosition(
      (position) => updateWeather(position.coords.latitude, position.coords.longitude),
      () => {},
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30 * 60 * 1000 }
    );
  };

  const detectLocation = ({ silent = false } = {}) => {
    if (!navigator.geolocation) {
      if (!silent) {
        setLocationMessage("Location isn't available in this browser. Please choose your region.");
      }
      return;
    }

    setLocating(true);
    setLocationMessage("");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        updateWeather(position.coords.latitude, position.coords.longitude);

        try {
          const response = await fetch(`${API_BASE_URL}/api/location`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }),
          });

          const data = await response.json().catch(() => null);

          if (!response.ok || !data?.region) {
            throw new Error(data?.detail);
          }

          selectRegion(data.region, "location");
          setShowLocationPrompt(false);
        } catch (error) {
          if (!silent) {
            setLocationMessage(
              (typeof error.message === "string" && error.message) ||
              "Couldn't detect your region. Please choose it manually."
            );
          }
        } finally {
          setLocating(false);
        }
      },
      (geoError) => {
        setLocating(false);

        if (!silent) {
          setLocationMessage(
            geoError.code === geoError.PERMISSION_DENIED
              ? "Location permission was denied. You can choose your region from the menu."
              : "Couldn't get your location. Please choose your region."
          );
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 30 * 60 * 1000,
      }
    );
  };

  // Load regions, then pick one: manual choice > live location > saved > time zone
  useEffect(() => {
    let cancelled = false;

    const initRegion = async () => {
      let data;

      try {
        const response = await fetch(`${API_BASE_URL}/api/regions`);
        data = await response.json();
      } catch {
        return;
      }

      if (cancelled || !Array.isArray(data?.regions)) {
        return;
      }

      setRegions(data.regions);

      const saved = readSavedRegion();
      const isKnown = (code) => data.regions.some((region) => region.code === code);

      if (saved?.source === "manual" && isKnown(saved.code)) {
        setRegionCode(saved.code);

        // Region stays the user's choice; weather still follows their location
        try {
          const state = (await navigator.permissions?.query({ name: "geolocation" }))?.state;
          if (!cancelled && state === "granted") {
            detectWeatherOnly();
          }
        } catch {
          // Permissions API unsupported: no weather
        }
        return;
      }

      const timezone = getBrowserTimezone();
      const timezoneRegion =
        data.regions.find((region) => region.timezones?.includes(timezone))?.code ||
        data.default;

      setRegionCode(isKnown(saved?.code) ? saved.code : timezoneRegion);

      let permission = "prompt";

      try {
        permission = (await navigator.permissions?.query({ name: "geolocation" }))?.state || "prompt";
      } catch {
        // Permissions API unsupported: treat as not yet asked
      }

      if (cancelled) {
        return;
      }

      if (permission === "granted") {
        // Refresh silently so the region follows the user when they move
        detectLocation({ silent: true });
      } else if (permission === "prompt" && !saved?.dismissed) {
        setShowLocationPrompt(true);
      }
    };

    initRegion();

    return () => {
      cancelled = true;
    };
    // Runs once on page load; detectLocation only uses state setters and refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Occasion chips and their quick questions come from the backend
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/occasions`)
      .then((response) => response.json())
      .then((data) => setOccasions(Array.isArray(data?.occasions) ? data.occasions : []))
      .catch(() => {});
  }, []);

  // Trends for the chosen generation (or everyone)
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      age_group: trendsTab === "all" ? "" : trendsTab,
      department: ["men", "women"].includes(department) ? department : "",
    });
    fetch(`${API_BASE_URL}/api/trends?${params}`)
      .then((response) => response.json())
      .then((data) => !cancelled && setTrendsData(data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [trendsTab, department]);

  const buildShopLinks = (query) => {
    if (!currentRegion || !query) {
      return [];
    }

    const encoded = encodeURIComponent(query).replace(/%20/g, "+");
    const slug = encodeURIComponent(query.trim().replace(/\s+/g, "-"));

    return currentRegion.stores.map((store) => ({
      name: store.name,
      url: store.url_template
        .replace("{q}", encoded)
        .replace("{slug}", slug),
    }));
  };

  const renderShopLinks = (query, { startOpen = false } = {}) => {
    const links = buildShopLinks(query);

    if (!links.length) {
      return null;
    }

    return (
      <details className="shop-links" open={startOpen}>
        <summary className="shop-label">
          Search all stores ({links.length})
        </summary>

        <div className="shop-pills">
          {links.map((link) => (
            <a
              key={link.name}
              className="shop-pill"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.name}
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </details>
    );
  };

  // --------------------------------
  // SHOPPING PREFERENCES
  // --------------------------------

  const catalogAvailable = Boolean(currentRegion?.catalog);

  const formatPrice = (value) => {
    if (value === null || value === undefined) {
      return "";
    }

    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: currentRegion?.currency || "INR",
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return String(Math.round(value));
    }
  };

  const describeBudget = ({ min, max }) => {
    if (min && max) {
      return `${formatPrice(min)} – ${formatPrice(max)}`;
    }

    if (max) {
      return `Under ${formatPrice(max)}`;
    }

    if (min) {
      return `${formatPrice(min)}+`;
    }

    return "Any budget";
  };

  const budgetIsSet = Boolean(budget.min || budget.max);

  useEffect(() => {
    writeStored(SHOPPING_STORAGE_KEY, { department, budget });
  }, [department, budget]);

  // Learn which styles the user keeps getting recommended
  useEffect(() => {
    const styles = recommendation?.profile?.styles;

    if (!styles?.length) {
      return;
    }

    const taste = tasteRef.current;

    styles.forEach((style) => {
      taste.styles[style] = (taste.styles[style] || 0) + 1;
    });

    writeStored(TASTE_STORAGE_KEY, taste);
  }, [recommendation]);

  const recordStoreClick = (storeName) => {
    const taste = tasteRef.current;
    taste.stores[storeName] = (taste.stores[storeName] || 0) + 1;
    writeStored(TASTE_STORAGE_KEY, taste);
  };

  // --------------------------------
  // ACCOUNT
  // --------------------------------

  useEffect(() => {
    api("/api/auth/me")
      .then((data) => {
        setUser(data.user);
        setLibraryTaste(data.taste);
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));

    api("/api/auth/config")
      .then((data) => setGoogleClientId(data.google_client_id || null))
      .catch(() => {});

    // Lets the Style Library offer an "install now" button (Android/desktop Chrome)
    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    // Keep the view in the address bar so the Back button works
    const handleHashChange = () => setView(viewFromHash());

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const openView = (next) => {
    setView(next);
    setAccountMenuOpen(false);
    window.history.pushState(null, "", next === "home" ? window.location.pathname : `#${next}`);
    window.scrollTo({ top: 0 });
  };

  // A look shared from another app needs an account before it can be saved
  const shareNeedsSignIn = Boolean(sharedPayload) && authChecked && !user;

  const handleSignedIn = (data) => {
    setUser(data.user);
    setLibraryTaste(data.taste);
    // What they did as a guest moves to the account they just made
    uploadGuestSignals();

    if (authPrompt?.then === "library" || sharedPayload) {
      openView("library");
    }
    setAuthPrompt(null);
  };

  const closeAuth = () => {
    setAuthPrompt(null);
    // Declining to sign in drops a pending shared look
    setSharedPayload(null);
  };

  const signOut = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Signed out locally either way
    }
    setUser(null);
    setLibraryTaste(null);
    setHistoryOn(null);
    openView("home");
  };

  const deleteAccount = async () => {
    if (!window.confirm(
      "Delete your OmniFit account, your Style Library and all saved images? This can't be undone."
    )) {
      return;
    }

    try {
      await api("/api/account", { method: "DELETE" });
      setUser(null);
      setLibraryTaste(null);
      openView("home");
    } catch (error) {
      window.alert(error.message);
    }
  };

  // Conversation history (stored for signed-in users unless switched off)
  const [historyOn, setHistoryOn] = useState(null);

  useEffect(() => {
    if (!accountMenuOpen || !user || historyOn !== null) {
      return;
    }
    api("/api/history?limit=1")
      .then((data) => setHistoryOn(Boolean(data?.enabled)))
      .catch(() => {});
  }, [accountMenuOpen, user, historyOn]);

  const toggleHistory = async () => {
    const next = !historyOn;
    try {
      await api("/api/history/settings", { method: "PUT", json: { enabled: next } });
      setHistoryOn(next);
    } catch (error) {
      window.alert(error.message);
    }
  };

  const clearHistory = async () => {
    if (!window.confirm(
      "Clear your conversation history? Your questions, photos and suggestions will be deleted. Your Style Library stays."
    )) {
      return;
    }
    try {
      const data = await api("/api/history", { method: "DELETE" });
      window.alert(`Cleared ${data?.deleted ?? 0} conversation(s).`);
    } catch (error) {
      window.alert(error.message);
    }
  };

  // --------------------------------
  // VOICE INPUT (speak the question)
  // --------------------------------

  const stopListening = () => {
    const current = recognitionRef.current;
    if (current?.starting) {
      // Tapped Stop while the microphone was still starting
      current.cancelled = true;
    } else if (current?.recorder.state === "recording") {
      current.recorder.stop();
    }
  };

  const transcribe = async (blob) => {
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("audio", blob, "question.webm");
      form.append("language", voiceLanguage);
      const response = await fetch(`${API_BASE_URL}/api/transcribe`, { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.text) {
        throw new Error(data?.detail || "Couldn't understand the recording. Please try again.");
      }
      // Words already typed stay; speech is added after them
      setQuestion((typed) => (typed.trim() ? `${typed.trim()} ${data.text}` : data.text));
      setError("");
      questionRef.current?.focus();
    } catch (error) {
      setVoiceError(
        error instanceof TypeError
          ? "Can't reach OmniFit right now. Please check your connection."
          : error.message
      );
    } finally {
      setTranscribing(false);
    }
  };

  const startListening = async () => {
    // One recording at a time, even with a quick double tap
    if (!CAN_RECORD || recognitionRef.current) {
      return;
    }
    setVoiceError("");
    const pending = { starting: true, cancelled: false };
    recognitionRef.current = pending;
    setListening(true);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      recognitionRef.current = null;
      setListening(false);
      setVoiceError(
        error?.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow it in the browser to speak your question."
          : "No microphone was found."
      );
      return;
    }

    if (pending.cancelled) {
      stream.getTracks().forEach((track) => track.stop());
      recognitionRef.current = null;
      setListening(false);
      return;
    }

    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      clearTimeout(recognitionRef.current?.timer);
      stream.getTracks().forEach((track) => track.stop());
      recognitionRef.current = null;
      setListening(false);
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size) {
        transcribe(blob);
      }
    };

    // Stops by itself after 20 seconds
    const timer = setTimeout(() => recorder.state === "recording" && recorder.stop(), MAX_RECORDING_MS);
    recognitionRef.current = { recorder, stream, timer };
    recorder.start();
  };

  // Release the microphone if the page goes away mid-sentence
  useEffect(() => () => {
    const current = recognitionRef.current;
    if (current?.stream) {
      clearTimeout(current.timer);
      current.stream.getTracks().forEach((track) => track.stop());
    }
  }, []);

  const chooseVoiceLanguage = (code) => {
    setVoiceLanguage(code);
    writeStored(VOICE_LANGUAGE_KEY, code);
  };

  // --------------------------------
  // READ ALOUD (listen to the answer)
  // --------------------------------

  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

  const describeForSpeech = (rec) => {
    if (!rec) {
      return "";
    }
    const lines = [];
    if (rec.request_type === "item_options") {
      rec.recommendations.forEach((item, i) => {
        lines.push(`Option ${i + 1}: ${[item.color, item.style || item.item].filter(Boolean).join(" ")}. ${item.reason || ""}`);
      });
    } else {
      rec.recommendations.forEach((look, i) => {
        const pieces = ["top", "layer", "bottom", "footwear", "accessories", "extra"]
          .map((key) => (typeof look[key] === "string" ? look[key] : look[key]?.name))
          .filter(Boolean);
        lines.push(`Look ${i + 1}, ${look.title || ""}: ${pieces.join(", ")}. ${look.reason || ""}`);
      });
    }
    return lines.join(" ");
  };

  const toggleSpeaking = () => {
    if (!canSpeak) {
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(describeForSpeech(recommendation));
    // Answers are in English: prefer an Indian English voice when there is one
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((v) => v.lang === "en-IN") || voices.find((v) => v.lang?.startsWith("en")) || null;
    utterance.lang = utterance.voice?.lang || "en-IN";
    utterance.rate = 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  // A new answer (or none) stops any reading in progress
  useEffect(() => {
    if (canSpeak) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, [recommendation, canSpeak]);

  const togglePersonalize = (on) => {
    setPersonalizeOn(on);
    writeStored(PERSONALIZE_STORAGE_KEY, on);
  };

  // Share target: the service worker (public/sw.js) parks what was shared in
  // a cache and opens #library?shared=1; pick it up once
  useEffect(() => {
    if (!window.location.hash.includes("shared=1") || !("caches" in window)) {
      return;
    }

    (async () => {
      try {
        const cache = await caches.open(SHARE_CACHE);
        const metaResponse = await cache.match("/shared/meta");
        const imageResponse = await cache.match("/shared/image");
        const meta = metaResponse ? await metaResponse.json() : {};
        const blob = imageResponse ? await imageResponse.blob() : null;

        await cache.delete("/shared/meta");
        await cache.delete("/shared/image");

        const file = blob
          ? new File([blob], meta.fileName || "shared.jpg", { type: blob.type || "image/jpeg" })
          : null;

        if (file || meta.url || meta.text) {
          setSharedPayload({ file, url: meta.url, text: meta.text, title: meta.title });
        }
      } catch {
        // Nothing usable was shared
      }

      window.history.replaceState(null, "", "#library");
    })();
  }, []);

  // --------------------------------
  // MY STYLE: SIZES + LEARNED TASTE
  // --------------------------------

  const choosePersonal = (field, key) => {
    const next = { ...personal, [field]: personal[field] === key ? undefined : key };
    setPersonal(next);
    writeStored(PERSONAL_STORAGE_KEY, next);
  };

  const chooseAgeGroup = (key) => {
    const next = ageGroup === key ? "" : key;
    setAgeGroup(next);
    writeStored(AGE_GROUP_STORAGE_KEY, next);
    if (next) {
      setTrendsTab(next);
    }
  };

  const updateMeasurement = (key, value) => {
    const next = { ...measurements, [key]: value };
    if (value === "" || value === null) {
      delete next[key];
    }
    setMeasurements(next);
    writeStored(MEASUREMENTS_STORAGE_KEY, next);
  };

  const sizeAdvice = measurements.chart
    ? suggestSizes(measurements, measurements.chart, measurements.fit)
    : { sizes: {}, notes: [] };

  const applySuggestedSizes = () => {
    const next = { ...mySizes, ...sizeAdvice.sizes };
    setMySizes(next);
    writeStored(SIZES_STORAGE_KEY, next);
  };

  const updateMySize = (kind, value) => {
    const next = { ...mySizes };

    if (value) {
      next[kind] = value;
    } else {
      delete next[kind];
    }

    setMySizes(next);
    writeStored(SIZES_STORAGE_KEY, next);
  };

  const [, setTasteVersion] = useState(0);

  const resetTaste = () => {
    tasteRef.current = { styles: {}, stores: {} };
    writeStored(TASTE_STORAGE_KEY, tasteRef.current);
    // Re-render so the My Style panel shows the cleared taste
    setTasteVersion((version) => version + 1);
  };

  // Which of the user's sizes applies to a product ("bottom" falls back to the
  // top size for letter-sized joggers and shorts)
  const isMySize = (label, sizeKind) => {
    const size = normalizeSize(label);

    if (size === "FREE") {
      return true;
    }

    const candidates = [mySizes[sizeKind]];
    if (sizeKind === "bottom") {
      candidates.push(mySizes.top);
    }

    return candidates.some((mine) => mine && normalizeSize(mine) === size);
  };

  // --------------------------------
  // ADD TO CART (live size check)
  // --------------------------------

  const openCartPicker = async (product) => {
    setCartPicker({ product, status: "loading", data: null, error: "", size: null });

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/products/${encodeURIComponent(product.id)}/live`
      );
      const data = await response.json().catch(() => null);

      if (!response.ok || !data) {
        throw new Error(data?.detail || "Couldn't check this store right now.");
      }

      // Pre-select the user's size if it's in stock, or the only size
      const inStock = data.sizes.filter((size) => size.available);
      const preselected =
        inStock.find((size) => isMySize(size.label, product.size_kind)) ||
        (inStock.length === 1 ? inStock[0] : null);

      setCartPicker((current) =>
        current?.product.id === product.id
          ? { ...current, status: "ready", data, size: preselected?.label || null }
          : current
      );
    } catch (error) {
      setCartPicker((current) =>
        current?.product.id === product.id
          ? { ...current, status: "error", error: error.message }
          : current
      );
    }
  };

  const goToCheckout = () => {
    const { product, data, size } = cartPicker;
    const chosen = data.sizes.find((entry) => entry.label === size && entry.available);

    if (!chosen) {
      return;
    }

    recordStoreClick(product.store);

    // Shopify cart permalink: opens the store's checkout with this size in the cart
    window.open(`${data.cart_base}${chosen.variant_id}:1`, "_blank", "noopener,noreferrer");
    setCartPicker(null);
  };

  // Esc closes the My Style and Add to cart dialogs; the page behind can't scroll
  useEffect(() => {
    if (!styleOpen && !cartPicker) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setStyleOpen(false);
        setCartPicker(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [styleOpen, cartPicker]);

  // --------------------------------
  // PRODUCT MATCHES
  // --------------------------------

  const anyColourIds = anyColour.rec === recommendation ? anyColour.ids : [];

  const toggleAnyColour = (id) => {
    const next = anyColourIds.includes(id)
      ? anyColourIds.filter((entry) => entry !== id)
      : [...anyColourIds, id];
    setAnyColour({ rec: recommendation, ids: next });
  };

  // The search a piece uses: its colour-free version when the user
  // switched that card to "Show all colours"
  const pieceQuery = (id, query, anyColourQuery) =>
    anyColourIds.includes(id) && anyColourQuery ? anyColourQuery : query;

  // "Show all colours" is offered only when the colour was the stylist's
  // pick; colours the user asked for stay strict
  const canShowAllColours = (query, anyColourQuery) =>
    !recommendation?.colour_requested && Boolean(anyColourQuery) && anyColourQuery !== query;

  // Every recommended piece gets an id so its products can be looked up
  const getProductQueries = (rec) => {
    if (!rec) {
      return [];
    }

    if (rec.request_type === "item_options") {
      return rec.recommendations
        .map((item, index) => ({
          id: `item-${index}`,
          query: pieceQuery(`item-${index}`, item?.search_query, item?.any_colour_query),
        }))
        .filter((entry) => entry.query);
    }

    return rec.recommendations.flatMap((outfit, index) =>
      Object.entries(outfit?.shop_queries || {}).map(([piece, query]) => ({
        id: `look-${index}-${piece}`,
        query: pieceQuery(`look-${index}-${piece}`, query, outfit?.any_colour_queries?.[piece]),
      }))
    );
  };

  const renderColourToggle = (id, color, query, anyColourQuery) => {
    if (!canShowAllColours(query, anyColourQuery)) {
      return null;
    }

    const showingAll = anyColourIds.includes(id);

    return (
      <button
        type="button"
        className={`colour-toggle ${showingAll ? "active" : ""}`}
        aria-pressed={showingAll}
        onClick={() => toggleAnyColour(id)}
      >
        {showingAll
          ? `🎨 Showing all colours · back to ${color || "suggested colour"}`
          : `🎨 Show all colours`}
      </button>
    );
  };

  // Everything a product lookup depends on, as one comparable key
  const productQueries = getProductQueries(recommendation);
  const profileDepartment = recommendation?.profile?.department;

  const productKey =
    productQueries.length && catalogAvailable
      ? JSON.stringify({
          queries: productQueries,
          region: regionCode,
          department:
            profileDepartment && profileDepartment !== "unknown"
              ? profileDepartment
              : "any",
          min_price: budget.min || null,
          max_price: budget.max || null,
          my_sizes: Object.keys(mySizes).length ? mySizes : null,
          personalize: personalizeOn,
          // Stores the products shown with this conversation's history
          interaction_id: recommendation?.interaction_id || null,
        })
      : null;

  // Results only count when they answer the current key
  const productsReady = productKey !== null && productState.key === productKey;
  const products = productsReady ? productState.results : null;
  const priceRange = productsReady ? productState.priceRange : null;
  const productsLoading = productKey !== null && !productsReady;

  // Fetch partner-brand products whenever the results, budget or region change
  useEffect(() => {
    if (!productKey) {
      return;
    }

    let cancelled = false;

    // Short delay so typing a custom budget doesn't send a request per keystroke
    const timer = setTimeout(async () => {
      const taste = tasteRef.current;
      let results = null;
      let range = null;

      try {
        const response = await fetch(`${API_BASE_URL}/api/products`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...JSON.parse(productKey),
            preferred_styles: topKeys(taste.styles, 3),
            preferred_stores: topKeys(taste.stores, 3),
          }),
        });

        const data = await response.json().catch(() => null);

        if (response.ok && data?.catalog_available) {
          results = data.results || {};
          range = data.price_range || null;
        }
      } catch {
        // Network problem: cards fall back to the store search links
      }

      if (!cancelled) {
        setProductState({ key: productKey, results, priceRange: range });
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [productKey]);

  const getProductsFor = (id) => products?.[id]?.products || [];

  // --------------------------------
  // BROWSE (plain item searches)
  // --------------------------------

  const makeBrowseKey = (request) =>
    request
      ? JSON.stringify({
          question: request.question,
          colour: request.colour || null,
          region: regionCode,
          // The section the AI understood for this search, else the user's
          department: request.department || department,
          min_price: budget.min || null,
          max_price: budget.max || null,
          my_sizes: Object.keys(mySizes).length ? mySizes : null,
          personalize: personalizeOn,
          age_group: ageGroup,
        })
      : null;

  const fetchBrowse = async (key) => {
    const taste = tasteRef.current;
    const response = await fetch(`${API_BASE_URL}/api/browse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...JSON.parse(key),
        preferred_styles: topKeys(taste.styles, 3),
        preferred_stores: topKeys(taste.stores, 3),
      }),
    });
    return response.ok ? response.json().catch(() => null) : null;
  };

  const browseKey = makeBrowseKey(browseRequest);
  const browseData = browseState.data;
  const browseLoading = browseKey !== null && browseState.key !== browseKey;

  // Colour, budget, sizes or region changed: fetch the grid again
  useEffect(() => {
    if (!browseKey || browseState.key === browseKey) {
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      let data = null;
      try {
        data = await fetchBrowse(browseKey);
      } catch {
        // Keep the previous grid; the store links still work
      }
      if (!cancelled) {
        setBrowseState((previous) => ({
          key: browseKey,
          data: data?.browse ? data : previous.data,
        }));
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseKey]);

  const askStylistInstead = () => {
    setBrowseRequest(null);
    sendChat(`How should I style ${browseRequest?.question || "these"}?`, { withPhoto: false });
  };

  // Show the browse grid for a plain item search; false = not a plain search
  const showBrowse = async (text) => {
    const request = { question: text, colour: null };
    const key = makeBrowseKey(request);
    let data = null;

    try {
      data = await fetchBrowse(key);
    } catch {
      // Not shown: the caller falls back to the stylist
    }

    if (!data?.browse || !data.products?.length) {
      return false;
    }

    setBrowseState({ key, data });
    setBrowseRequest(request);
    return true;
  };

  // A colour chip under the photo ("olive chinos"): every product in that
  // colour, straight from the catalog; the stylist's answer stays below
  const browseColour = async (text) => {
    setError("");
    if (!(await showBrowse(text))) {
      setError(`No partner-brand products for "${text}" yet. Try the store links on the looks below.`);
      return;
    }
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // "How to wear it": three ways to style one piece, fetched when tapped
  const toggleHowToWear = async (key, piece) => {
    const current = howToWear[key];
    if (current?.status === "open" || current?.status === "loading") {
      setHowToWear((all) => ({ ...all, [key]: { ...current, status: current.ways ? "closed" : undefined } }));
      return;
    }
    if (current?.ways) {
      setHowToWear((all) => ({ ...all, [key]: { ...current, status: "open" } }));
      return;
    }

    setHowToWear((all) => ({ ...all, [key]: { status: "loading" } }));
    try {
      const response = await fetch(`${API_BASE_URL}/api/how-to-wear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          piece,
          department: recommendation?.profile?.department || "unknown",
          climate: weather?.feel || null,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ways) {
        throw new Error(data?.detail || "Couldn't get styling tips. Please try again.");
      }
      setHowToWear((all) => ({ ...all, [key]: { status: "open", ways: data.ways } }));
    } catch (error) {
      setHowToWear((all) => ({ ...all, [key]: { status: "error", error: error.message } }));
    }
  };

  const renderHowToWear = (key, piece) => {
    const state = howToWear[key] || {};
    return (
      <div className="how-to-wear">
        <button
          type="button"
          className="how-to-wear-button"
          aria-expanded={state.status === "open"}
          onClick={() => toggleHowToWear(key, piece)}
          disabled={state.status === "loading"}
        >
          {state.status === "loading" ? "✨ Getting ideas…" : "✨ How to wear it"}
        </button>

        {state.status === "error" && <p className="how-to-wear-error">{state.error}</p>}

        {state.status === "open" && (
          <ul className="how-to-wear-list">
            {state.ways.map((way) => (
              <li key={way.occasion}>
                <strong>{way.occasion}</strong>
                <span>{way.pair_with}</span>
                {way.tip && <em>Tip: {way.tip}</em>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const renderProductCard = (product, variant) => (
    <div key={product.url} className={`product-card ${variant}`}>
    <a
      className="product-link"
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => recordStoreClick(product.store)}
    >
      <div className="product-image">
        {product.image ? (
          <img
            src={product.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span>🛍️</span>
        )}

        {product.discount_percent >= 5 && (
          <span className="discount-badge">
            -{product.discount_percent}%
          </span>
        )}
      </div>

      <div className="product-info">
        <span className="product-store">{product.store}</span>
        <span className="product-title">{product.title}</span>
        <span className="product-price">
          <strong>{formatPrice(product.price)}</strong>
          {product.compare_at && <s>{formatPrice(product.compare_at)}</s>}
        </span>
      </div>
    </a>

      {/* SIZES IN STOCK (from the daily sync) */}

      {variant === "grid" && product.sizes?.length > 0 && (
        <div className="product-sizes" aria-label="Sizes in stock">
          {product.sizes.map((size) => (
            <span
              key={size}
              className={isMySize(size, product.size_kind) ? "mine" : ""}
            >
              {size}
            </span>
          ))}
        </div>
      )}

      {/* Fabric that suits today's weather ("Linen: breathable for today") */}
      {fabricNote(product.title, weather) && (
        <span className="fabric-note">{fabricNote(product.title, weather)}</span>
      )}

      {/* Nothing matched exactly, so a fit word (e.g. "oversized") was dropped */}
      {product.closest_match_without?.length > 0 && (
        <span className="closest-note">
          Closest match · not {product.closest_match_without.join(" / ")}
        </span>
      )}

      {product.size_status === "fits" && (
        <span className="size-status fits">✓ Your size in stock</span>
      )}
      {product.size_status === "not_in_size" && (
        <span className="size-status">Not in your size</span>
      )}

      <button
        type="button"
        className="add-to-cart"
        onClick={() => openCartPicker(product)}
      >
        🛒 {variant === "compact" ? "Add" : "Add to cart"}
      </button>
    </div>
  );

  const renderProducts = (id, variant) => {
    if (!catalogAvailable || !recommendation) {
      return null;
    }

    if (productsLoading && !products) {
      return (
        <div className={`product-list ${variant}`}>
          {(variant === "compact" ? [0] : [0, 1, 2]).map((n) => (
            <div className={`product-card ${variant} skeleton-product`} key={n}>
              <div className="skeleton product-image" />
              <div className="product-info">
                <div className="skeleton skeleton-line short" />
                <div className="skeleton skeleton-line" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    const matches = getProductsFor(id).slice(0, variant === "compact" ? 1 : 3);

    if (!matches.length) {
      return products ? (
        <p className="no-products">
          {budgetIsSet
            ? "No partner-brand match in your budget. Try the stores below."
            : "No close partner-brand match. Try the stores below."}
        </p>
      ) : null;
    }

    return (
      <div className={`product-list ${variant} ${productsLoading ? "refreshing" : ""}`}>
        {matches.map((product) => renderProductCard(product, variant))}
      </div>
    );
  };

  // --------------------------------
  // SHARE CARD
  // --------------------------------

  const loadImage = (url) => new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    // Store images allow cross-origin use, so the card can be exported
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

  const wrapText = (ctx, text, x, y, maxWidth, lineHeight, maxLines) => {
    const words = String(text || "").split(/\s+/);
    let line = "";
    let lines = 0;
    for (let i = 0; i < words.length; i += 1) {
      const test = line ? `${line} ${words.at(i)}` : words.at(i);
      if (ctx.measureText(test).width > maxWidth && line) {
        lines += 1;
        if (lines === maxLines) {
          ctx.fillText(`${line}…`, x, y);
          return y + lineHeight;
        }
        ctx.fillText(line, x, y);
        y += lineHeight;
        line = words.at(i);
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
    return y;
  };

  const shareLook = async (outfit, index) => {
    setSharing(index);
    try {
      const W = 1080, H = 1350, pad = 48, gap = 32;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");

      // Fixed colours: the card is an image, not part of the themed page
      ctx.fillStyle = "#fbf9f6";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#5b3fd0";
      ctx.font = "700 34px system-ui, sans-serif";
      ctx.fillText("OmniFit", pad, 78);
      ctx.fillStyle = "#16131f";
      ctx.font = "700 52px system-ui, sans-serif";
      wrapText(ctx, outfit?.title || "My look", pad, 150, W - 2 * pad, 60, 1);

      const pieces = outfitSlots
        .filter((slot) => outfit?.[slot.key])
        .slice(0, 6)
        .map((slot) => {
          const value = outfit[slot.key];
          const name = typeof value === "string" ? value : value?.name || slot.fallback;
          const kept = outfit?.keep?.includes(slot.key);
          const product = kept ? null : getProductsFor(`look-${index}-${slot.key}`)[0];
          return { label: slot.label, name, kept, product };
        });

      const images = await Promise.all(pieces.map((piece) => loadImage(piece.product?.image)));

      const cols = 2;
      const tileW = (W - 2 * pad - gap) / cols;
      const rows = Math.ceil(pieces.length / cols);
      const top0 = 200;
      const tileH = Math.min(340, (H - top0 - 150 - gap * (rows - 1)) / rows);
      const imageH = tileH - 110;

      pieces.forEach((piece, i) => {
        const x = pad + (i % cols) * (tileW + gap);
        const y = top0 + Math.floor(i / cols) * (tileH + gap);

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, tileW, tileH);

        const img = images.at(i);
        if (img) {
          // Cover-fit the product photo into the tile
          const scale = Math.max(tileW / img.width, imageH / img.height);
          const sw = tileW / scale, sh = imageH / scale;
          ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, tileW, imageH);
        } else {
          ctx.fillStyle = "#f1eef6";
          ctx.fillRect(x, y, tileW, imageH);
          ctx.fillStyle = "#766f86";
          ctx.font = "600 26px system-ui, sans-serif";
          wrapText(ctx, piece.name, x + 20, y + imageH / 2 - 16, tileW - 40, 32, 3);
        }

        ctx.fillStyle = "#766f86";
        ctx.font = "600 20px system-ui, sans-serif";
        ctx.fillText(piece.label, x + 16, y + imageH + 34);
        ctx.fillStyle = "#16131f";
        ctx.font = "500 24px system-ui, sans-serif";
        const detail = piece.product
          ? `${piece.product.store} · ${formatPrice(piece.product.price)}`
          : piece.kept ? "✓ Your own piece" : "Find it in any store";
        wrapText(ctx, detail, x + 16, y + imageH + 70, tileW - 32, 30, 1);
      });

      const total = getLookTotal(index, outfit);
      ctx.fillStyle = "#16131f";
      ctx.font = "700 36px system-ui, sans-serif";
      if (total) {
        ctx.fillText(`Complete look: ${formatPrice(total)}`, pad, H - 80);
      }
      ctx.fillStyle = "#766f86";
      ctx.font = "500 24px system-ui, sans-serif";
      ctx.fillText("Styled with OmniFit Live", pad, H - 36);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) {
        throw new Error("Couldn't create the image.");
      }
      const file = new File([blob], "omnifit-look.png", { type: "image/png" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: outfit?.title || "My OmniFit look" });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "omnifit-look.png";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        window.alert(error?.message || "Couldn't share this look.");
      }
    } finally {
      setSharing(null);
    }
  };

  // Cheapest way to buy the whole look from matched products
  const getLookTotal = (outfitIndex, outfit) => {
    const pieces = Object.keys(outfit?.shop_queries || {});

    if (!pieces.length) {
      return null;
    }

    let total = 0;

    for (const piece of pieces) {
      const best = getProductsFor(`look-${outfitIndex}-${piece}`)[0];

      if (!best) {
        return null;
      }

      total += best.price;
    }

    return total;
  };

  // --------------------------------
  // SET SELECTED IMAGE
  // --------------------------------

  const selectImageFile = (file) => {
    // Shown in the photo panel, next to the button the user just used
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setPhotoError("Please use a JPG, PNG, or WEBP photo.");
      return;
    }

    if (image) {
      URL.revokeObjectURL(image);
    }

    selectedFileRef.current = file;

    setImage(URL.createObjectURL(file));
    setAttachMenuOpen(false);
    setError("");
    setPhotoError("");
  };

  // --------------------------------
  // IMAGE UPLOAD
  // --------------------------------

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];

    if (file) {
      selectImageFile(file);
    }

    event.target.value = "";
  };

  // --------------------------------
  // OPEN CAMERA
  // --------------------------------

  const openCamera = async (purpose = "outfit") => {
    setPhotoError("");
    setCameraPurpose(purpose);
    setAttachMenuOpen(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setPhotoError(
        "Camera access is not supported here. Please use Choose Photo instead."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          // Scans use the front camera (you see yourself); outfit photos the back one
          facingMode: { ideal: purpose === "scan" || purpose === "body" ? "user" : "environment" },
          // Without a size, browsers default to 640x480, which loses the
          // fabric, pattern and colour detail the stylist needs
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraReady(false);
      setCameraOpen(true);
    } catch {
      setPhotoError(
        "Unable to access the camera. Please allow camera permission or use Choose Photo."
      );
    }
  };

  // --------------------------------
  // CLOSE CAMERA
  // --------------------------------

  const closeCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setCameraOpen(false);
    setCameraReady(false);
  };

  // --------------------------------
  // CONNECT CAMERA TO VIDEO
  // --------------------------------

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraOpen]);

  // --------------------------------
  // CAMERA MODAL: LOCK SCROLL + ESC
  // --------------------------------

  useEffect(() => {
    if (!cameraOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeCamera();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [cameraOpen]);

  // Stop the camera if the page unmounts while it is open
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // --------------------------------
  // SCROLL TO RESULTS
  // --------------------------------

  // A new answer: bring its message into view (the full answer follows it)
  useEffect(() => {
    if (activeMessageId) {
      document.getElementById(`msg-${activeMessageId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeMessageId]);

  // --------------------------------
  // CAPTURE PHOTO
  // --------------------------------

  const capturePhoto = () => {
    const video = videoRef.current;

    if (!video || !video.videoWidth) {
      setPhotoError("Camera is still loading. Please try again.");
      return;
    }

    const canvas = document.createElement("canvas");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");

    context.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setPhotoError(
            "Unable to capture the photo. Please try again."
          );
          return;
        }

        const capturedFile = new File(
          [blob],
          "omnifit-camera.jpg",
          {
            type: "image/jpeg",
          }
        );

        if (cameraPurpose === "scan") {
          runStyleScan(capturedFile);
        } else if (cameraPurpose === "body") {
          runBodyScan(capturedFile);
        } else {
          selectImageFile(capturedFile);
        }
        setPhotoError("");

        closeCamera();
      },
      "image/jpeg",
      0.92
    );
  };

  // --------------------------------
  // REMOVE IMAGE
  // --------------------------------

  const removeImage = () => {
    if (image) {
      URL.revokeObjectURL(image);
    }

    selectedFileRef.current = null;

    setImage(null);
    setPhotoError("");
  };

  // --------------------------------
  // STYLE SCAN (opt-in selfie -> face shape + undertone estimate)
  // --------------------------------
  // The photo is analysed and discarded by the server; nothing is kept
  // unless the user taps "Save to my Style DNA".

  const runStyleScan = async (file) => {
    // Ticked on the consent screen: also guess the age group and section
    const estimate = Boolean(styleScan?.estimate);
    setStyleScan({ status: "scanning", estimate });

    // Face shape: worked out on this device (MediaPipe). With no single,
    // front-facing face the photo isn't sent anywhere.
    let face;
    try {
      const { scanFace } = await import("../facescan");
      face = await scanFace(file);
    } catch {
      setStyleScan({ status: "error", estimate, error: "The face scan couldn't start on this device. Please try again." });
      return;
    }
    if (!face.ok) {
      setStyleScan({ status: "error", estimate, error: face.message });
      return;
    }

    // Age group and section: a guess made on this device, only if they asked
    // for it, shown for them to confirm or correct (never applied by itself)
    let suggestion = null;
    if (estimate) {
      try {
        const { suggestAgeAndSection } = await import("../agescan");
        suggestion = await suggestAgeAndSection(file);
      } catch {
        suggestion = null;
      }
    }

    // Undertone: estimated on the server, as before
    const form = new FormData();
    form.append("image", file);
    try {
      const response = await fetch(`${API_BASE_URL}/api/style-scan`, { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.detail || "Couldn't read that photo. Please try again.");
      }
      setStyleScan(data.usable
        ? {
            status: "result",
            estimate,
            result: {
              ...data,
              face_shape: face.face_shape,
              face_shape_confidence: face.face_shape_confidence,
              accessory_tip: face.accessory_tip,
              suggestion,
            },
          }
        : { status: "error", estimate, error: data.message });
    } catch (error) {
      setStyleScan({ status: "error", estimate, error: error.message });
    }
  };

  const saveStyleScan = () => {
    const result = styleScan?.result;
    if (!result) {
      return;
    }
    const next = { ...personal };
    if (result.face_shape) {
      next.face_shape = result.face_shape;
    }
    if (result.undertone) {
      next.undertone = result.undertone;
    }
    setPersonal(next);
    writeStored(PERSONAL_STORAGE_KEY, next);
    setStyleScan({ ...styleScan, status: "saved" });
  };

  // --------------------------------
  // BODY SCAN (on-device measurements from one full-length photo)
  // --------------------------------

  const openBodyScan = () => {
    setStyleOpen(false);
    setBodyScan({ status: "intro", heightCm: measurements.height_cm || "" });
  };

  // Self-timer: the user props the phone up and steps back
  const startCountdown = () => {
    setCountdown(5);
    const tick = (left) => {
      if (left <= 0) {
        setCountdown(0);
        capturePhoto();
        return;
      }
      setCountdown(left);
      setTimeout(() => tick(left - 1), 1000);
    };
    tick(5);
  };

  const runBodyScan = async (file) => {
    const heightCm = Number(bodyScan?.heightCm);
    setBodyScan((scan) => ({ ...scan, status: "measuring", error: "" }));
    try {
      // Loaded only when needed; runs on this device, nothing is uploaded
      const { scanBody } = await import("../bodyscan");
      const section = ["men", "women"].includes(department) ? department : measurements.chart || "default";
      const result = await scanBody(file, heightCm, section);
      setBodyScan((scan) => (result.ok
        ? { ...scan, status: "result", values: result.measurements, notes: result.notes }
        : { ...scan, status: "error", error: result.message }));
    } catch {
      setBodyScan((scan) => ({ ...scan, status: "error", error: "The body scan couldn't start on this device. You can type your measurements in Style DNA." }));
    }
  };

  const saveBodyScan = () => {
    const values = bodyScan?.values || {};
    const next = { ...measurements, height_cm: Number(bodyScan.heightCm) || undefined };
    ["chest", "waist", "hip"].forEach((key) => {
      if (values[key]) {
        next[key] = String(values[key]);
      }
    });
    if (!next.chart && ["men", "women"].includes(department)) {
      next.chart = department;
    }
    setMeasurements(next);
    writeStored(MEASUREMENTS_STORAGE_KEY, next);

    // Sizes from the confirmed measurements feed "✓ Your size in stock"
    if (next.chart) {
      const { sizes } = suggestSizes(next, next.chart, next.fit);
      const nextSizes = { ...mySizes, ...sizes };
      setMySizes(nextSizes);
      writeStored(SIZES_STORAGE_KEY, nextSizes);
    }
    setBodyScan((scan) => ({ ...scan, status: "saved" }));
  };

  // --------------------------------
  // CHAT: the AI conversation
  // --------------------------------
  // Each turn is streamed from /api/chat: the AI understands the message,
  // asks one question if a key detail is missing, then runs the right tool.

  // What OmniFit knows about the user, sent with every message
  const styleDnaForChat = () => {
    const dna = {
      department: department !== "auto" ? department : undefined,
      budget_min: budget.min || undefined,
      budget_max: budget.max || undefined,
      top_size: mySizes.top,
      waist_size: mySizes.bottom,
      shoe_size: mySizes.footwear,
      age_group: ageGroup || undefined,
      face_shape: personal.face_shape,
      undertone: personal.undertone,
      fit: measurements.fit,
    };
    return Object.fromEntries(Object.entries(dna).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  };

  // Facts the user stated in the chat ("I wear M") go into Style DNA
  const applyRemembered = (remember) => {
    const labels = [];
    if (!remember || !Object.keys(remember).length) {
      return labels;
    }

    const sizeKinds = { top_size: "top", waist_size: "bottom", shoe_size: "footwear" };
    const nextSizes = { ...mySizes };
    let sizesChanged = false;
    const nextPersonal = { ...personal };
    let personalChanged = false;

    Object.entries(remember).forEach(([field, value]) => {
      if (sizeKinds[field]) {
        nextSizes[sizeKinds[field]] = value;
        sizesChanged = true;
        labels.push(`${SIZE_CHOICES[sizeKinds[field]].label.split(" ")[0]} ${value}`);
      } else if (field === "face_shape" || field === "undertone") {
        nextPersonal[field] = value;
        personalChanged = true;
        labels.push(`${field === "face_shape" ? "Face shape" : "Undertone"}: ${value}`);
      } else if (field === "age_group") {
        setAgeGroup(value);
        writeStored(AGE_GROUP_STORAGE_KEY, value);
        setTrendsTab(value);
        labels.push(AGE_GROUP_CHOICES.find((choice) => choice.key === value)?.label || value);
      } else if (field === "fit") {
        updateMeasurement("fit", value);
        labels.push(`${value} fit`);
      } else if (field === "shops_for" && DEPARTMENT_NAMES[value]) {
        setDepartment(value);
        labels.push(`Shops ${DEPARTMENT_NAMES[value].toLowerCase()}`);
      }
    });

    if (sizesChanged) {
      setMySizes(nextSizes);
      writeStored(SIZES_STORAGE_KEY, nextSizes);
    }
    if (personalChanged) {
      setPersonal(nextPersonal);
      writeStored(PERSONAL_STORAGE_KEY, nextPersonal);
    }
    return labels;
  };

  const summarizeStylist = (result) => {
    const names = (result?.recommendations || []).map((rec) =>
      result.request_type === "item_options"
        ? [rec.color, rec.style || rec.item].filter(Boolean).join(" ")
        : `${rec.title || "Look"} (${["top", "bottom", "footwear"].map((key) => rec[key]).filter(Boolean).join(", ")})`
    );
    return `Suggested: ${names.join("; ")}`;
  };

  // Bring an earlier answer back on screen
  const showAgain = (message) => {
    if (message.kind === "stylist") {
      setRecommendation(message.result);
      setBrowseRequest(null);
    } else if (message.kind === "browse") {
      setBrowseState({ key: makeBrowseKey(message.browse.request), data: message.browse.data });
      setBrowseRequest(message.browse.request);
      setRecommendation(null);
    }
    setActiveMessageId(message.id);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const sendChat = async (rawText, { withPhoto = true } = {}) => {
    const lastAssistant = [...messages].reverse().find((entry) => entry.role === "assistant");
    const justAsked = Boolean(lastAssistant?.question && !lastAssistant.answered);
    const newPhoto = withPhoto ? selectedFileRef.current : null;
    // Answering the stylist's question about a photo: send that photo again
    const photo = newPhoto || (justAsked ? questionPhotoRef.current : null);
    const text = (typeof rawText === "string" ? rawText : question).trim();

    if ((!text && !photo) || sending) {
      if (!text && !photo) {
        questionRef.current?.focus();
      }
      return;
    }
    questionPhotoRef.current = null;
    const history = messages.slice(-12).map((entry) => ({
      role: entry.role,
      text: entry.role === "user" ? entry.text : entry.summary || entry.reply || "",
    }));

    const userId = `u-${Date.now()}`;
    const botId = `a-${Date.now()}`;
    setMessages((list) => [
      ...list.map((entry) => (entry.id === lastAssistant?.id ? { ...entry, answered: true } : entry)),
      { id: userId, role: "user", text: text || "What can I wear with this?", photo: newPhoto ? image : null },
      { id: botId, role: "assistant", status: "working", steps: ["Understanding your message"] },
    ]);

    // The photo now belongs to the sent message
    setQuestion("");
    selectedFileRef.current = null;
    setImage(null);
    setError("");
    setSending(true);
    requestAnimationFrame(() => threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));

    const update = (patch) =>
      setMessages((list) =>
        list.map((entry) =>
          entry.id === botId ? { ...entry, ...(typeof patch === "function" ? patch(entry) : patch) } : entry
        )
      );
    const addStep = (step) => update((entry) => ({ steps: [...(entry.steps || []), step] }));

    const handleEvent = (event) => {
      switch (event.event) {
        case "understood": {
          const remembered = applyRemembered(event.remember);
          // A guest's feed follows the chat too (kept on this device)
          if (!user) {
            rememberGuestIntent(event);
          }
          if (event.budget_min || event.budget_max) {
            setBudget({ preset: "custom", min: event.budget_min || null, max: event.budget_max || null });
          }
          update({ understood: event.understood, remembered, reply: event.reply, intent: event.intent });
          break;
        }
        case "question":
          questionPhotoRef.current = photo;
          update({
            question: event.question,
            options: event.options,
            reply: event.reply,
            summary: event.question,
            status: "done",
          });
          break;
        case "working":
          addStep(event.step);
          break;
        case "stylist":
          setRecommendation(event.result);
          setBrowseRequest(null);
          setActiveMessageId(botId);
          update((entry) => ({
            kind: "stylist",
            result: event.result,
            summary: summarizeStylist(event.result),
            nextSteps: event.result.next_steps || [],
            // What an edit changed and kept ("Changed the shoes in look 1")
            notes: event.result.edit?.note ? [...(entry.notes || []), event.result.edit.note] : entry.notes,
          }));
          break;
        case "browse": {
          const request = { question: event.question, colour: null, department: event.department };
          setBrowseState({ key: makeBrowseKey(request), data: event });
          setBrowseRequest(request);
          setRecommendation(null);
          setActiveMessageId(botId);
          update({
            kind: "browse",
            browse: { request, data: event },
            summary: `Showed ${event.products.length} products for "${event.question}"`,
          });
          break;
        }
        case "wardrobe":
          update({
            kind: "wardrobe",
            wardrobe: event,
            summary: `Outfits from your wardrobe: ${(event.outfits || []).map((outfit) => outfit.title).join("; ")}`,
          });
          break;
        case "tips":
          update({
            kind: "tips",
            tips: event,
            summary: `Ways to wear ${event.piece}: ${event.ways.map((way) => way.occasion).join(", ")}`,
          });
          break;
        case "advice":
          update({ kind: "advice", advice: event, summary: event.answer, nextSteps: event.next_steps || [] });
          break;
        case "reply":
          update({ reply: event.text, summary: event.text });
          break;
        case "note":
          update((entry) => ({ notes: [...(entry.notes || []), event.text] }));
          break;
        case "error":
          update({ status: "error", error: event.detail });
          break;
        default:
          break;
      }
    };

    const form = new FormData();
    form.append("message", text);
    if (photo) {
      form.append("image", photo);
    }
    form.append("history", JSON.stringify(history));
    // The looks on screen: "change the shoes" or "not the first one" refer to them
    if (recommendation?.recommendations?.length) {
      form.append(
        "current",
        JSON.stringify({
          request_type: recommendation.request_type,
          recommendations: recommendation.recommendations,
          outfit_analysis: recommendation.outfit_analysis,
        })
      );
    }
    form.append("profile", JSON.stringify(styleDnaForChat()));
    form.append("just_asked", justAsked ? "true" : "false");
    form.append("region", regionCode || "IN");
    form.append("personalize", personalizeOn ? "on" : "off");
    if (coords) {
      form.append("latitude", coords.latitude);
      form.append("longitude", coords.longitude);
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, { method: "POST", body: form });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error((typeof data?.detail === "string" && data.detail) || "Couldn't reach the stylist. Please try again.");
      }

      // Newline-delimited JSON: one event per line, as the AI works
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            handleEvent(JSON.parse(line));
          }
          newline = buffer.indexOf("\n");
        }
      }
    } catch (error) {
      update({
        status: "error",
        error: error instanceof TypeError
          ? "Can't reach OmniFit right now. Please check your connection."
          : error.message,
      });
    } finally {
      setSending(false);
      update((entry) => (entry.status === "working" ? { status: "done" } : {}));
    }
  };

  // Keep the conversation for this tab
  useEffect(() => {
    writeSessionChat(messages, activeMessageId);
  }, [messages, activeMessageId]);

  // After a refresh, bring the last answer back on screen
  useEffect(() => {
    const active = messages.find((message) => message.id === activeMessageId);
    if (active?.kind === "stylist") {
      setRecommendation(active.result);
    } else if (active?.kind === "browse") {
      setBrowseState({ key: makeBrowseKey(active.browse.request), data: active.browse.data });
      setBrowseRequest(active.browse.request);
    }
    // Once, on page load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------
  // FOR YOU: the AI-written daily feed
  // --------------------------------

  // What the feed depends on; a change (new sizes, a new region) rewrites it
  const feedKey = JSON.stringify({
    dna: styleDnaForChat(),
    region: regionCode,
    coords,
    user: user?.id || null,
  });

  const loadFeed = async ({ refresh = false } = {}) => {
    setFeedState((state) => ({ ...state, key: feedKey, status: "loading", error: "" }));
    try {
      const data = await api("/api/for-you", {
        method: "POST",
        json: {
          profile: styleDnaForChat(),
          region: regionCode || "IN",
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          refresh,
        },
      });
      setFeedState({ key: feedKey, status: "ready", data, error: "" });
    } catch (error) {
      setFeedState((state) => ({ ...state, status: "error", error: error.message }));
    }
  };

  // Written when For You opens (the server keeps it for the day)
  useEffect(() => {
    if (view === "explore" && regionCode && feedState.key !== feedKey && feedState.status !== "loading") {
      loadFeed();
    }
    // loadFeed changes every render; the key captures what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, feedKey, regionCode]);

  const startNewChat = () => {
    setMessages([]);
    setActiveMessageId(null);
    setRecommendation(null);
    setBrowseRequest(null);
    setQuestion("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // --------------------------------
  // GET ITEM ICON
  // --------------------------------

  const getItemIcon = (item) => {
    const normalizedItem = (item || "").toLowerCase();

    if (
      normalizedItem.includes("shirt") ||
      normalizedItem.includes("top") ||
      normalizedItem.includes("blouse") ||
      normalizedItem.includes("t-shirt") ||
      normalizedItem.includes("polo")
    ) {
      return "👔";
    }

    if (
      normalizedItem.includes("shoe") ||
      normalizedItem.includes("sneaker") ||
      normalizedItem.includes("loafer") ||
      normalizedItem.includes("boot") ||
      normalizedItem.includes("footwear")
    ) {
      return "👟";
    }

    if (
      normalizedItem.includes("pant") ||
      normalizedItem.includes("trouser") ||
      normalizedItem.includes("jean") ||
      normalizedItem.includes("bottom") ||
      normalizedItem.includes("chino")
    ) {
      return "👖";
    }

    if (
      normalizedItem.includes("watch") ||
      normalizedItem.includes("accessor") ||
      normalizedItem.includes("belt") ||
      normalizedItem.includes("bag")
    ) {
      return "⌚";
    }

    if (
      normalizedItem.includes("jacket") ||
      normalizedItem.includes("blazer") ||
      normalizedItem.includes("coat")
    ) {
      return "🧥";
    }

    return "✦";
  };

  // --------------------------------
  // GET DISPLAY LABEL
  // --------------------------------

  const getItemLabel = (item) => {
    if (!item) {
      return "RECOMMENDATION";
    }

    return item.toUpperCase();
  };

  // --------------------------------
  // COLOR SWATCH (only for real CSS color names)
  // --------------------------------

  const getSwatchColor = (color) => {
    if (!color || typeof CSS === "undefined") {
      return null;
    }

    const cssColor = color.toLowerCase().replace(/\s+/g, "");

    return CSS.supports("color", cssColor) ? cssColor : null;
  };

  // --------------------------------
  // RENDER ITEM OPTION
  // --------------------------------

  const renderItemOption = (item, index) => {
    const itemName =
      item?.style ||
      item?.name ||
      "Recommended option";

    const swatch = getSwatchColor(item?.color);
    const productId = `item-${index}`;
    const hasProducts = getProductsFor(productId).length > 0;

    return (
      <article
        className={`option-card ${catalogAvailable ? "with-products" : ""}`}
        key={`${item?.item || "item"}-${index}`}
        style={{ animationDelay: `${index * 80}ms` }}
      >
        <div className="option-details">
        <div className="option-top">
          <div className="result-icon">
            {getItemIcon(item?.item)}
          </div>

          <span className="option-number">
            {String(index + 1).padStart(2, "0")}
          </span>
        </div>

        <span className="item-label">
          {getItemLabel(item?.item)}
        </span>

        <h3>
          {itemName}
        </h3>

        {item?.color && (
          <span className="color-tag">
            {swatch && (
              <span
                className="color-swatch"
                style={{ background: swatch }}
              />
            )}
            {item.color}
          </span>
        )}

        {item?.reason && (
          <p>
            {item.reason}
          </p>
        )}

        {(() => {
          const pieceName = [item?.color, itemName].filter(Boolean).join(" ");
          return (
            <>
              {renderHowToWear(`piece:${pieceName}`, pieceName)}

              {/* Build a whole outfit around this piece */}
              <button
                type="button"
                className="complete-look-button"
                onClick={() => sendChat(`Build a complete look around a ${pieceName}`, { withPhoto: false })}
                disabled={sending}
              >
                👗 Complete the look
              </button>
            </>
          );
        })()}
        </div>

        <div className="option-shop">
          {renderColourToggle(productId, item?.color, item?.search_query, item?.any_colour_query)}

          {renderProducts(productId, "grid")}

          {renderShopLinks(pieceQuery(productId, item?.search_query, item?.any_colour_query), {
            startOpen: !catalogAvailable || (Boolean(products) && !hasProducts),
          })}
        </div>
      </article>
    );
  };

  // --------------------------------
  // RENDER COMPLETE OUTFIT
  // --------------------------------

  const outfitSlots = [
    { key: "top", label: "TOP", icon: "👔", fallback: "Recommended top" },
    { key: "layer", label: "LAYER", icon: "🧥", fallback: "" },
    { key: "bottom", label: "BOTTOM", icon: "👖", fallback: "Recommended bottom" },
    { key: "footwear", label: "FOOTWEAR", icon: "👟", fallback: "Recommended footwear" },
    { key: "accessories", label: "ACCESSORIES", icon: "⌚", fallback: "Recommended accessories" },
    { key: "extra", label: "FINISHING TOUCH", icon: "👜", fallback: "" },
  ];

  const renderCompleteOutfit = (outfit, index) => {
    return (
      <article
        className="outfit-option"
        key={`${outfit?.title || "look"}-${index}`}
        style={{ animationDelay: `${index * 100}ms` }}
      >
        <div className="outfit-option-header">
          <span className="look-badge">
            LOOK {index + 1}
          </span>

          <h3>
            {outfit?.title || "Complete Look"}
          </h3>
        </div>

        <div className="outfit-pieces">

          {outfitSlots.map((slot) => {
            const value = outfit?.[slot.key];

            // Optional or skipped slots (layer, accessories) are simply left out
            if (!value) {
              return null;
            }

            const name =
              typeof value === "string"
                ? value
                : value?.name || slot.fallback;

            const description =
              typeof value === "string"
                ? ""
                : value?.description || "";

            // Pieces already in the user's photo: kept as they are, not shopped for
            const isKept = outfit?.keep?.includes(slot.key);

            return (
              <div className={`outfit-piece ${isKept ? "kept" : ""}`} key={slot.key}>
                <div className="result-icon">
                  {slot.icon}
                </div>

                <div className="result-content">
                  <span className="item-label">
                    {slot.label}
                  </span>

                  <h4>
                    {name}
                  </h4>

                  {description && (
                    <p>
                      {description}
                    </p>
                  )}

                  {isKept && (
                    <span className="kept-badge">
                      {outfit?.from_wardrobe?.includes(slot.key) ? "✓ From your wardrobe" : "✓ You're wearing this"}
                    </span>
                  )}

                  {renderHowToWear(`piece:${name}`, name)}

                  {outfit?.shop_queries?.[slot.key] && (() => {
                    const pieceId = `look-${index}-${slot.key}`;
                    const query = outfit.shop_queries[slot.key];
                    const anyColourQuery = outfit?.any_colour_queries?.[slot.key];

                    return (
                      <>
                        {renderColourToggle(pieceId, null, query, anyColourQuery)}
                        {renderProducts(pieceId, "compact")}
                        {renderShopLinks(pieceQuery(pieceId, query, anyColourQuery))}
                      </>
                    );
                  })()}
                </div>
              </div>
            );
          })}

        </div>

        {/* WHOLE-LOOK PRICE */}

        {(() => {
          const total = getLookTotal(index, outfit);

          if (!total) {
            return null;
          }

          return (
            <p className="look-total">
              🛍️{" "}
              {outfit?.keep?.length
                ? "Complete this look with your own pieces for "
                : "Get this complete look from partner brands for "}
              <strong>{formatPrice(total)}</strong>
            </p>
          );
        })()}

        {/* REASON */}

        {outfit?.reason && (
          <p className="outfit-reason">
            <span>💡</span>
            {outfit.reason}
          </p>
        )}

        {/* SHARE CARD (drawn in the browser from the real product photos) */}

        <button
          type="button"
          className="share-look"
          onClick={() => shareLook(outfit, index)}
          disabled={sharing === index}
        >
          {sharing === index ? "Preparing…" : "📤 Share this look"}
        </button>

      </article>
    );
  };

  // --------------------------------
  // RESULT TITLE
  // --------------------------------

  const getResultTitle = () => {
    if (!recommendation) {
      return "";
    }

    if (
      recommendation.request_type === "item_options"
    ) {
      // Garment type = last word of each item ("flannel shirt" -> "shirt")
      const garmentTypes = new Set(
        recommendation.recommendations.map((option) => {
          const lastWord = (option?.item || "").trim().toLowerCase().split(/\s+/).pop();
          return lastWord.endsWith("ss") ? lastWord : lastWord.replace(/s$/, "");
        })
      );

      if (garmentTypes.size === 1 && !garmentTypes.has("")) {
        return `${recommendation.count} ${[...garmentTypes][0]} suggestions`;
      }

      // Mixed pieces (hoodie, pants, tee): describe the look instead
      const style = recommendation.profile?.styles?.[0]?.replace("-", " ");

      return style
        ? `${recommendation.count} ${style} picks`
        : `${recommendation.count} recommendations`;
    }

    if (
      recommendation.request_type === "complete_outfits"
    ) {
      return `${recommendation.count} outfit ideas`;
    }

    return (
      recommendation.recommendations?.[0]?.title ||
      "Your Style Guide"
    );
  };

  // --------------------------------
  // SCREENS: chat, For You, Style DNA
  // --------------------------------

  const firstName = user?.name ? user.name.split(" ")[0] : "";

  // Starting points for a new conversation; each is just a message to the AI
  const STARTERS = [
    { icon: "💍", text: "I'm going to my cousin's wedding reception" },
    { icon: "📸", text: "What can I wear with this?", photo: true },
    { icon: "💼", text: "Three office outfits for this week" },
    { icon: "🌦️", text: "What should I wear today?" },
    { icon: "👕", text: "Build outfits from my wardrobe" },
    { icon: "🎨", text: "Which colours suit me best?" },
  ];

  // Today's starters, written by the AI for this person (weather, festivals,
  // their events, wardrobe, Style DNA). The list above shows until they
  // arrive, and stays if they can't be written.
  const [aiStarters, setAiStarters] = useState(null);
  const startersKey = regionCode
    ? JSON.stringify([user?.id || "guest", new Date().toDateString(), Boolean(coords), styleDnaForChat()])
    : null;

  useEffect(() => {
    if (view !== "stylist" || messages.length > 0 || !startersKey) {
      return undefined;
    }
    try {
      const cached = JSON.parse(sessionStorage.getItem("omnifit.starters"));
      if (cached?.key === startersKey) {
        setAiStarters(cached.starters);
        return undefined;
      }
    } catch {
      // No usable cache: ask for fresh ones
    }

    let cancelled = false;
    api("/api/starters", {
      method: "POST",
      json: {
        profile: styleDnaForChat(),
        region: regionCode,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
      },
    })
      .then((data) => {
        if (cancelled || !data.starters?.length) {
          return;
        }
        setAiStarters(data.starters);
        try {
          sessionStorage.setItem("omnifit.starters", JSON.stringify({ key: startersKey, starters: data.starters }));
        } catch {
          // Storage blocked: they'll just be asked for again
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // styleDnaForChat is rebuilt each render; the key captures what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, messages.length, startersKey]);

  // The photo starter stays: it opens the camera / gallery menu
  const starters = aiStarters
    ? [...aiStarters.slice(0, 5), STARTERS.find((starter) => starter.photo)]
    : STARTERS;

  const openStarter = (starter) => {
    if (starter.photo) {
      setQuestion(starter.text);
      setAttachMenuOpen(true);
      return;
    }
    sendChat(starter.text, { withPhoto: false });
  };

  // From Home / Explore / You: go to the stylist and ask
  const askStylist = (text) => {
    openView("stylist");
    sendChat(text, { withPhoto: false });
  };

  const renderWelcome = () => (
    <div className="chat-welcome">
      <span className="eyebrow">✦ AI PERSONAL STYLIST</span>
      <h1>{firstName ? `Hi ${firstName}, what` : "What"} are we dressing for today?</h1>
      <p>
        Type it, say it, or show me a photo. I'll understand the occasion, ask only what matters,
        and find it across 30+ Indian brands.
      </p>

      {aiStarters && <p className="starters-note">✦ Suggested for you today</p>}
      <div className="starter-grid">
        {starters.map((starter) => (
          <button type="button" className="starter" key={starter.text} onClick={() => openStarter(starter)}>
            <span aria-hidden="true">{starter.icon}</span>
            {starter.text}
          </button>
        ))}
      </div>

      <button type="button" className="scan-cta" onClick={() => setStyleScan({ status: "consent" })}>
        <span aria-hidden="true">✨</span>
        <span>
          <strong>Style Scan</strong> — one selfie, and the AI finds the accessories and colours that suit you
        </span>
      </button>

      {weather && (
        <p className="weather-line">
          {WEATHER_ICONS[weather.rain ? "rain" : weather.feel] || "🌤️"} {weather.high}°C near you
          {weather.rain ? `, ${weather.rain_chance}% chance of rain` : ""}: I'll pick fabrics to match.
        </p>
      )}

      {showLocationPrompt && (
        <p className="weather-line">
          📍 <button type="button" className="text-button" onClick={() => detectLocation()}>Use my location</button>{" "}
          for local stores and weather-smart outfits.
        </p>
      )}
    </div>
  );

  const renderAdvice = (advice) => (
    <div className="bot-advice">
      <p>{advice.answer}</p>
      {advice.tips?.length > 0 && (
        <ul>
          {advice.tips.map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
      )}
      {advice.shop?.length > 0 && (
        <div className="question-options">
          {advice.shop.map((item) => (
            <button type="button" key={item} onClick={() => sendChat(item, { withPhoto: false })} disabled={sending}>
              🛍️ {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderTips = (tips) => (
    <ul className="how-to-wear-list">
      {tips.ways.map((way) => (
        <li key={way.occasion}>
          <strong>{way.occasion}</strong>
          <span>{way.pair_with}</span>
          {way.tip && <em>Tip: {way.tip}</em>}
        </li>
      ))}
    </ul>
  );

  const renderWardrobePlan = (plan) => (
    <div className="bot-wardrobe">
      {(plan.outfits || []).map((outfit) => (
        <div className="bot-wardrobe-outfit" key={outfit.title}>
          <strong>{outfit.title}</strong>
          <span>{(outfit.piece_names || []).join(" + ")}</span>
          {outfit.reason && <em>{outfit.reason}</em>}
        </div>
      ))}
      {(plan.missing || []).length > 0 && (
        <div className="bot-wardrobe-missing">
          <strong>🛍️ Best next buy</strong>
          {plan.missing.map((piece) => (
            <div key={piece.search_query}>
              <p>
                {piece.color} {piece.item} <span className="unlocks-badge">+{piece.unlocks} looks</span>
              </p>
              {piece.products?.length > 0 && (
                <div className="product-list compact">
                  {piece.products.slice(0, 2).map((product) => renderProductCard(product, "compact"))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderMessage = (message, index) => {
    if (message.role === "user") {
      return (
        <li className="msg user" key={message.id} id={`msg-${message.id}`}>
          <div className="bubble">
            {message.photo && <img className="msg-photo" src={message.photo} alt="Your photo" />}
            {!message.photo && message.hadPhoto && <p className="msg-photo-note">📷 Photo</p>}
            {message.text && <p>{message.text}</p>}
          </div>
        </li>
      );
    }

    const working = message.status === "working";
    const previousUser = messages.at(index - 1);
    const hasResult = message.kind === "stylist" || message.kind === "browse";
    const count = message.kind === "stylist"
      ? `${message.result.count} ${message.result.request_type === "item_options" ? "picks" : "looks"}`
      : message.kind === "browse" ? `${message.browse.data.products.length} products` : "";

    return (
      <li className="msg bot" key={message.id} id={`msg-${message.id}`}>
        <span className="bot-avatar" aria-hidden="true">✦</span>
        <div className="bot-body">
          {/* The AI's steps, as they happen */}
          {message.steps?.length > 0 && (
            <ol className="ai-steps" aria-live="polite">
              {message.steps.map((step, stepIndex) => {
                const current = working && stepIndex === message.steps.length - 1;
                return (
                  <li key={`${step}-${stepIndex}`} className={current ? "current" : "done"}>
                    {current ? <span className="spinner dark small" /> : <span aria-hidden="true">✓</span>}
                    {stepIndex === 0 && !current ? "Understood your message" : `${step}${current ? "…" : ""}`}
                  </li>
                );
              })}
            </ol>
          )}

          {message.understood?.length > 0 && (
            <div className="understood-chips" aria-label="What I understood">
              {message.understood.map((chip) => <span key={chip}>{chip}</span>)}
            </div>
          )}

          {message.remembered?.length > 0 && (
            <p className="remembered">🧬 Saved to your Style DNA: {message.remembered.join(" · ")}</p>
          )}

          {message.reply && <p className="bot-reply">{message.reply}</p>}

          {message.question && (
            <div className="bot-question">
              <p>{message.question}</p>
              <div className="question-options">
                {message.options.map((option) => (
                  <button
                    type="button"
                    key={option}
                    onClick={() => sendChat(option, { withPhoto: false })}
                    disabled={message.answered || sending}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasResult && (activeMessageId === message.id ? (
            <p className="showing-below">⬇ Your {count} are just below</p>
          ) : (
            <button type="button" className="show-again" onClick={() => showAgain(message)}>
              ↺ Show these {count} again
            </button>
          ))}

          {message.kind === "advice" && renderAdvice(message.advice)}
          {message.kind === "tips" && renderTips(message.tips)}
          {message.kind === "wardrobe" && renderWardrobePlan(message.wardrobe)}

          {message.notes?.map((note) => <p className="bot-note" key={note}>{note}</p>)}

          {/* What to say next, written by the AI for this answer (latest answer only) */}
          {index === messages.length - 1 && !working && message.nextSteps?.length > 0 && (
            <div className="next-steps" aria-label="Suggested next steps">
              {message.nextSteps.map((step) => (
                <button type="button" key={step} onClick={() => sendChat(step, { withPhoto: false })} disabled={sending}>
                  ✦ {step}
                </button>
              ))}
            </div>
          )}

          {message.status === "error" && (
            <p className="inline-error">
              {message.error}{" "}
              {previousUser?.role === "user" && (
                <button type="button" className="text-button" onClick={() => sendChat(previousUser.text, { withPhoto: false })}>
                  Try again
                </button>
              )}
            </p>
          )}
        </div>
      </li>
    );
  };

  const renderChatThread = () => (
    <section className="chat" aria-label="Conversation with your stylist">
      {messages.length === 0 ? renderWelcome() : (
        <>
          <div className="chat-toolbar">
            <button type="button" className="text-button" onClick={startNewChat}>＋ New chat</button>
          </div>
          <ol className="chat-thread">
            {messages.map(renderMessage)}
          </ol>
        </>
      )}
      <div ref={threadEndRef} />
    </section>
  );

  const renderComposer = () => (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          sendChat();
        }}
      >
        {image && (
          <div className="attach-preview">
            <img src={image} alt="Photo to send" />
            <span>Photo attached: I'll style around it</span>
            <button type="button" onClick={removeImage} aria-label="Remove photo">×</button>
          </div>
        )}

        {(voiceError || photoError || error) && (
          <p className="inline-error" role="alert">{voiceError || photoError || error}</p>
        )}

        <div className="composer-row">
          <div className="attach">
            <button
              type="button"
              className="icon-button"
              aria-label="Add a photo"
              aria-expanded={attachMenuOpen}
              onClick={() => setAttachMenuOpen(!attachMenuOpen)}
            >
              📷
            </button>
            {attachMenuOpen && (
              <div className="attach-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => openCamera("outfit")}>📸 Take a photo</button>
                <button type="button" role="menuitem" onClick={() => fileInputRef.current?.click()}>🖼️ Choose a photo</button>
              </div>
            )}
          </div>

          <textarea
            id="styling-question"
            ref={questionRef}
            value={question}
            rows={1}
            aria-label="Message your stylist"
            placeholder={listening ? "Listening… tap ⏹ when you're done" : "Ask your stylist anything…"}
            onChange={(event) => {
              setQuestion(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendChat();
              }
            }}
          />

          {CAN_RECORD && (
            <button
              type="button"
              className={`icon-button mic ${listening ? "listening" : ""}`}
              onClick={listening ? stopListening : startListening}
              disabled={transcribing}
              aria-pressed={listening}
              aria-label={listening ? "Stop recording" : "Speak your question"}
              title="Your voice is turned into text on OmniFit's server and then deleted"
            >
              {transcribing ? <span className="spinner dark small" /> : listening ? "⏹" : "🎤"}
            </button>
          )}

          <button
            type="submit"
            className="send-button"
            disabled={sending || (!question.trim() && !image)}
            aria-label="Send"
          >
            {sending ? <span className="spinner small" /> : "➤"}
          </button>
        </div>

        <div className="composer-meta">
          {CAN_RECORD && (
            <select
              className="voice-select"
              value={voiceLanguage}
              onChange={(event) => chooseVoiceLanguage(event.target.value)}
              aria-label="Voice language"
              disabled={listening}
            >
              {VOICE_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>🎤 {language.label}</option>
              ))}
            </select>
          )}
          <span>Understands English, தமிழ், हिन्दी and mixes</span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          hidden
          onChange={handleImageUpload}
        />
      </form>
    </div>
  );

  const renderTrends = () => {
    if (!trendsData) {
      return null;
    }
    const community = trendsData.community?.trends || [];
    const guide = trendsData.guide || [];
    const groupLabel = AGE_GROUP_CHOICES.find((choice) => choice.key === trendsTab)?.label;
    const items = community.length ? community : guide;

    // Follows the age group the user told OmniFit; no tabs to pick
    if (!items.length) {
      return null;
    }

    return (
      <section className="trends-card" aria-labelledby="trends-title">
        <div className="trends-header">
          <h2 id="trends-title">🔥 What's trending{groupLabel ? ` for ${groupLabel}` : ""}</h2>
        </div>

        <p className="trends-note">
          {community.length
            ? `Most asked for on OmniFit in the last ${trendsData.community.days} days (each by ${trendsData.min_people}+ people).`
            : "Popular directions to start with. Live OmniFit trends appear once enough people use it."}
        </p>

        {items.length > 0 && (
          <div className="trend-chips">
            {items.map((item) => (
              <button type="button" className="trend-chip" key={item.query} onClick={() => askStylist(item.query)}>
                {item.label} {item.people ? <small>{item.people} people</small> : null}
              </button>
            ))}
          </div>
        )}
      </section>
    );
  };

  const SLOT_LABELS = {
    top: "Top", layer: "Layer", bottom: "Bottom", one_piece: "Outfit", footwear: "Footwear", accessory: "Accessory",
  };

  const renderFeedSkeleton = () => (
    <div className="feed-loading" aria-live="polite">
      <p className="cart-status">
        <span className="spinner dark small" /> Your stylist is putting today's picks together…
      </p>
      <div className="feed-skeletons">
        {[0, 1, 2].map((n) => (
          <div className="skeleton-card" key={n}>
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
          </div>
        ))}
      </div>
    </div>
  );

  const renderForYou = () => {
    const feed = feedState.data;
    const missingScan = !personal.face_shape || !personal.undertone;

    return (
      <section className="foryou">
        <div className="foryou-header">
          <span className="eyebrow">🏠 FOR YOU · WRITTEN BY YOUR AI STYLIST</span>
          <h1>{feed?.greeting || `${firstName ? `${firstName}, here's` : "Here's"} what to explore today`}</h1>
          <div className="feed-meta">
            {weather && (
              <span>
                {WEATHER_ICONS[weather.rain ? "rain" : weather.feel] || "🌤️"} {weather.high}°C near you
                {weather.rain ? `, ${weather.rain_chance}% chance of rain` : ""}
              </span>
            )}
            {feed && (
              <button
                type="button"
                className="text-button"
                onClick={() => loadFeed({ refresh: true })}
                disabled={feedState.status === "loading"}
              >
                ↻ Fresh ideas
              </button>
            )}
          </div>
        </div>

        {feedState.status === "loading" && !feed && renderFeedSkeleton()}
        {feedState.status === "error" && (
          <p className="inline-error">
            {feedState.error}{" "}
            <button type="button" className="text-button" onClick={() => loadFeed({ refresh: true })}>Try again</button>
          </p>
        )}

        {feed && (
          <div className={feedState.status === "loading" ? "feed refreshing" : "feed"}>

            {/* TODAY'S OUTFIT */}
            <article className="feed-card today-card">
              <div className="feed-card-head">
                <span className="feed-kicker">🌦️ Today's outfit</span>
                <h2>{feed.today.title}</h2>
                {feed.today.reason && <p>{feed.today.reason}</p>}
              </div>
              <div className="today-pieces">
                {feed.today.pieces.map((piece) => (
                  <div className={`today-piece ${piece.owned ? "owned" : ""}`} key={`${piece.slot}-${piece.name}`}>
                    <span className="item-label">{SLOT_LABELS[piece.slot] || piece.slot}</span>
                    <strong>{piece.name}</strong>
                    {piece.owned ? (
                      <span className="kept-badge">✓ In your wardrobe</span>
                    ) : piece.products?.length ? (
                      <div className="product-list compact">{renderProductCard(piece.products[0], "compact")}</div>
                    ) : (
                      <button type="button" className="text-button" onClick={() => askStylist(`Show me ${piece.name}`)}>
                        Find it →
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="feed-card-actions">
                <button
                  type="button"
                  className="question-options-button"
                  onClick={() => askStylist(`Tweak today's outfit: ${feed.today.pieces.map((piece) => piece.name).join(", ")}`)}
                >
                  💬 Tweak it with my stylist
                </button>
              </div>
            </article>

            {/* IDEAS WRITTEN FOR THIS PERSON */}
            <div className="foryou-section">
              <h2>Ideas for you</h2>
              <div className="idea-cards">
                {feed.ideas.map((idea) => (
                  <button type="button" className="idea-card" key={idea.message} onClick={() => askStylist(idea.message)}>
                    <strong>{idea.title}</strong>
                    <span>“{idea.message}”</span>
                    {idea.why && <small>{idea.why}</small>}
                    <em>Ask your stylist →</em>
                  </button>
                ))}
              </div>
            </div>

            {/* COMING UP */}
            {feed.festivals?.length > 0 && (
              <div className="foryou-section">
                <h2>Coming up</h2>
                <div className="festival-chips">
                  {feed.festivals.map((festival) => (
                    <button
                      type="button"
                      className="festival-chip"
                      key={festival.name}
                      onClick={() => askStylist(`Plan my ${festival.name} look`)}
                    >
                      <strong>{festival.name}</strong>
                      <span>{festival.label} · {festival.days_away === 0 ? "today" : `in ${festival.days_away} days`}</span>
                    </button>
                  ))}
                </div>
                {feed.festival_tip && <p className="feed-tip">💡 {feed.festival_tip}</p>}
              </div>
            )}

            {/* BEST NEXT BUY + TREND PICK */}
            <div className="feed-pair">
              {[
                feed.next_buy && {
                  kicker: feed.wardrobe_pieces ? "🛍️ Best next buy for your wardrobe" : "🛍️ A staple worth owning",
                  // "Indigo" + "indigo printed scarf" -> said once
                  title: feed.next_buy.item.toLowerCase().includes(feed.next_buy.color.toLowerCase())
                    ? feed.next_buy.item
                    : `${feed.next_buy.color} ${feed.next_buy.item}`.trim(),
                  why: feed.next_buy.why,
                  products: feed.next_buy.products,
                  ask: `Show me ${feed.next_buy.color} ${feed.next_buy.item}`.trim(),
                },
                feed.trend_pick && {
                  kicker: "🔥 A trend for you",
                  title: feed.trend_pick.title,
                  why: feed.trend_pick.why,
                  products: feed.trend_pick.products,
                  ask: feed.trend_pick.search_query,
                },
              ].filter(Boolean).map((block) => (
                <article className="feed-card" key={block.kicker}>
                  <span className="feed-kicker">{block.kicker}</span>
                  <h2>{block.title}</h2>
                  {block.why && <p>{block.why}</p>}
                  {block.products?.length > 0 && (
                    <div className="product-list compact">
                      {block.products.slice(0, 2).map((product) => renderProductCard(product, "compact"))}
                    </div>
                  )}
                  <button type="button" className="text-button" onClick={() => askStylist(block.ask)}>
                    See every style →
                  </button>
                </article>
              ))}
            </div>
          </div>
        )}

        {renderTrends()}

        {/* Nudges that make the feed smarter */}
        <div className="foryou-section foryou-actions">
          {missingScan && (
            <button type="button" className="foryou-action" onClick={() => setStyleScan({ status: "consent" })}>
              <span aria-hidden="true">✨</span>
              <strong>Style Scan</strong>
              <small>Let the AI match accessories and colours to you</small>
            </button>
          )}
          {!feed?.wardrobe_pieces && (
            <button
              type="button"
              className="foryou-action"
              onClick={() => (user ? openView("wardrobe") : setAuthPrompt({ reason: "", then: "wardrobe" }))}
            >
              <span aria-hidden="true">👕</span>
              <strong>Add your wardrobe</strong>
              <small>Tomorrow's outfit will use clothes you own</small>
            </button>
          )}
          <button type="button" className="foryou-action" onClick={() => openView("you")}>
            <span aria-hidden="true">🧬</span>
            <strong>Your Style DNA</strong>
            <small>See what your stylist has learned</small>
          </button>
        </div>
      </section>
    );
  };

  const renderStyleDna = () => {
    const learnedStyles = [
      ...(libraryTaste?.styles || []),
      ...topKeys(tasteRef.current.styles, 3),
    ].filter((style, index, list) => list.indexOf(style) === index).slice(0, 4);

    const rows = [
      ["Shopping for", DEPARTMENT_NAMES[department] || "The AI works it out"],
      ["Budget", budgetIsSet ? describeBudget(budget) : "Any budget"],
      ["Sizes", [
        mySizes.top && `Top ${mySizes.top}`,
        mySizes.bottom && `Waist ${mySizes.bottom}`,
        mySizes.footwear && `UK ${mySizes.footwear}`,
      ].filter(Boolean).join(" · ") || "Not set"],
      ["Fit I like", measurements.fit ? measurements.fit.charAt(0).toUpperCase() + measurements.fit.slice(1) : "Regular"],
      ["Age group", AGE_GROUP_CHOICES.find((choice) => choice.key === ageGroup)?.label || "Not set"],
      ["Face shape", FACE_SHAPE_CHOICES.find((choice) => choice.key === personal.face_shape)?.label || "Not set"],
      ["Undertone", UNDERTONE_CHOICES.find((choice) => choice.key === personal.undertone)?.label || "Not set"],
      ["Styles I love", (() => {
        const text = learnedStyles.map((style) => style.replace("-", " ")).join(", ");
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Learning from your chats";
      })()],
      ["Region", currentRegion?.name || "—"],
    ];

    return (
      <section className="dna">
        <div className="dna-hero">
          <span className="eyebrow">🧬 YOUR STYLE DNA</span>
          <h1>What OmniFit knows about you</h1>
          <p>
            Learned from your chats, your wardrobe and the looks you save. Just tell the stylist
            ("I wear M", "my budget is ₹3,000") or edit it here.
          </p>
          <div className="dna-actions">
            <button type="button" className="primary-button" onClick={() => setStyleScan({ status: "consent" })}>
              ✨ Style Scan
            </button>
            <button type="button" className="primary-button" onClick={openBodyScan}>
              📏 Body Scan
            </button>
            <button type="button" className="ghost-light" onClick={() => setStyleOpen(true)}>
              ✎ Edit
            </button>
          </div>
        </div>

        <div className="dna-grid">
          {rows.map(([label, value]) => (
            <div className="dna-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        {(personal.face_shape || personal.undertone) && (
          <button
            type="button"
            className="scan-cta"
            onClick={() => askStylist(
              `Suggest earrings, frames and colours that suit my ${personal.face_shape || ""} face shape and ${personal.undertone || ""} undertone`
            )}
          >
            <span aria-hidden="true">💎</span>
            <span><strong>Accessories and colours for you</strong>: ask the stylist, using your Style DNA</span>
          </button>
        )}
      </section>
    );
  };

  const renderClosetSignIn = () => (
    <section className="dna">
      <div className="dna-hero">
        <span className="eyebrow">👕 YOUR CLOSET</span>
        <h1>Sign in to build your wardrobe</h1>
        <p>
          Photograph the clothes you own and save looks you love. OmniFit then styles outfits from what you
          have and tells you the one piece that adds the most new looks.
        </p>
        <div className="dna-actions">
          <button type="button" className="primary-button" onClick={() => setAuthPrompt({ reason: "", then: view })}>
            Sign in or create an account
          </button>
        </div>
      </div>
    </section>
  );



  // What the browser has learned from questions and store clicks (Style DNA dialog)
  const learnedTaste = {
    styles: topKeys(tasteRef.current.styles, 5),
    stores: topKeys(tasteRef.current.stores, 5),
  };

  const value = {
    currentRegion,
    learnedTaste,
    image,
    setImage,
    question,
    setQuestion,
    recommendation,
    setRecommendation,
    cameraOpen,
    setCameraOpen,
    cameraReady,
    setCameraReady,
    photoError,
    setPhotoError,
    error,
    setError,
    regions,
    setRegions,
    regionCode,
    setRegionCode,
    locating,
    setLocating,
    locationMessage,
    setLocationMessage,
    showLocationPrompt,
    setShowLocationPrompt,
    department,
    setDepartment,
    budget,
    setBudget,
    productState,
    setProductState,
    anyColour,
    setAnyColour,
    browseRequest,
    setBrowseRequest,
    browseState,
    setBrowseState,
    coords,
    setCoords,
    weather,
    setWeather,
    occasions,
    setOccasions,
    howToWear,
    setHowToWear,
    sharing,
    setSharing,
    messages,
    setMessages,
    activeMessageId,
    setActiveMessageId,
    sending,
    setSending,
    threadEndRef,
    feedState,
    setFeedState,
    cameraPurpose,
    setCameraPurpose,
    styleScan,
    setStyleScan,
    bodyScan,
    setBodyScan,
    countdown,
    setCountdown,
    bodyFileRef,
    attachMenuOpen,
    setAttachMenuOpen,
    listening,
    setListening,
    transcribing,
    setTranscribing,
    voiceError,
    setVoiceError,
    voiceLanguage,
    setVoiceLanguage,
    speaking,
    setSpeaking,
    recognitionRef,
    tasteRef,
    user,
    setUser,
    authChecked,
    setAuthChecked,
    libraryTaste,
    setLibraryTaste,
    googleClientId,
    setGoogleClientId,
    authPrompt,
    setAuthPrompt,
    view,
    setView,
    accountMenuOpen,
    setAccountMenuOpen,
    sharedPayload,
    setSharedPayload,
    installPrompt,
    setInstallPrompt,
    personalizeOn,
    setPersonalizeOn,
    mySizes,
    setMySizes,
    ageGroup,
    setAgeGroup,
    personal,
    setPersonal,
    trendsTab,
    setTrendsTab,
    trendsData,
    setTrendsData,
    measurements,
    setMeasurements,
    styleOpen,
    setStyleOpen,
    cartPicker,
    setCartPicker,
    fileInputRef,
    selectedFileRef,
    videoRef,
    streamRef,
    questionRef,
    resultsRef,
    selectRegion,
    updateWeather,
    detectWeatherOnly,
    detectLocation,
    buildShopLinks,
    renderShopLinks,
    catalogAvailable,
    formatPrice,
    describeBudget,
    budgetIsSet,
    recordStoreClick,
    openView,
    shareNeedsSignIn,
    handleSignedIn,
    closeAuth,
    signOut,
    deleteAccount,
    historyOn,
    setHistoryOn,
    toggleHistory,
    clearHistory,
    stopListening,
    transcribe,
    startListening,
    chooseVoiceLanguage,
    canSpeak,
    describeForSpeech,
    toggleSpeaking,
    togglePersonalize,
    choosePersonal,
    chooseAgeGroup,
    updateMeasurement,
    sizeAdvice,
    applySuggestedSizes,
    updateMySize,
    resetTaste,
    isMySize,
    openCartPicker,
    goToCheckout,
    anyColourIds,
    toggleAnyColour,
    pieceQuery,
    canShowAllColours,
    getProductQueries,
    renderColourToggle,
    productQueries,
    profileDepartment,
    productsReady,
    products,
    priceRange,
    productsLoading,
    getProductsFor,
    makeBrowseKey,
    fetchBrowse,
    browseKey,
    browseData,
    browseLoading,
    askStylistInstead,
    showBrowse,
    browseColour,
    toggleHowToWear,
    renderHowToWear,
    renderProductCard,
    renderProducts,
    loadImage,
    wrapText,
    shareLook,
    getLookTotal,
    selectImageFile,
    handleImageUpload,
    openCamera,
    closeCamera,
    capturePhoto,
    removeImage,
    runStyleScan,
    saveStyleScan,
    openBodyScan,
    startCountdown,
    runBodyScan,
    saveBodyScan,
    styleDnaForChat,
    applyRemembered,
    summarizeStylist,
    showAgain,
    sendChat,
    feedKey,
    loadFeed,
    startNewChat,
    getItemIcon,
    getItemLabel,
    getSwatchColor,
    renderItemOption,
    outfitSlots,
    renderCompleteOutfit,
    getResultTitle,
    firstName,
    STARTERS,
    openStarter,
    askStylist,
    renderWelcome,
    renderAdvice,
    renderTips,
    renderWardrobePlan,
    renderMessage,
    renderChatThread,
    renderComposer,
    renderTrends,
    SLOT_LABELS,
    renderFeedSkeleton,
    renderForYou,
    renderStyleDna,
    renderClosetSignIn,
  };

  return <OmniFitContext.Provider value={value}>{children}</OmniFitContext.Provider>;
}
