import { fitNote } from "../sizing";
import { useOmniFit } from "../app/context";

// Add to cart: live price and sizes, then the store's own checkout
export default function CartDialog() {
  const { mySizes, cartPicker, setCartPicker, formatPrice, isMySize, goToCheckout } = useOmniFit();

  return (
    <>
      {cartPicker && (

        <div
          className="dialog-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setCartPicker(null);
            }
          }}
        >

          <div
            className="dialog cart-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-title"
          >

            <div className="dialog-header">
              <div className="cart-product">
                {cartPicker.product.image && (
                  <img src={cartPicker.product.image} alt="" referrerPolicy="no-referrer" />
                )}
                <div>
                  <span className="product-store">{cartPicker.product.store}</span>
                  <h2 id="cart-title">{cartPicker.product.title}</h2>
                </div>
              </div>

              <button
                type="button"
                className="dialog-close"
                onClick={() => setCartPicker(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {cartPicker.status === "loading" && (
              <p className="cart-status">
                <span className="spinner dark small" /> Checking live stock at {cartPicker.product.store}…
              </p>
            )}

            {cartPicker.status === "error" && (
              <>
                <p className="inline-error">{cartPicker.error}</p>
                <a
                  className="primary-button"
                  href={cartPicker.product.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open product page ↗
                </a>
              </>
            )}

            {cartPicker.status === "ready" && (() => {
              const { data, product, size } = cartPicker;
              const priceChanged = data.price && Math.round(data.price) !== Math.round(product.price);

              if (!data.available) {
                return (
                  <p className="inline-error">
                    Sold out right now at {product.store}. Try another option.
                  </p>
                );
              }

              return (
                <>
                  <p className="cart-price">
                    <strong>{formatPrice(data.price)}</strong>
                    {data.compare_at && <s>{formatPrice(data.compare_at)}</s>}
                    <span className="live-badge">● Live price</span>
                  </p>

                  {priceChanged && (
                    <p className="pref-hint">
                      Price changed since our last update (was {formatPrice(product.price)}).
                    </p>
                  )}

                  {data.sizes.length > 1 || data.sizes[0]?.label !== "One size" ? (
                    <>
                      <span className="pref-label">Choose your size</span>
                      {fitNote(product.title) && (
                        <p className="fit-note">📏 {fitNote(product.title)}</p>
                      )}
                      <div className="size-options" role="radiogroup" aria-label="Size">
                        {data.sizes.map((entry) => (
                          <button
                            key={entry.label}
                            type="button"
                            role="radio"
                            aria-checked={size === entry.label}
                            disabled={!entry.available}
                            className={[
                              size === entry.label ? "active" : "",
                              isMySize(entry.label, product.size_kind) ? "mine" : "",
                            ].join(" ")}
                            onClick={() => setCartPicker({ ...cartPicker, size: entry.label })}
                            title={entry.available ? "" : "Sold out"}
                          >
                            {entry.label}
                          </button>
                        ))}
                      </div>
                      {!mySizes[product.size_kind] && product.size_kind && (
                        <p className="shortcut-hint">
                          OmniFit remembers the size you buy and picks it for you next time.
                        </p>
                      )}
                    </>
                  ) : null}

                  <button
                    type="button"
                    className="primary-button"
                    disabled={!size}
                    onClick={goToCheckout}
                  >
                    {!size
                      ? "Choose a size"
                      : size === "One size"
                        ? `Buy at ${product.store} →`
                        : `Buy size ${size} at ${product.store} →`}
                  </button>

                  <p className="shortcut-hint">
                    Opens {product.store}'s own checkout with this item in your cart.
                    You pay on their site; OmniFit never sees your payment details.
                  </p>
                </>
              );
            })()}

          </div>

        </div>

      )}
    </>
  );
}
