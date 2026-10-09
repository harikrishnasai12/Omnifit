import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useOmniFit } from "../app/context";
import { TRYON_PRODUCT_KEY } from "../tryon/handoff";
import "./TryOn.css";

// The 3D mannequin (and Three.js with it) loads only when it is opened
const MannequinTryOn = lazy(() => import("../avatar/MannequinTryOn"));

const CONSENT_KEY = "omnifit.tryon.consent";

const REGION_NAMES = { upper: "Upper body", lower: "Lower body", full: "Full outfit", head: "Head", face: "Face" };
// Hats and eyewear have no cut or length to describe
const ACCESSORY_REGIONS = ["head", "face"];

// Why the camera didn't start, by the browser's name for the failure
const CAMERA_PROBLEMS = {
  NotAllowedError: "The camera is blocked. Allow camera access for OmniFit in your browser, then try again.",
  NotFoundError: "No camera was found on this device.",
  NotReadableError: "Another app is using the camera. Close it (a video call, the Camera app), then try again.",
  OverconstrainedError: "This camera can't give the picture the try-on needs.",
};

// The products sent here from elsewhere (tryon/handoff.js): one, or an outfit's pieces
const readWaitingProducts = () => {
  try {
    const sent = JSON.parse(sessionStorage.getItem(TRYON_PRODUCT_KEY));
    return [sent].flat().filter((product) => product?.id);
  } catch {
    return [];
  }
};

const readConsent = () => {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
};

