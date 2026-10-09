import { useOmniFit } from "../app/context";
import AskBar from "../components/AskBar";

// Explore: ask for anything, start from what's trending, or read today's page
// written by the AI. The stylist works out the occasion, section and budget
// from the words.
export default function ExplorePage() {
  const { renderTrends, renderForYou, openView } = useOmniFit();

  return (
    <section className="explore">
      {/* Community: outfits people have shared (pages/SocialPage.jsx) */}
      <div className="page-tabs" role="tablist" aria-label="Explore">
        <button type="button" role="tab" aria-selected className="active">🧭 Shop</button>
        <button type="button" role="tab" aria-selected={false} onClick={() => openView("community")}>👥 Community</button>
      </div>

      <div className="foryou-header">
        <span className="eyebrow">🧭 EXPLORE</span>
        <h1>Find anything, in every style</h1>
      </div>

      <AskBar placeholder="Try “linen shirts”, “Diwali kurta under ₹2,000”, or show a photo" />

      {renderTrends()}

      {/* Today, written by the AI for you: weather, festivals, next buy */}
      {renderForYou()}
    </section>
  );
}
