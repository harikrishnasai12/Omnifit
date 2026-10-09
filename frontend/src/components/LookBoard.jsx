import { largeImage } from "../app/lookFeed";

// One of the stylist's looks as a board: a tile per piece with its real
// product photo. Pieces the user already has are shown apart from the ones
// to buy. The whole board opens the "Shop the look" sheet.
export default function LookBoard({ look, loading, budgeted, formatPrice, onShop }) {
  const toBuy = look.pieces.filter((piece) => piece.product);
  const total = toBuy.reduce((sum, piece) => sum + piece.product.price, 0);

  return (
    <div className="look-board">
      <ul className={`look-board-tiles n${Math.min(look.pieces.length, 6)}`}>
        {look.pieces.map((piece, index) => {
          const { product } = piece;
          const waiting = loading && piece.shoppable && !piece.kept;

          return (
            <li
              key={piece.slot}
              className={`board-tile ${piece.kept ? "kept" : ""} ${product ? "" : "no-photo"}`}
              style={{ animationDelay: `${index * 70}ms` }}
            >
              {product?.image ? (
                <img src={largeImage(product.image, 480)} alt={product.title} loading="lazy" referrerPolicy="no-referrer" />
              ) : waiting ? (
                <div className="skeleton board-tile-wait" aria-label="Finding this piece" />
              ) : (
                <p className="board-tile-name">{piece.name}</p>
              )}

              <div className="board-tile-caption">
                <span className="board-tile-slot">{piece.label}</span>
                {piece.kept ? (
                  <span className="kept-badge">
                    {piece.fromWardrobe ? "✓ From your wardrobe" : "✓ You're wearing this"}
                  </span>
                ) : product ? (
                  <span className="board-tile-price">
                    {product.store} · <strong>{formatPrice(product.price)}</strong>
                  </span>
                ) : (
                  !waiting && (
                    <span className="board-tile-price">
                      {budgeted && piece.sold ? "Nothing within your budget" : "Find it in the stores below"}
                    </span>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {toBuy.length > 0 && (
        <button type="button" className="shop-look board-shop" onClick={() => onShop({ ...look, pieces: toBuy, total_price: total })}>
          🛍 Shop the look
          <span>
            {toBuy.length} {toBuy.length === 1 ? "piece" : "pieces"} · {formatPrice(total)}
          </span>
        </button>
      )}
    </div>
  );
}
