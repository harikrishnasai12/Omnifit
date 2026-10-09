import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL, api } from "../api";

// The Home look feed: pages of ranked looks from /api/feed, and the signals
// that teach it (love, save, skip, time spent, product taps, cart).
//
// Signed-in people: signals go to the server in small batches (not while
// personalisation is paused). Guests: nothing is stored on the server. Their
// taste, "Not me" corrections, what the chat understood and the looks they've
// seen stay on this device, and go with each feed request. When a guest signs
// up, their signals move to the new account (see uploadGuestSignals).

const WEIGHTS = { love: 3, save: 2, cart: 4, tryon: 2, product_tap: 1, dwell: 0.5, skip: -1, unlove: -3 };
export const DWELL_MIN_MS = 3500;
const FLUSH_MS = 4000;
const FLUSH_AT = 20;
const MAX_SEEN = 300;
const MAX_GUEST_SIGNALS = 200;
const INTENT_DAYS = 14;

const KEYS = {
  taste: "omnifit.guest.taste",
  seen: "omnifit.guest.seen",
  signals: "omnifit.guest.signals",
  notMe: "omnifit.guest.notMe",
  intent: "omnifit.guest.intent",
};

// Browser storage can be missing or blocked (private windows): never fatal
const read = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the feed still works, it just learns less
  }
};

// What a look says about taste (the same dimensions the server learns)
export const lookAttributes = (look) => ({
  style: look.styles || [],
  colour: look.colours || [],
  fit: look.fits || [],
  occasion: look.occasion ? [look.occasion] : [],
  brand: [...new Set((look.pieces || []).map((piece) => piece.product?.store).filter(Boolean))].slice(0, 4),
});

// ---------- Guests: on this device only ----------

const learnOnDevice = (kind, look) => {
  const weight = WEIGHTS[kind];
  if (!weight || !look) return;
  const taste = read(KEYS.taste, {});
  for (const [dimension, values] of Object.entries(lookAttributes(look))) {
    taste[dimension] = taste[dimension] || {};
    for (const value of values) {
      taste[dimension][value] = Math.round(((taste[dimension][value] || 0) + weight) * 10) / 10;
    }
  }
  write(KEYS.taste, taste);
};

export const guestNotMe = (dimension, value) => {
  const list = read(KEYS.notMe, []).filter(([d, v]) => !(d === dimension && v === value));
  write(KEYS.notMe, [...list, [dimension, value]].slice(-50));
  const taste = read(KEYS.taste, {});
  if (taste[dimension]) delete taste[dimension][value];
  write(KEYS.taste, taste);
};

// What the chat understood, so a guest's feed follows it too
export const rememberGuestIntent = (event) => {
  // An occasion read from their photo isn't something they asked for
  const occasion = event?.occasion?.from_photo ? null : event?.occasion?.id;
  const budgetMax = event?.budget_max;
  if (!occasion && !budgetMax) return;
  const current = read(KEYS.intent, {});
  write(KEYS.intent, {
    occasion: occasion || current.occasion || "",
    budget_max: budgetMax || current.budget_max || null,
    at: Date.now(),
  });
};

const guestContext = () => {
  const intent = read(KEYS.intent, {});
  const fresh = intent.at && Date.now() - intent.at < INTENT_DAYS * 86400 * 1000;
  // Only the positive side of taste is shared; the server ignores the rest
  const taste = Object.fromEntries(
    Object.entries(read(KEYS.taste, {})).map(([dimension, values]) => [
      dimension,
      Object.fromEntries(Object.entries(values).filter(([, score]) => score > 0.5).slice(0, 20)),
    ])
  );
  return {
    taste,
    seen: read(KEYS.seen, []).slice(-MAX_SEEN),
    not_me: read(KEYS.notMe, []),
    occasion: fresh ? intent.occasion || "" : "",
    budget_max: fresh ? intent.budget_max || null : null,
  };
};

// At sign-up (with the consent given there), a guest's signals move to the
// account and leave this device
export async function uploadGuestSignals() {
  const signals = read(KEYS.signals, []);
  for (let start = 0; start < signals.length; start += 50) {
    try {
      await api("/api/signals", { method: "POST", json: { signals: signals.slice(start, start + 50) } });
    } catch {
      return;
    }
  }
  for (const key of Object.values(KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to clear
    }
  }
}

