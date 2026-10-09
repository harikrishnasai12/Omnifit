import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, api } from "../api";
import { useOmniFit } from "../app/context";
import { buildGarment, fitOf, sizesFor } from "./dress";
import { buildMannequin, createViewer, layoutOf } from "./mannequin";
import { faceForProfile, faceFromBodyPhoto, faceFromCloseUp, faceFromSaved } from "./face";
import { measure, photoForProfile, readPhoto } from "./measure";

const VIEWS = [
  { key: "front", label: "Front", hint: "Facing the camera, arms a little away from your body", required: true },
  { key: "side", label: "Side", hint: "Turned fully sideways, arms down" },
  { key: "back", label: "Back", hint: "Facing away from the camera" },
];
// Not a view of the body: a close-up, for a clear face on the mannequin
const FACE_SHOT = { key: "face", label: "Face close-up", hint: "Looking straight at the camera, in good light: the clearest face" };
// What is kept about a face besides its picture
const faceDetails = ({ cheekShare, lengthShare, aspect, skin, hair, sharpness, soft, turned }) => (
  { cheekShare, lengthShare, aspect, skin, hair, sharpness, soft, turned }
);
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const SECTION_NAMES = { men: "Men's figure", women: "Women's figure" };
const MEASURES = [
  ["chest", "Chest"], ["waist", "Waist"], ["hip", "Hip"], ["shoulder", "Shoulders"], ["arm", "Arm"], ["inseam", "Inside leg"],
];
// Changing one of these by hand reshapes the mannequin at these levels of the torso
const RESHAPES = { chest: [0, 0.42], waist: [0.5, 0.9], hip: [0.92, 2] };
const VERDICT_WORDS = { "too small": "Too small", snug: "Snug", regular: "Regular fit", loose: "Loose" };

