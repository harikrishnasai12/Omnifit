import { useEffect, useRef, useState } from "react";
import { API_BASE_URL, api } from "./api";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const SLOT_ORDER = ["top", "layer", "bottom", "one_piece", "footwear", "accessory"];

// "blue wide leg cargo jeans": the fit is skipped when the item already says it
const describe = (piece) => {
  const item = piece.item || "";
  const fit = piece.fit && !item.toLowerCase().includes(piece.fit.toLowerCase()) ? piece.fit : "";
  const pattern = ["solid", "plain", ""].includes((piece.pattern || "").toLowerCase()) ? "" : piece.pattern;
  return [piece.color, pattern, fit, item].filter(Boolean).join(" ");
};

// When one photo shows a whole outfit, show the part where this piece sits
const SLOT_FOCUS = {
  top: "center 20%",
  layer: "center 20%",
  bottom: "center 70%",
  one_piece: "center 40%",
  footwear: "center 100%",
  accessory: "center 30%",
};

// My Wardrobe: clothes the user owns, outfits built from them, and the
// missing piece that would add the most new looks
function Wardrobe({ user, regionCode, coords, renderProduct }) {
  const [items, setItems] = useState([]);
  const [slotLabels, setSlotLabels] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [addedMessage, setAddedMessage] = useState("");

  const [occasion, setOccasion] = useState("");
  const [plan, setPlan] = useState(null); // { status, outfits, missing, error }

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api("/api/wardrobe")
      .then((data) => {
        if (!cancelled) {
          setItems(data.items);
          setSlotLabels(data.slots || {});
        }
      })
      .catch((error) => !cancelled && setLoadError(error.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const addPhoto = async (file) => {
    if (!file) {
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setAddError("Please use a JPG, PNG or WEBP photo.");
      return;
    }

    const form = new FormData();
    form.append("image", file);
    setAdding(true);
    setAddError("");
    setAddedMessage("");

    try {
      const data = await api("/api/wardrobe", { method: "POST", form });
      setItems((current) => [...data.added, ...current]);
      setAddedMessage(`Added ${data.added.map(describe).join(", ")}`);
      setPlan(null);
    } catch (error) {
      setAddError(error.message);
    } finally {
      setAdding(false);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Remove "${describe(item)}" from your wardrobe?`)) {
      return;
    }
    try {
      await api(`/api/wardrobe/${item.id}`, { method: "DELETE" });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setPlan(null);
    } catch (error) {
      setAddError(error.message);
    }
  };

  const buildOutfits = async () => {
    setPlan({ status: "loading" });
    try {
      const data = await api("/api/wardrobe/outfits", {
        method: "POST",
        json: {
          occasion: occasion.trim(),
          region: regionCode || "IN",
          latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
        },
      });
      setPlan({ status: "ready", outfits: data.outfits, missing: data.missing });
    } catch (error) {
      setPlan({ status: "error", error: error.message });
    }
  };

  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  const groups = SLOT_ORDER
    .map((slot) => ({ slot, pieces: items.filter((item) => item.slot === slot) }))
    .filter((group) => group.pieces.length);

  const thumb = (item, size = "") =>
    item?.has_image ? (
      <img
        className={`wardrobe-thumb ${size}`}
        src={`${API_BASE_URL}/api/wardrobe/${item.id}/image`}
        style={{ objectPosition: SLOT_FOCUS[item.slot] || "center" }}
        alt=""
        loading="lazy"
      />
    ) : (
      <span className={`wardrobe-thumb empty ${size}`}>👕</span>
    );

  return (
    <section className="library wardrobe">

      <div className="library-header">
        <div>
          <span className="result-label">MY WARDROBE</span>
          <h2>Wear what you own, buy what adds the most</h2>
          <p>
            Photograph clothes you already have. OmniFit builds outfits from them, avoids
            suggesting near-copies, and tells you the one piece that unlocks the most new looks.
          </p>
        </div>
      </div>

      {/* ADD CLOTHES */}

      <div className="panel wardrobe-add">
        <div className="panel-heading">
          <span className="step">+</span>
          <div>
            <h2>Add clothes</h2>
            <p>One garment per photo works best: laid flat or on a hanger, in good light</p>
          </div>
        </div>

        <div className="wardrobe-add-actions">
          <button
            type="button"
            className="primary-button"
            disabled={adding}
            onClick={() => cameraInputRef.current?.click()}
          >
            {adding ? <><span className="spinner" /> Tagging your clothes…</> : "📷 Take a photo"}
          </button>
          <button
            type="button"
            className="ghost-light"
            disabled={adding}
            onClick={() => fileInputRef.current?.click()}
          >
            🖼️ Choose photo
          </button>
        </div>

        {/* capture opens the rear camera on phones; on computers it's a file picker */}
        <input
          ref={cameraInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          capture="environment"
          hidden
          onChange={(event) => {
            addPhoto(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          hidden
          onChange={(event) => {
            addPhoto(event.target.files?.[0]);
            event.target.value = "";
          }}
        />

        {addError && <p className="inline-error" role="alert">{addError}</p>}
        {addedMessage && !addError && <p className="save-success" role="status">✓ {addedMessage}</p>}
      </div>

      {/* OUTFITS FROM MY WARDROBE */}

      {items.length >= 2 && (
        <div className="panel wardrobe-plan">
          <div className="panel-heading">
            <span className="step">✨</span>
            <div>
              <h2>Outfits from my wardrobe</h2>
              <p>Looks made only from your clothes, plus the best next buy</p>
            </div>
          </div>

          <div className="wardrobe-plan-form">
            <input
              type="text"
              className="wardrobe-occasion"
              placeholder="Occasion (optional): office, college, a wedding…"
              maxLength={120}
              value={occasion}
              onChange={(event) => setOccasion(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && buildOutfits()}
            />
            <button
              type="button"
              className="primary-button"
              onClick={buildOutfits}
              disabled={plan?.status === "loading"}
            >
              {plan?.status === "loading" ? <><span className="spinner" /> Styling…</> : "Build outfits"}
            </button>
          </div>

          {plan?.status === "error" && <p className="inline-error">{plan.error}</p>}

          {plan?.status === "ready" && (
            <>
              {plan.outfits.length ? (
                <div className="wardrobe-outfits">
                  {plan.outfits.map((outfit, index) => (
                    <article className="wardrobe-outfit" key={`${outfit.title}-${index}`}>
                      <h3>{outfit.title}</h3>
                      <div className="wardrobe-outfit-pieces">
                        {outfit.piece_ids.map((id) => byId[id] && (
                          <figure key={id}>
                            {thumb(byId[id], "small")}
                            <figcaption>{describe(byId[id])}</figcaption>
                          </figure>
                        ))}
                      </div>
                      {outfit.reason && <p className="outfit-reason"><span>💡</span>{outfit.reason}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="no-products">
                  Your wardrobe can't make a complete outfit yet. The pieces below would change that.
                </p>
              )}

              {plan.missing.length > 0 && (
                <div className="wardrobe-missing">
                  <h3>🛍️ Your best next buys</h3>
                  {plan.missing.map((piece) => (
                    <div className="wardrobe-missing-piece" key={piece.search_query}>
                      <div className="wardrobe-missing-head">
                        <strong>{piece.color} {piece.item}</strong>
                        <span className="unlocks-badge">+{piece.unlocks} new look{piece.unlocks === 1 ? "" : "s"}</span>
                      </div>
                      {piece.reason && <p>{piece.reason}</p>}
                      {piece.products?.length ? (
                        <div className="product-list compact">
                          {piece.products.slice(0, 3).map((product) => renderProduct(product))}
                        </div>
                      ) : (
                        <p className="no-products">No partner-brand match yet. Try a store search for “{piece.search_query}”.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* THE WARDROBE */}

      {loading && <p className="cart-status"><span className="spinner dark small" /> Loading your wardrobe…</p>}
      {loadError && <p className="inline-error">{loadError}</p>}

      {!loading && !items.length && !loadError && (
        <p className="library-empty">
          Your wardrobe is empty. Add a few tops, bottoms and shoes to start building outfits from what you own.
        </p>
      )}

      {groups.map((group) => (
        <div className="wardrobe-group" key={group.slot}>
          <h3>
            {slotLabels[group.slot] || group.slot} <small>{group.pieces.length}</small>
          </h3>
          <div className="wardrobe-grid">
            {group.pieces.map((item) => (
              <article className="wardrobe-card" key={item.id}>
                {thumb(item)}
                <div className="wardrobe-card-body">
                  <span className="wardrobe-card-name">{describe(item)}</span>
                  <button type="button" className="text-button danger" onClick={() => remove(item)}>
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export default Wardrobe;