// ---------- The feed ----------

export function useLookFeed({ active, signedIn, personalizeOn, section, ageGroup, region, coords }) {
  const [state, setState] = useState({ cards: [], cursor: "", status: "idle", caughtUp: false, paused: false, error: "" });
  const queue = useRef([]);
  const timer = useRef(null);
  const loading = useRef(false);
  const key = JSON.stringify([signedIn, section, ageGroup, region, Boolean(coords)]);
  const loadedKey = useRef(null);

  const flush = useCallback((keepalive = false) => {
    clearTimeout(timer.current);
    const batch = queue.current.splice(0, 50);
    if (!batch.length) return;
    fetch(`${API_BASE_URL}/api/signals`, {
      method: "POST",
      credentials: "same-origin",
      keepalive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signals: batch }),
    }).catch(() => {});
  }, []);

  const signal = useCallback(
    (kind, look, extra = {}) => {
      if (!personalizeOn) return;
      const entry = { kind, look_id: look?.id || null, ...extra };
      if (signedIn) {
        queue.current.push(entry);
        clearTimeout(timer.current);
        if (queue.current.length >= FLUSH_AT) flush();
        else timer.current = setTimeout(() => flush(), FLUSH_MS);
        return;
      }
      if (kind === "view" && look) {
        write(KEYS.seen, [...read(KEYS.seen, []).filter((id) => id !== look.id), look.id].slice(-MAX_SEEN));
      } else {
        learnOnDevice(kind === "dwell" && (extra.value || 0) < DWELL_MIN_MS ? null : kind, look);
      }
      write(KEYS.signals, [...read(KEYS.signals, []), entry].slice(-MAX_GUEST_SIGNALS));
    },
    [flush, personalizeOn, signedIn]
  );

  // Send what's queued when the page is hidden or closed
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush(true);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush(true);
    };
  }, [flush]);

  const loadPage = useCallback(
    async (cursor) => {
      if (loading.current) return;
      loading.current = true;
      setState((current) => ({ ...current, status: "loading", error: "" }));
      try {
        const data = await api("/api/feed", {
          method: "POST",
          json: {
            cursor: cursor || "",
            region,
            section: section === "men" || section === "women" ? section : "",
            age_group: ageGroup || "",
            latitude: coords?.latitude ?? null,
            longitude: coords?.longitude ?? null,
            ...(signedIn ? {} : guestContext()),
          },
        });
        prefetchImages(data.cards);
        setState((current) => ({
          cards: cursor ? [...current.cards, ...data.cards] : data.cards,
          cursor: data.cursor || "",
          status: "ready",
          caughtUp: data.caught_up,
          paused: data.paused,
          error: "",
        }));
      } catch (error) {
        setState((current) => ({ ...current, status: "error", error: error.message }));
      } finally {
        loading.current = false;
      }
    },
    [ageGroup, coords, region, section, signedIn]
  );

  // A new session whenever who it's for changes
  useEffect(() => {
    if (!active || loadedKey.current === key) return;
    loadedKey.current = key;
    loadPage("");
  }, [active, key, loadPage]);

  const loadMore = useCallback(() => {
    if (state.cursor && !state.caughtUp && state.status !== "loading") loadPage(state.cursor);
  }, [loadPage, state.caughtUp, state.cursor, state.status]);

  const refresh = useCallback(() => loadPage(""), [loadPage]);

  return { ...state, signal, loadMore, refresh };
}

// Bigger product photos for full-screen cards (Shopify resizes on request)
export const largeImage = (url, width = 720) =>
  url && url.includes("cdn.shopify.com") ? url.replace(/width=\d+/, `width=${width}`) : url;

function prefetchImages(cards) {
  for (const card of cards || []) {
    for (const piece of (card.pieces || []).slice(0, 4)) {
      if (piece.product?.image) {
        const image = new Image();
        image.src = largeImage(piece.product.image);
      }
    }
  }
}