// Live Try-On. The flow:
//   ask -> Gemma understands -> matching products (best one selected)
//   -> product photo -> AI garment understanding -> live camera
//   -> body tracking -> the garment drawn on you, in real time.
// The camera, the tracking and the drawing all run on this device; a photo
// exists only if you take one, and is kept only if you save it.
export default function TryOnPage() {
  const { styleDnaForChat, regionCode, formatPrice, openCartPicker, setStyleScan, openBodyScan } = useOmniFit();

  const [query, setQuery] = useState("");
  const [finding, setFinding] = useState(false);
  const [understood, setUnderstood] = useState([]);
  const [sent] = useState(readWaitingProducts);
  const waiting = sent[0] || null;
  const [products, setProducts] = useState(sent);
  const [selected, setSelected] = useState(null); // { product, garment }
  const [preparing, setPreparing] = useState("");
  const [error, setError] = useState("");
  const [consented, setConsented] = useState(readConsent);
  const [live, setLive] = useState(false);
  const [hint, setHint] = useState("");
  const [shot, setShot] = useState(null); // { url } of a photo just taken

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const streamRef = useRef(null);
  const preparedRef = useRef(null); // { cut, garment } ready to draw
  const requestRef = useRef(0);
  // Where the product is tried: on the person's 3D mannequin, or the live camera
  const [mode, setMode] = useState("mannequin");
  // The product's cut-out, for the mannequin's garment
  const [cut, setCut] = useState(null);
  // The camera is opening: between the press and the first picture
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopCamera = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLive(false);
    setHint("");
  }, []);

  // Leaving the page turns the camera off
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    // A webcam takes a moment to open (longer with the browser's permission
    // prompt). A second press in that time must not start a second camera.
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError("");
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      // The page was left while the camera was opening
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setLive(true);
      // The <video> appears with `live`; wait for it before attaching
      for (let frames = 0; !videoRef.current && frames < 30; frames += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      const { startTryOn } = await import("../tryon/engine");
      const engine = await startTryOn({ video, canvas: canvasRef.current, onStatus: setHint });
      engineRef.current = engine;
      if (preparedRef.current) {
        engine.setGarment(preparedRef.current.cut, preparedRef.current.garment);
      }
    } catch (cameraError) {
      // The sentence shown is for the person; the cause is for whoever debugs it
      console.warn("Try-on camera didn't start:", cameraError?.name, cameraError?.message);
      stream?.getTracks().forEach((track) => track.stop());
      stopCamera();
      setError(CAMERA_PROBLEMS[cameraError?.name] || "The camera couldn't start on this device.");
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  // Steps 4-5: the product's photo, Gemma's reading of the garment, and its cut-out
  const chooseProduct = useCallback(async (product) => {
    const request = ++requestRef.current;
    setError("");
    setShot(null);
    setCut(null);
    setSelected({ product, garment: null });
    setPreparing("Understanding the garment…");
    try {
      const info = await api("/api/tryon/garment", { method: "POST", json: { product_id: product.id } });
      if (request !== requestRef.current) return;
      setSelected({ product, garment: info.garment });
      setPreparing("Preparing it to wear…");
      const { cutGarment } = await import("../tryon/garment");
      const cut = await cutGarment(info.photo, info.garment);
      if (request !== requestRef.current) return;
      if (!cut.ok) {
        throw new Error(cut.message);
      }
      preparedRef.current = { cut, garment: info.garment };
      setCut(cut);
      engineRef.current?.setGarment(cut, info.garment);
    } catch (prepareError) {
      if (request !== requestRef.current) return;
      preparedRef.current = null;
      setCut(null);
      engineRef.current?.setGarment(null, null);
      setError(prepareError.message || "Couldn't prepare this product for try-on.");
    } finally {
      if (request === requestRef.current) setPreparing("");
    }
  }, []);

  // Steps 1-3: the request, Gemma's understanding, the matching products
  const find = async (event) => {
    event.preventDefault();
    const message = query.trim();
    if (!message || finding) return;
    setFinding(true);
    setError("");
    setProducts([]);
    setUnderstood([]);
    try {
      const data = await api("/api/tryon/find", {
        method: "POST",
        json: { message, profile: styleDnaForChat(), region: regionCode || "IN" },
      });
      setUnderstood(data.understood || []);
      setProducts(data.products);
      if (data.products.length) {
        chooseProduct(data.products[0]);
      } else {
        setSelected(null);
        setError(`No partner brand has a match for “${data.search}”. Try describing it differently.`);
      }
    } catch (findError) {
      setError(findError.message);
    } finally {
      setFinding(false);
    }
  };

  // A product sent here by a "Try on" button elsewhere: prepare it straight away
  useEffect(() => {
    if (!waiting) return undefined;
    try {
      sessionStorage.removeItem(TRYON_PRODUCT_KEY);
    } catch {
      // Already gone
    }
    const timer = setTimeout(() => chooseProduct(waiting), 0);
    return () => clearTimeout(timer);
  }, [waiting, chooseProduct]);

  const agree = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      // Asked again next time
    }
    setConsented(true);
    startCamera();
  };

  const takePhoto = async () => {
    const blob = await engineRef.current?.snapshot();
    if (blob) {
      setShot({ url: URL.createObjectURL(blob) });
    }
  };

  const discardPhoto = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
  };

  const garment = selected?.garment;
  const ready = Boolean(garment) && !preparing && !error;

  return (
    <section className="tryon">
      <div className="foryou-header">
        <span className="eyebrow">🪞 LIVE TRY-ON</span>
        <h1>See it on you</h1>
        <p className="tryon-lede">Ask for a piece. The AI finds it, studies it, and puts it on your 3D mannequin or on you in the camera.</p>
      </div>

      <form className="explore-search" onSubmit={find}>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try “Show me the black formal jacket”"
          aria-label="What do you want to try on?"
        />
        <button type="submit" className="send-button" aria-label="Find it" disabled={finding || !query.trim()}>
          {finding ? <span className="spinner small" /> : "➤"}
        </button>
      </form>

      {understood.length > 0 && (
        <div className="understood-chips" aria-label="What I understood">
          {understood.map((chip) => <span key={chip}>{chip}</span>)}
        </div>
      )}

      {products.length > 0 && (
        <div className="tryon-products" role="listbox" aria-label="Matching products">
          {products.map((product) => (
            <button
              type="button"
              key={product.id}
              role="option"
              aria-selected={selected?.product.id === product.id}
              className={`tryon-product ${selected?.product.id === product.id ? "active" : ""}`}
              onClick={() => chooseProduct(product)}
            >
              <img src={product.image} alt="" loading="lazy" />
              <span>{product.store}</span>
              <strong>{formatPrice(product.price)}</strong>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="tryon-garment">
          <strong>{selected.product.title}</strong>
          {preparing && <p className="cart-status"><span className="spinner dark small" /> {preparing}</p>}
          {garment && (
            <div className="tryon-facts" aria-label="What the AI understood about this garment">
              <span className="tryon-region">{REGION_NAMES[garment.region]}</span>
              <span>{garment.garment}</span>
              <span>{garment.color}</span>
              {!ACCESSORY_REGIONS.includes(garment.region) && <span>{garment.shape} shape</span>}
              {garment.sleeves !== "none" && <span>{garment.sleeves} sleeves</span>}
              {garment.collar !== "none" && <span>{garment.collar}</span>}
              {!ACCESSORY_REGIONS.includes(garment.region) && <span>{garment.length} length</span>}
              <span>{garment.texture}</span>
              <span>{garment.view} view</span>
            </div>
          )}
        </div>
      )}

      {error && <p className="inline-error" role="alert">{error}</p>}

      <div className="page-tabs tryon-modes" role="tablist" aria-label="How to try it on">
        {[["mannequin", "🧍 My 3D mannequin"], ["live", "📷 Live camera"]].map(([key, label]) => (
          <button
            type="button" key={key} role="tab" aria-selected={mode === key} className={mode === key ? "active" : ""}
            onClick={() => {
              if (key !== "live") stopCamera();
              setMode(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "mannequin" && (
        <Suspense fallback={<p className="cart-status"><span className="spinner dark small" /> Loading the mannequin…</p>}>
          <MannequinTryOn product={selected?.product || null} garment={garment || null} cut={cut} preparing={preparing} />
        </Suspense>
      )}

      {mode === "live" && ready && !live && !consented && (
        <div className="tryon-consent">
          <ul className="scan-points">
            <li><span aria-hidden="true">📷</span> Your camera shows you with this piece drawn on, live.</li>
            <li><span aria-hidden="true">📱</span> <span>Everything happens on this device. No video or photo is sent anywhere.</span></li>
            <li><span aria-hidden="true">🗑️</span> <span>Nothing is saved unless you take a photo and choose to save it.</span></li>
            <li><span aria-hidden="true">🔞</span> <span>The live camera is for people aged 18 or older.</span></li>
          </ul>
          <button type="button" className="primary-button" onClick={agree}>
            I'm 18 or older and agree: open the camera
          </button>
        </div>
      )}

      {mode === "live" && ready && !live && consented && (
        <button type="button" className="primary-button tryon-open" onClick={startCamera} disabled={starting}>
          {starting ? <><span className="spinner" /> Starting the camera…</> : "📷 Open the camera and try it on"}
        </button>
      )}

      {mode === "live" && live && (
        <div className="tryon-live">
          <div className="tryon-stage">
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} aria-label="The garment drawn on you" />
            {(hint || preparing) && <p className="tryon-hint" role="status">{preparing || hint}</p>}
            {garment && <span className="tryon-badge">{REGION_NAMES[garment.region]} · {garment.garment}</span>}
          </div>
          <div className="tryon-controls">
            <button type="button" className="primary-button" onClick={takePhoto} disabled={!ready}>📸 Take a photo</button>
            {selected && (
              <button type="button" className="ghost-light" onClick={() => openCartPicker(selected.product)}>🛍 Shop this</button>
            )}
            <button type="button" className="ghost-light" onClick={stopCamera}>✕ Close camera</button>
          </div>
          <p className="measure-hint">A style preview of colour and look on you. It isn't a fit check.</p>
        </div>
      )}

      {shot && (
        <div className="tryon-shot">
          <img src={shot.url} alt="Your try-on photo" />
          <div className="tryon-controls">
            <a className="primary-button" href={shot.url} download="omnifit-try-on.jpg">Save to my device</a>
            <button type="button" className="ghost-light" onClick={discardPhoto}>Discard</button>
          </div>
          <p className="measure-hint">This photo exists only on this device until you save or discard it.</p>
        </div>
      )}

      <div className="tryon-more">
        <span className="size-setting-label">More camera tools</span>
        <div className="dna-actions">
          <button type="button" className="ghost-light" onClick={() => setStyleScan({ status: "consent" })}>✨ Style Scan</button>
          <button type="button" className="ghost-light" onClick={openBodyScan}>📏 Body Scan</button>
        </div>
      </div>
    </section>
  );
}
