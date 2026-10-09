import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useOmniFit } from "../app/context";
import { DWELL_MIN_MS, guestNotMe, useLookFeed } from "../app/lookFeed";
import AskBar from "../components/AskBar";
import FeedSpecialCard from "../components/FeedSpecialCard";
import LookCard from "../components/LookCard";
import ProductSheet from "../components/ProductSheet";

const VISIBLE = 0.6;

// Home: the look feed. One look at a time, full height, ranked for you with
// the reason on every card. Scrolling needs no AI call: looks are built ahead
// of time and only ranked when you open the feed.
export default function HomePage() {
  const { user, personalizeOn, department, ageGroup, regionCode, coords, formatPrice, askStylist, openCartPicker, openView } =
    useOmniFit();
  const feed = useLookFeed({
    active: Boolean(regionCode),
    signedIn: Boolean(user),
    personalizeOn,
    section: department,
    ageGroup,
    region: regionCode || "IN",
    coords,
  });
  const { signal, loadMore } = feed;
  const [shopping, setShopping] = useState(null);
  const [hidden, setHidden] = useState(() => new Set());
  const [toast, setToast] = useState("");
  const listRef = useRef(null);
  const seen = useRef(new Map());

  // Time on each card: a view when it's mostly on screen, "dwell" when it
  // stays there a while (only lingering counts as interest)
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const looks = new Map(feed.cards.filter((card) => card.type === "look").map((card) => [card.id, card]));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const look = looks.get(entry.target.dataset.lookId);
          if (!look) continue;
          if (entry.intersectionRatio >= VISIBLE) {
            if (!seen.current.has(look.id)) signal("view", look);
            seen.current.set(look.id, { since: Date.now(), done: seen.current.get(look.id)?.done });
          } else if (seen.current.get(look.id)?.since) {
            const record = seen.current.get(look.id);
            const ms = Date.now() - record.since;
            if (ms >= DWELL_MIN_MS && !record.done) {
              signal("dwell", look, { value: ms });
              record.done = true;
            }
            record.since = null;
          }
        }
      },
      { root: list, threshold: [0, VISIBLE] }
    );
    list.querySelectorAll("[data-look-id]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [feed.cards, signal]);

  // Load the next page two cards before the end
  const onScroll = useCallback(() => {
    const list = listRef.current;
    if (list && list.scrollTop + list.clientHeight * 3 >= list.scrollHeight) loadMore();
  }, [loadMore]);

  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(""), 2600);
  };

  const skip = (look) => {
    signal("skip", look);
    setHidden((current) => new Set(current).add(look.id));
    flash("Got it: fewer looks like this");
  };

  const notMe = async (dimension, value) => {
    if (user) {
      try {
        await api("/api/me/profile", { method: "PATCH", json: { action: "not_me", dimension, value } });
      } catch {
        flash("Couldn't save that. Please try again.");
        return;
      }
    } else {
      guestNotMe(dimension, value);
    }
    flash(`Noted: less ${value.replace("-", " ")}. Your next looks will follow.`);
  };

  const cards = feed.cards.filter((card) => card.type !== "look" || !hidden.has(card.id));

  return (
    <section className="home-feed">
      <header className="feed-top">
        <div>
          <h1>For you</h1>
          <p>
            {feed.paused
              ? "Personalisation paused"
              : user
                ? "Ranked from what you love and ask for"
                : "Learns on this phone · nothing stored"}
          </p>
        </div>
        <button type="button" className="feed-refresh" onClick={feed.refresh} aria-label="Refresh the feed">
          ↻
        </button>
      </header>

      {/* The way in: a photo or a few words, straight to the stylist */}
      <AskBar hero placeholder="What are we dressing for today?" />

      <div className="look-feed" ref={listRef} onScroll={onScroll}>
        {cards.map((card, index) =>
          card.type === "look" ? (
            <LookCard
              key={card.id}
              look={card}
              formatPrice={formatPrice}
              onSignal={signal}
              onShop={(look) => {
                signal("product_tap", look, { product_id: look.pieces[0]?.product?.id });
                setShopping(look);
              }}
              onNotMe={notMe}
              onSkip={skip}
            />
          ) : (
            <FeedSpecialCard
              key={`${card.type}-${index}`}
              card={card}
              formatPrice={formatPrice}
              askStylist={askStylist}
              onProduct={openCartPicker}
            />
          )
        )}

        {feed.status === "loading" && (
          <div className="look-card skeleton-card" aria-label="Loading looks">
            <div className="shimmer" />
          </div>
        )}

        {feed.status === "error" && (
          <div className="feed-end">
            <p>{feed.error}</p>
            <button type="button" className="special-action" onClick={feed.refresh}>Try again</button>
          </div>
        )}

        {feed.caughtUp && feed.status === "ready" && (
          <div className="feed-end">
            <span className="feed-end-mark">✓</span>
            <h2>You're all caught up</h2>
            <p>New looks arrive every day. Want something specific right now?</p>
            <div className="feed-end-actions">
              <button type="button" className="special-action" onClick={() => openView("stylist")}>Ask the stylist</button>
              <button type="button" className="special-action ghost" onClick={() => openView("explore")}>Explore</button>
            </div>
          </div>
        )}
      </div>

      {toast && <p className="feed-toast" role="status">{toast}</p>}

      {shopping && (
        <ProductSheet
          look={shopping}
          formatPrice={formatPrice}
          onClose={() => setShopping(null)}
          onSignal={signal}
          openCartPicker={openCartPicker}
        />
      )}
    </section>
  );
}
