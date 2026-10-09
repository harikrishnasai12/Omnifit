import { useState } from "react";
import { useOmniFit } from "../app/context";

// Explore: search every partner store, start from what's trending, or read
// today's page written by the AI. The stylist works out the occasion,
// section and budget from the words.
export default function ExplorePage() {
  const { askStylist, renderTrends, renderForYou } = useOmniFit();
  const [query, setQuery] = useState("");

  return (
    <section className="explore">
      <div className="foryou-header">
        <span className="eyebrow">🧭 EXPLORE</span>
        <h1>Find anything, in every style</h1>
      </div>

      <form
        className="explore-search"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) {
            askStylist(query.trim());
          }
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try “linen shirts”, “Diwali kurta under ₹2,000”, “white sneakers”"
          aria-label="Search every partner store"
        />
        <button type="submit" className="send-button" aria-label="Search">➤</button>
      </form>

      {renderTrends()}

      {/* Today, written by the AI for you: weather, festivals, next buy */}
      {renderForYou()}
    </section>
  );
}
