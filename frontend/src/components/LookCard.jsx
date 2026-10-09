import { useRef, useState } from "react";
import { largeImage } from "../app/lookFeed";

const SLOT_NAMES = { top: "Top", layer: "Layer", bottom: "Bottom", one_piece: "Outfit", footwear: "Shoes", accessory: "Accessory" };

// One full-height look in the Home feed: a collage of its real products,
// why it's shown, and what you can do with it.
export default function LookCard({ look, formatPrice, onSignal, onShop, onNotMe, onSkip }) {
  const [loved, setLoved] = useState(false);
  const [saved, setSaved] = useState(false);
  const [why, setWhy] = useState(false);
  const [burst, setBurst] = useState(false);
  const lastTap = useRef(0);
  const pieces = (look.pieces || []).filter((piece) => piece.product?.image).slice(0, 4);

  const toggleLove = () => {
    onSignal(loved ? "unlove" : "love", look);
    setLoved(!loved);
  };

  // Double-tap the photos to love, like the apps people already know
  const onPhotoTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      if (!loved) {
        setLoved(true);
        onSignal("love", look);
      }
      setBurst(true);
      setTimeout(() => setBurst(false), 700);
    }
    lastTap.current = now;
  };

  const notMeOptions = [
    ...(look.styles || []).slice(0, 1).map((value) => ["style", value]),
    ...(look.colours || []).slice(0, 2).map((value) => ["colour", value]),
  ];

  return (
    <article className="look-card" data-look-id={look.id} aria-label={look.title}>
      <div className={`look-collage n${pieces.length}`} onClick={onPhotoTap} role="presentation">
        {pieces.map((piece) => (
          <img key={piece.product.id} src={largeImage(piece.product.image)} alt={piece.product.title} loading="lazy" />
        ))}
        {burst && <span className="love-burst" aria-hidden="true">♥</span>}
      </div>

      <div className="look-info">
        <button type="button" className="look-why" onClick={() => setWhy((value) => !value)} aria-expanded={why}>
          ✦ {look.reason || "Picked for you"} <span>Why?</span>
        </button>
        <h2>{look.title}</h2>
        <p className="look-meta">
          {formatPrice(look.total_price)} for {look.pieces.length} pieces
          {(look.styles || []).length > 0 && (
            <> · {look.styles.map((s) => s.charAt(0).toUpperCase() + s.slice(1).replace("-", " ")).join(" · ")}</>
          )}
        </p>
        {why && (
          <div className="look-why-panel" role="region" aria-label="Why am I seeing this?">
            <p>
              <b>Why am I seeing this?</b> {look.reason ? `${look.reason}.` : "It's a fresh look worth a try."} Your taste comes
              only from what you do in OmniFit: loves, saves, looks you spend time on and what you ask the stylist.
            </p>
            {notMeOptions.length > 0 && (
              <div className="not-me-row">
                <span>Not you?</span>
                {notMeOptions.map(([dimension, value]) => (
                  <button key={`${dimension}-${value}`} type="button" onClick={() => { onNotMe(dimension, value); setWhy(false); }}>
                    Less {value.replace("-", " ")}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button type="button" className="shop-look" onClick={() => onShop(look)}>
          🛍 Shop the look
          <span>{pieces.map((piece) => SLOT_NAMES[piece.slot] || piece.slot).join(" · ")}</span>
        </button>
      </div>

      <div className="look-actions">
        <button type="button" className={loved ? "on love" : ""} onClick={toggleLove} aria-pressed={loved} aria-label={loved ? "Unlove" : "Love"}>
          <span>{loved ? "♥" : "♡"}</span>Love
        </button>
        <button
          type="button"
          className={saved ? "on" : ""}
          onClick={() => {
            if (!saved) onSignal("save", look, { product_id: look.pieces[0]?.product?.id, price: look.pieces[0]?.product?.price });
            setSaved(true);
          }}
          aria-pressed={saved}
          aria-label="Save"
        >
          <span>{saved ? "★" : "☆"}</span>Save
        </button>
        <button type="button" onClick={() => onSkip(look)} aria-label="Not for me">
          <span>✕</span>Skip
        </button>
      </div>
    </article>
  );
}
