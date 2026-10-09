import { largeImage } from "../app/lookFeed";

// The feed's non-look cards: your own event, a festival, a price drop on
// something you saved, and a trend. Each says why it's there. Countdowns are
// for the person's own dates and real festivals only (no sale timers).
export default function FeedSpecialCard({ card, formatPrice, askStylist, onProduct }) {
  if (card.type === "event") {
    return (
      <article className="feed-special event">
        <span className="special-kicker">📅 Your event</span>
        <p className="special-count">
          <b>{card.days_away}</b> {card.days_away === 1 ? "day" : "days"} to go
        </p>
        <h2>{card.name}</h2>
        <p className="special-sub">{card.label}</p>
        <button type="button" className="special-action" onClick={() => askStylist(`Outfit ideas for ${card.name}`)}>
          Plan my outfit with the stylist
        </button>
        <p className="special-why">✦ {card.reason}</p>
      </article>
    );
  }

  if (card.type === "festival") {
    return (
      <article className="feed-special festival">
        <span className="special-kicker">🪔 Festival</span>
        <p className="special-count">
          <b>{card.days_away}</b> {card.days_away === 1 ? "day" : "days"} away
        </p>
        <h2>{card.name}</h2>
        <p className="special-sub">{card.label}</p>
        <button type="button" className="special-action" onClick={() => askStylist(`What should I wear for ${card.name}?`)}>
          See {card.name} looks
        </button>
        <p className="special-why">✦ {card.reason}</p>
      </article>
    );
  }

  if (card.type === "price_drop") {
    const product = card.product;
    return (
      <article className="feed-special price-drop">
        <span className="special-kicker">↓ Price drop</span>
        {product.image && <img src={largeImage(product.image, 480)} alt={product.title} />}
        <h2>{product.title}</h2>
        <p className="special-sub">
          {product.store} · <b>{formatPrice(product.price)}</b> <s>{formatPrice(card.was)}</s>
        </p>
        <button type="button" className="special-action" onClick={() => onProduct(product)}>
          View it
        </button>
        <p className="special-why">✦ {card.reason}</p>
      </article>
    );
  }

  if (card.type === "trend") {
    return (
      <article className="feed-special trend">
        <span className="special-kicker">📈 Trending</span>
        <h2>{card.label}</h2>
        <p className="special-sub">Asked for by {card.people} people on OmniFit lately</p>
        <button type="button" className="special-action" onClick={() => askStylist(card.query)}>
          Show me
        </button>
        <p className="special-why">✦ {card.reason}</p>
      </article>
    );
  }

  return null;
}
