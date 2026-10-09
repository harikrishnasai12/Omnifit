import { useEffect } from "react";
import { largeImage } from "../app/lookFeed";

const SLOT_NAMES = { top: "Top", layer: "Layer", bottom: "Bottom", one_piece: "Outfit", footwear: "Shoes", accessory: "Accessory" };

// "Shop the look": every piece of a look with its live price, sizes in stock,
// a link to the brand's store and Add to cart.
export default function ProductSheet({ look, formatPrice, onClose, onSignal, openCartPicker }) {
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!look) return null;

  return (
    <div className="sheet-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="product-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <div>
            <h2 id="sheet-title">{look.title}</h2>
            <p>
              {look.pieces.length} pieces · {formatPrice(look.total_price)} in all
            </p>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <ul className="sheet-pieces">
          {look.pieces.map((piece) => {
            const product = piece.product;
            return (
              <li key={product.id}>
                {product.image && <img src={largeImage(product.image, 360)} alt="" />}
                <div className="sheet-piece-info">
                  <span className="sheet-slot">{SLOT_NAMES[piece.slot] || piece.slot}</span>
                  <b>{product.title}</b>
                  <span className="sheet-store">
                    {product.store} · {formatPrice(product.price)}
                    {product.compare_at > product.price && <s> {formatPrice(product.compare_at)}</s>}
                  </span>
                  {product.sizes?.length > 0 && <span className="sheet-sizes">Sizes: {product.sizes.join(", ")}</span>}
                  <div className="sheet-buttons">
                    <button
                      type="button"
                      onClick={() => {
                        onSignal("cart", look, { product_id: product.id, price: product.price });
                        openCartPicker(product);
                      }}
                    >
                      Add to cart
                    </button>
                    <a
                      href={product.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => onSignal("product_tap", look, { product_id: product.id, price: product.price })}
                    >
                      View on {product.store} ↗
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="sheet-note">
          Prices and sizes were checked against the catalogue when this look was shown; Add to cart checks the store live.
          You buy on the brand's own store.
        </p>
      </div>
    </div>
  );
}