// My Mannequin: the person's own 3D figure, measured from their photos, with
// the selected product on it. Turn it to see every side.
//   photos (front, side, back) + height -> each photo checked -> measurements
//   -> a mannequin of those sizes with their face -> the product on it, in a
//   chosen size -> how that size fits.
// Everything is worked out on this device. For a signed-in person the photos
// and measurements are also kept in their profile.
export default function MannequinTryOn({ product, garment, cut, preparing }) {
  const { user, measurements: styleDna, setAuthPrompt } = useOmniFit();

  const [status, setStatus] = useState("loading"); // loading | capture | ready
  const [files, setFiles] = useState({});
  const [previews, setPreviews] = useState({});
  const [heightCm, setHeightCm] = useState(styleDna?.height_cm ? String(styleDna.height_cm) : "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [body, setBody] = useState(null); // { measurements, profile, section, guessed, notes, depthMeasured }
  const [face, setFace] = useState(null);
  const [picked, setPicked] = useState(""); // the size chosen by hand
  const [saved, setSaved] = useState(false);

  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const inputRefs = useRef({});
  const faceInputRef = useRef(null);

  // A saved mannequin comes back when the page opens
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        setStatus("capture");
        return;
      }
      try {
        const stored = await api("/api/me/avatar");
        if (cancelled) return;
        if (!stored.saved || !stored.data?.measurements) {
          setStatus("capture");
          return;
        }
        setBody(stored.data);
        setHeightCm(String(stored.data.measurements.height));
        setSaved(true);
        setStatus("ready");
        // The face comes back as it was framed when the mannequin was made
        if (stored.photos.includes("face") && stored.data.face) {
          const response = await fetch(`${API_BASE_URL}/api/me/avatar/photo/face`, { credentials: "same-origin" });
          if (response.ok && !cancelled) {
            const restored = await faceFromSaved(await response.blob(), stored.data.face);
            if (!cancelled) setFace(restored);
          }
        }
      } catch {
        if (!cancelled) setStatus("capture");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const choose = (view, file) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError("Please use JPG, PNG or WEBP photos.");
      return;
    }
    setError("");
    setFiles((current) => ({ ...current, [view]: file }));
    setPreviews((current) => {
      if (current[view]) URL.revokeObjectURL(current[view]);
      return { ...current, [view]: URL.createObjectURL(file) };
    });
  };

  // Photos -> checks -> measurements -> mannequin
  const build = async () => {
    setError("");
    const height = Number(heightCm);
    if (!files.front) {
      setError("Add a front photo to start.");
      return;
    }
    if (!(height >= 120 && height <= 220)) {
      setError("Enter your height in centimetres (120 to 220).");
      return;
    }
    try {
      const photos = {};
      for (const view of VIEWS) {
        if (!files[view.key]) continue;
        setBusy(`Checking your ${view.label.toLowerCase()} photo…`);
        const photo = await readPhoto(files[view.key], view.key);
        if (!photo.ok) {
          setError(photo.message);
          return;
        }
        photos[view.key] = photo;
      }

      setBusy("Measuring…");
      const measured = measure(photos, height);
      if (!measured.ok) {
        setError(measured.message);
        return;
      }

      // A men's or women's figure: a guess from the front photo, made on this
      // device and shown for the person to change
      setBusy("Building your mannequin…");
      let section = null;
      try {
        const { suggestAgeAndSection } = await import("../agescan");
        section = (await suggestAgeAndSection(files.front))?.section || null;
      } catch {
        section = null;
      }
      // The face: from the close-up when one was given, else from the front photo
      let found = null;
      try {
        found = files.face ? await faceFromCloseUp(files.face) : await faceFromBodyPhoto(photos.front);
        if (files.face && !found) {
          setError("I couldn't find a face in the close-up. Use one that shows your whole face, looking at the camera.");
          return;
        }
      } catch {
        found = null;
      }

      const next = {
        measurements: measured.measurements, profile: measured.profile, notes: measured.notes,
        depthMeasured: measured.depthMeasured, section: section || "men",
        // "yes": guessed from the photo; "no": the guess wasn't sure enough, so it starts on one for the person to set
        guessed: section ? "yes" : "no",
        face: found ? { ...faceDetails(found), closeUp: Boolean(files.face) } : null,
      };
      setBody(next);
      setFace(found);
      setStatus("ready");

      if (user) {
        setBusy("Saving to your profile…");
        const form = new FormData();
        form.append("data", JSON.stringify(next));
        for (const [view, photo] of Object.entries(photos)) {
          form.append(view, await photoForProfile(photo), `${view}.jpg`);
        }
        if (found) form.append("face", await faceForProfile(found), "face.jpg");
        try {
          await api("/api/me/avatar", { method: "POST", form });
          setSaved(true);
        } catch (saveError) {
          setError(`Your mannequin is ready, but it couldn't be saved: ${saveError.message}`);
        }
      }
    } catch (buildError) {
      setError(buildError.message || "Couldn't read those photos. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const persist = async (next, newFace = null) => {
    setBody(next);
    if (!user || !saved) return;
    const form = new FormData();
    form.append("data", JSON.stringify(next));
    if (newFace) form.append("face", await faceForProfile(newFace), "face.jpg");
    api("/api/me/avatar", { method: "POST", form }).catch(() => {});
  };

  // A close-up added afterwards replaces the face on the mannequin
  const replaceFace = async (file) => {
    if (!file || !body) return;
    if (!ACCEPTED.includes(file.type)) {
      setError("Please use a JPG, PNG or WEBP photo.");
      return;
    }
    setError("");
    setBusy("Reading your face…");
    try {
      const found = await faceFromCloseUp(file);
      if (!found) {
        setError("I couldn't find a face in that photo. Use one that shows your whole face, looking at the camera.");
        return;
      }
      setFace(found);
      persist({ ...body, face: { ...faceDetails(found), closeUp: true } }, found);
    } catch {
      setError("Couldn't read that photo. Please try another.");
    } finally {
      setBusy("");
    }
  };

  // A measurement corrected by hand reshapes the mannequin at that part of the body
  const correct = (key, value) => {
    const number = Number(value);
    if (!body || !(number > 20 && number < 250)) return;
    const factor = number / body.measurements[key];
    const range = RESHAPES[key];
    persist({
      ...body,
      measurements: { ...body.measurements, [key]: number },
      profile: range
        ? body.profile.map((entry) =>
            entry.level >= range[0] && entry.level <= range[1]
              ? { ...entry, halfWidth: entry.halfWidth * factor, halfDepth: entry.halfDepth * factor }
              : entry)
        : body.profile,
    });
  };

  const startOver = async () => {
    if (user && saved) {
      if (!window.confirm("Delete your mannequin, its photos and measurements from your profile?")) return;
      try {
        await api("/api/me/avatar", { method: "DELETE" });
      } catch (deleteError) {
        setError(deleteError.message);
        return;
      }
    }
    Object.values(previews).forEach((url) => URL.revokeObjectURL(url));
    // The viewer belongs to a canvas that is about to go
    viewerRef.current?.dispose();
    viewerRef.current = null;
    setFiles({});
    setPreviews({});
    setBody(null);
    setFace(null);
    setSaved(false);
    setStatus("capture");
  };

  const wearable = Boolean(garment) && ["upper", "lower", "full"].includes(garment.region);
  const layout = useMemo(() => (body ? layoutOf(body.measurements, body.profile, body.section) : null), [body]);

  // The sizes to offer; until one is picked, the one that fits best is tried
  const sizes = useMemo(
    () => (body && wearable ? sizesFor(garment, body.section, product?.sizes || []) : []),
    [body, garment, product, wearable]
  );
  const size = useMemo(() => {
    if (!sizes.length) return "";
    if (sizes.some((entry) => entry.label === picked)) return picked;
    return fitOf(garment, body.section, sizes[0].label, body.measurements).best;
  }, [sizes, picked, garment, body]);
  const fit = useMemo(
    () => (size ? fitOf(garment, body.section, size, body.measurements) : null),
    [size, garment, body]
  );

  // The viewer: the mannequin, then the garment on it
  useEffect(() => {
    if (status !== "ready" || !layout || !canvasRef.current) return;
    if (!viewerRef.current) viewerRef.current = createViewer(canvasRef.current);
    viewerRef.current.setMannequin(buildMannequin(layout, face), layout.H, layout.head.y);
  }, [status, layout, face]);

  useEffect(() => {
    if (status !== "ready" || !layout || !viewerRef.current) return;
    viewerRef.current.setGarment(
      wearable && cut && size ? buildGarment(garment, cut, layout, body.measurements, size) : null
    );
  }, [status, layout, body, garment, cut, size, wearable]);

  useEffect(() => () => {
    viewerRef.current?.dispose();
    viewerRef.current = null;
  }, []);

  if (status === "loading") {
    return <p className="cart-status"><span className="spinner dark small" /> Loading your mannequin…</p>;
  }

  if (status === "capture") {
    return (
      <div className="mannequin-capture">
        <h2>Build your 3D mannequin</h2>
        <p className="tryon-lede">
          Three photos and your height. OmniFit measures you from them and builds a mannequin your size, with your face,
          to try clothes on.
        </p>

        <div className="mannequin-photos">
          {[...VIEWS, FACE_SHOT].map((view) => (
            <button
              type="button"
              key={view.key}
              className={`mannequin-photo ${previews[view.key] ? "filled" : ""}`}
              onClick={() => inputRefs.current[view.key]?.click()}
            >
              {previews[view.key] ? <img src={previews[view.key]} alt={`Your ${view.label.toLowerCase()} photo`} /> : <span aria-hidden="true">＋</span>}
              <strong>{view.label}{view.required ? "" : " (better with)"}</strong>
              <small>{view.hint}</small>
            </button>
          ))}
        </div>
        {[...VIEWS, FACE_SHOT].map((view) => (
          <input
            key={view.key}
            ref={(node) => { inputRefs.current[view.key] = node; }}
            type="file"
            accept={ACCEPTED.join(",")}
            data-view={view.key}
            hidden
            onChange={(event) => {
              choose(view.key, event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        ))}

        <ul className="scan-points">
          <li><span aria-hidden="true">📐</span><span>Whole body in every photo, head to feet, camera at waist height, 2 to 3 metres away.</span></li>
          <li><span aria-hidden="true">👕</span><span>Close-fitting clothes and a plain background measure best. Loose clothes add to the numbers.</span></li>
        </ul>

        <label className="measure-field mannequin-height">
          <span>Your height (cm)</span>
          <input
            type="number" inputMode="numeric" min="120" max="220" placeholder="e.g. 168"
            value={heightCm} onChange={(event) => setHeightCm(event.target.value)}
          />
        </label>

        {error && <p className="inline-error" role="alert">{error}</p>}

        <button type="button" className="primary-button" onClick={build} disabled={Boolean(busy)}>
          {busy ? <><span className="spinner" /> {busy}</> : "Build my mannequin"}
        </button>

        <p className="measure-hint">
          {user
            ? "Your photos are measured on this device, then saved to your profile with the measurements so your mannequin is ready next time. You can delete them here whenever you like."
            : <>Your photos are measured on this device and nothing is saved. <button type="button" className="text-button" onClick={() => setAuthPrompt({ reason: "Sign in to keep your mannequin." })}>Sign in</button> to keep your mannequin for next time.</>}
        </p>
      </div>
    );
  }

  return (
    <div className="mannequin">
      <div className="mannequin-stage">
        <canvas ref={canvasRef} aria-label="Your 3D mannequin. Drag to turn it." />
        <div className="mannequin-turn" role="group" aria-label="Turn the mannequin">
          {[["Front", 0], ["Side", 90], ["Back", 180]].map(([label, degrees]) => (
            <button
              type="button" key={label}
              onClick={() => {
                viewerRef.current?.focus("body");
                viewerRef.current?.turnTo(degrees);
              }}
            >
              {label}
            </button>
          ))}
          <button type="button" onClick={() => viewerRef.current?.focus("face")}>Face</button>
        </div>
        {(busy || preparing) && <p className="tryon-hint" role="status">{busy || preparing}</p>}
      </div>

      <div className="mannequin-side">
        {error && <p className="inline-error" role="alert">{error}</p>}

        {!product && <p className="measure-hint">Ask for a piece above, and it goes on your mannequin.</p>}
        {product && garment && !wearable && (
          <p className="measure-hint">Hats and eyewear aren't shown on the mannequin yet. Use the live camera for those.</p>
        )}

        {wearable && fit && (
          <div className="mannequin-fit">
            <span className="size-setting-label">Size</span>
            <div className="size-options" role="radiogroup" aria-label="Size to try">
              {sizes.map((entry) => (
                <button
                  type="button" key={entry.label} role="radio" aria-checked={size === entry.label}
                  className={`${size === entry.label ? "active" : ""} ${entry.label === fit.best ? "mine" : ""}`}
                  title={entry.inStock === false ? "Not in stock at the last check" : ""}
                  onClick={() => setPicked(entry.label)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className={`mannequin-verdict ${fit.verdict.replace(" ", "-")}`}>
              <strong>{VERDICT_WORDS[fit.verdict]}</strong> in size {fit.size}
              {fit.best !== fit.size ? <>. Your best size on the standard chart is <strong>{fit.best}</strong>.</> : ": your best size on the standard chart."}
            </p>
            <ul className="mannequin-parts">
              {fit.parts.map((part) => (
                <li key={part.part}>
                  <span>{part.part}</span>
                  <span>{VERDICT_WORDS[part.verdict]}</span>
                  <small>{part.easeCm >= 0 ? `${part.easeCm} cm of room` : `${-part.easeCm} cm too small`}</small>
                </li>
              ))}
            </ul>
            {sizes.find((entry) => entry.label === size)?.inStock === false && (
              <p className="measure-hint">Size {size} wasn't in stock at the last check.</p>
            )}
            <p className="mannequin-note">
              First-phase garment: its shape is a template fitted to your mannequin in this size, and its surface is the
              real product photo. The back is estimated from the front. Fit is against the standard Indian size chart,
              not this brand's own.
            </p>
          </div>
        )}

        <div className="mannequin-face">
          <span className="size-setting-label">Your face on the mannequin</span>
          <p className="measure-hint">
            {!face
              ? "I couldn't find your face in the front photo, so the mannequin has none."
              : body.face?.closeUp
                ? "From your close-up."
                : face.soft
                  ? "From your full-length photo, where your face is small, so it looks soft. A close-up gives a clear one."
                  : "From your front photo. A close-up gives the clearest one."}
            {face?.turned ? " Your head is turned in the photo, which skews it: look straight at the camera." : ""}
            {" "}The hair is only its colour, not its style.
          </p>
          <button type="button" className="ghost-light" onClick={() => faceInputRef.current?.click()} disabled={Boolean(busy)}>
            📷 {body.face?.closeUp ? "Use another face close-up" : "Add a face close-up"}
          </button>
          <input
            ref={faceInputRef}
            type="file"
            accept={ACCEPTED.join(",")}
            data-view="face-replace"
            hidden
            onChange={(event) => {
              replaceFace(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>

        <div className="mannequin-measures">
          <div className="mannequin-measures-head">
            <span className="size-setting-label">Your measurements (cm)</span>
            <div className="mannequin-section" role="radiogroup" aria-label="Figure">
              {Object.entries(SECTION_NAMES).map(([key, label]) => (
                <button
                  type="button" key={key} role="radio" aria-checked={body.section === key}
                  className={`occasion-option ${body.section === key ? "active" : ""}`}
                  onClick={() => persist({ ...body, section: key, guessed: "chosen" })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {body.guessed === "yes" && <p className="measure-hint">The figure was guessed from your front photo. Change it above if it's wrong.</p>}
          {body.guessed === "no" && <p className="measure-hint">I couldn't tell which figure to use from your photo, so it starts as a men's figure. Change it above if that's wrong.</p>}
          <div className="measure-grid">
            {MEASURES.map(([key, label]) => (
              <label className="measure-field" key={key}>
                <span>{label}</span>
                <input
                  type="number" step="0.5" defaultValue={body.measurements[key]}
                  key={`${key}-${body.measurements[key]}`}
                  onBlur={(event) => Number(event.target.value) !== body.measurements[key] && correct(key, event.target.value)}
                />
              </label>
            ))}
          </div>
          <ul className="scan-notes">
            {(body.notes || []).map((note) => <li key={note}>{note}</li>)}
          </ul>
          <button type="button" className="text-button danger" onClick={startOver}>
            {user && saved ? "Delete my mannequin and photos" : "Start again with new photos"}
          </button>
        </div>
      </div>
    </div>
  );
}
