import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "../api";
import { useOmniFit } from "../app/context";
import { largeImage } from "../app/lookFeed";
import { sendToTryOn } from "../tryon/handoff";
import "./Social.css";

// Community: the social style layer. Every account is simply a user who can
// follow others, publish outfits made of real catalogue products, save other
// people's outfits, get their products and adapt them with the stylist.
//
// Its screens live in the address bar, so Back works and links can be shared:
//   #community          discover people and outfits
//   #community/u/<id>   a person's public profile   (#community/me: your own)
//   #community/o/<id>   one outfit
//   #community/new      publish an outfit

const CATEGORY_NAMES = {
  top: "Top", layer: "Layer", bottom: "Bottom", one_piece: "Outfit", footwear: "Shoes", accessories: "Accessory",
};
const ADAPT_IDEAS = ["Make it cheaper", "Change the shoes", "Make it traditional", "Make it casual", "Keep everything except the shirt"];
const SIGN_IN_REASON = "Sign in to follow people and share outfits.";

const go = (path = "") => {
  window.location.hash = path ? `community/${path}` : "community";
  window.scrollTo({ top: 0 });
};

const subscribeToHash = (onChange) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

// What an adapted outfit couldn't do, shown once on the new outfit's page
const adaptNotes = new Map();

// Loads one thing from the API; `reload` fetches it again
const useLoaded = (path) => {
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api(path)
      .then((data) => !cancelled && setState({ status: "ready", data, error: "" }))
      .catch((error) => !cancelled && setState({ status: "error", data: null, error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  return { ...state, reload: () => setVersion((value) => value + 1), setData: (data) => setState({ status: "ready", data, error: "" }) };
};

function Loading({ state }) {
  if (state.status === "loading") return <p className="measure-hint">Loading…</p>;
  if (state.status === "error") return <p className="inline-error" role="alert">{state.error}</p>;
  return null;
}

function PersonLink({ person }) {
  return (
    <button type="button" className="social-person" onClick={(event) => { event.stopPropagation(); go(`u/${person.id}`); }}>
      <span className="social-avatar" aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span>
      {person.name}
    </button>
  );
}

function OutfitCard({ outfit, formatPrice }) {
  const photos = outfit.items.filter((item) => item.product?.image).slice(0, 4);
  return (
    <article className="outfit-card" data-outfit-id={outfit.id}>
      <button type="button" className={`outfit-collage n${photos.length}`} onClick={() => go(`o/${outfit.id}`)} aria-label={`Open ${outfit.title}`}>
        {photos.map((item) => (
          <img key={item.product_id} src={item.product.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ))}
      </button>
      <div className="outfit-card-info">
        <b>{outfit.title}</b>
        <span>
          {outfit.items.length} pieces · {formatPrice(outfit.total_price)}
          {outfit.visibility === "private" && <em> · Private</em>}
        </span>
        {outfit.is_adapted && <span className="outfit-inspired">✦ Inspired by{outfit.inspired_by ? ` ${outfit.inspired_by.owner.name}` : " another look"}</span>}
        <PersonLink person={outfit.owner} />
      </div>
    </article>
  );
}

function OutfitGrid({ outfits, formatPrice, empty }) {
  if (!outfits.length) return <p className="measure-hint">{empty}</p>;
  return (
    <div className="outfit-grid">
      {outfits.map((outfit) => <OutfitCard key={outfit.id} outfit={outfit} formatPrice={formatPrice} />)}
    </div>
  );
}

function FollowButton({ personId, following, onChange }) {
  const { user, setAuthPrompt } = useOmniFit();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (!user) {
      setAuthPrompt({ reason: SIGN_IN_REASON });
      return;
    }
    setBusy(true);
    try {
      onChange(await api(`/api/social/users/${personId}/follow`, { method: following ? "DELETE" : "POST" }));
    } catch {
      // The button keeps its state; pressing again retries
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={`follow-button ${following ? "on" : ""}`} onClick={toggle} disabled={busy} aria-pressed={following}>
      {following ? "Following" : "Follow"}
    </button>
  );
}

// ---------- Discover: people and outfits ----------

function Discover() {
  const { user, formatPrice, setAuthPrompt } = useOmniFit();
  // Signing in or out changes what is shown: load again
  const state = useLoaded(`/api/social/discover?as=${user?.id || "guest"}`);
  const data = state.data;

  return (
    <>
      <div className="social-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => (user ? go("new") : setAuthPrompt({ reason: SIGN_IN_REASON }))}
        >
          ＋ Share an outfit
        </button>
        {user && <button type="button" className="style-button" onClick={() => go("me")}>My outfits</button>}
      </div>

      <Loading state={state} />

      {data && (
        <>
          {data.users.length > 0 && (
            <section className="social-section" aria-label="People to discover">
              <h2>People to discover</h2>
              <ul className="social-people">
                {data.users.map((person) => (
                  <li key={person.id}>
                    <PersonLink person={person} />
                    <small>{person.outfits} outfit{person.outfits === 1 ? "" : "s"} · {person.followers} follower{person.followers === 1 ? "" : "s"}</small>
                    <FollowButton personId={person.id} following={false} onChange={state.reload} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.following.length > 0 && (
            <section className="social-section" aria-label="From people you follow">
              <h2>From people you follow</h2>
              <OutfitGrid outfits={data.following} formatPrice={formatPrice} empty="" />
            </section>
          )}

          <section className="social-section" aria-label="Recent outfits">
            <h2>Recent outfits</h2>
            <OutfitGrid outfits={data.recent} formatPrice={formatPrice} empty="No one has shared an outfit yet. Be the first." />
          </section>
        </>
      )}
    </>
  );
}

// ---------- A person's profile (or your own) ----------

function Profile({ personId }) {
  const { user, formatPrice, renderClosetSignIn } = useOmniFit();
  const mine = personId === "me";
  const state = useLoaded(mine ? `/api/social/me?as=${user?.id || ""}` : `/api/social/users/${personId}?as=${user?.id || "guest"}`);
  const data = state.data;

  if (mine && !user) return renderClosetSignIn();

  return (
    <>
      <button type="button" className="social-back" onClick={() => go()}>← Community</button>
      <Loading state={state} />
      {data && (
        <>
          <header className="social-profile">
            <span className="social-avatar large" aria-hidden="true">{data.user.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <h1>{data.user.name}</h1>
              <p>
                <b>{data.followers}</b> follower{data.followers === 1 ? "" : "s"} · <b>{data.following}</b> following · <b>{data.outfits.length}</b> outfit{data.outfits.length === 1 ? "" : "s"}
              </p>
            </div>
            {data.is_me ? (
              <button type="button" className="primary-button" onClick={() => go("new")}>＋ Share an outfit</button>
            ) : (
              <FollowButton personId={data.user.id} following={data.is_following} onChange={(next) => state.setData({ ...data, ...next })} />
            )}
          </header>

          <section className="social-section" aria-label="Outfits">
            <h2>{data.is_me ? "Your outfits" : "Public outfits"}</h2>
            <OutfitGrid
              outfits={data.outfits}
              formatPrice={formatPrice}
              empty={data.is_me ? "You haven't shared an outfit yet." : "No public outfits yet."}
            />
          </section>

          {mine && (
            <section className="social-section" aria-label="Saved outfits">
              <h2>Saved outfits</h2>
              <OutfitGrid outfits={data.saved} formatPrice={formatPrice} empty="Outfits you save from other people appear here." />
            </section>
          )}
        </>
      )}
    </>
  );
}

// ---------- One outfit: Save, Get This Look, Adapt This Look, Try This Look ----------

function Outfit({ outfitId }) {
  const { user, formatPrice, regionCode, renderProductCard, setAuthPrompt, openView } = useOmniFit();
  const state = useLoaded(`/api/social/outfits/${outfitId}?as=${user?.id || "guest"}`);
  const outfit = state.data?.outfit;
  const [look, setLook] = useState({ status: "idle", pieces: [], total: 0, error: "" });
  const [adapting, setAdapting] = useState(false);
  const [wish, setWish] = useState("");
  const [adapt, setAdapt] = useState({ status: "idle", error: "" });
  const [notes] = useState(() => adaptNotes.get(outfitId) || null);

  const signedIn = () => {
    if (!user) setAuthPrompt({ reason: SIGN_IN_REASON });
    return Boolean(user);
  };
  const change = (next) => state.setData({ outfit: { ...outfit, ...next } });

  const toggleSave = async () => {
    if (!signedIn()) return;
    try {
      const result = await api(`/api/social/outfits/${outfit.id}/save`, { method: outfit.saved ? "DELETE" : "POST" });
      change({ saved: result.saved, saves: Math.max(0, outfit.saves + (result.saved ? 1 : -1) * (result.already_saved ? 0 : 1)) });
    } catch (error) {
      setLook({ ...look, error: error.message });
    }
  };

  const getLook = async () => {
    setLook({ status: "loading", pieces: [], total: 0, error: "" });
    try {
      const data = await api(`/api/social/outfits/${outfit.id}/look?region=${regionCode || "IN"}`);
      setLook({ status: "ready", pieces: data.pieces, total: data.total_price, error: "" });
    } catch (error) {
      setLook({ status: "idle", pieces: [], total: 0, error: error.message });
    }
  };

  const adaptLook = async (request) => {
    if (!signedIn() || !request.trim() || adapt.status === "working") return;
    setAdapt({ status: "working", error: "" });
    try {
      const data = await api(`/api/social/outfits/${outfit.id}/adapt`, { method: "POST", json: { request: request.trim(), region: regionCode || "IN" } });
      adaptNotes.set(data.derived_outfit_id, { request: request.trim(), summary: data.summary, notes: data.notes });
      go(`o/${data.derived_outfit_id}`);
    } catch (error) {
      setAdapt({ status: "idle", error: error.message });
    }
  };

  // Clothes worn on the body go to the existing Try-On page, the outfit's pieces to pick from
  const wearable = (outfit?.items || [])
    .filter((item) => item.available && item.product?.image && ["top", "bottom"].includes(item.product.size_kind))
    .map((item) => item.product);

  const setVisibility = async (visibility) => {
    const data = await api(`/api/social/outfits/${outfit.id}`, { method: "PATCH", json: { visibility } }).catch(() => null);
    if (data) state.setData(data);
  };
  const remove = async () => {
    if (!window.confirm("Delete this outfit?")) return;
    await api(`/api/social/outfits/${outfit.id}`, { method: "DELETE" }).catch(() => null);
    go("me");
  };

  return (
    <>
      <button type="button" className="social-back" onClick={() => window.history.length > 1 ? window.history.back() : go()}>← Back</button>
      <Loading state={state} />
      {outfit && (
        <article className="outfit-page" data-outfit-id={outfit.id}>
          <div className={`outfit-collage large n${Math.min(4, outfit.items.filter((item) => item.product?.image).length)}`}>
            {outfit.items.filter((item) => item.product?.image).slice(0, 4).map((item) => (
              <img key={item.product_id} src={largeImage(item.product.image)} alt={item.product.title} referrerPolicy="no-referrer" />
            ))}
          </div>

          <div className="outfit-detail">
            <h1>{outfit.title}</h1>
            <PersonLink person={outfit.owner} />
            {outfit.is_adapted && (
              <p className="outfit-inspired">
                ✦ Inspired by{" "}
                {outfit.inspired_by ? (
                  <button type="button" onClick={() => go(`o/${outfit.inspired_by.id}`)}>
                    {outfit.inspired_by.title} by {outfit.inspired_by.owner.name}
                  </button>
                ) : "a look that is no longer public"}
              </p>
            )}
            {outfit.description && <p>{outfit.description}</p>}
            {outfit.tags.length > 0 && (
              <p className="outfit-tags">{outfit.tags.map((tag) => <span key={tag}>#{tag}</span>)}</p>
            )}
            <p className="measure-hint">
              {outfit.items.length} pieces · {formatPrice(outfit.total_price)} for those in stock
              {outfit.visibility === "private" ? " · Private: only you can see it" : ` · Saved by ${outfit.saves}`}
            </p>

            {notes && (
              <div className="outfit-notes" role="status">
                <b>Adapted: “{notes.request}”</b>
                {notes.summary && <p>{notes.summary}</p>}
                {notes.notes.map((note) => <p key={note}>{note}</p>)}
                <p>Every product here was found in the catalogue. The original outfit is unchanged.</p>
              </div>
            )}

            <div className="outfit-actions">
              {!outfit.is_mine && (
                <button type="button" className={`style-button ${outfit.saved ? "active" : ""}`} onClick={toggleSave} aria-pressed={outfit.saved}>
                  {outfit.saved ? "★ Saved" : "☆ Save"}
                </button>
              )}
              <button type="button" className="primary-button" onClick={getLook} disabled={look.status === "loading"}>
                {look.status === "loading" ? "Checking stock…" : "🛍 Get This Look"}
              </button>
              <button type="button" className="style-button" onClick={() => signedIn() && setAdapting(!adapting)} aria-expanded={adapting}>
                ✦ Adapt This Look
              </button>
              <button
                type="button"
                className="style-button"
                disabled={!wearable.length}
                title={wearable.length ? "" : "Nothing in this outfit can be tried on"}
                onClick={() => {
                  sendToTryOn(wearable);
                  openView("tryon");
                }}
              >
                🪞 Try This Look
              </button>
            </div>

            {outfit.is_mine && (
              <div className="outfit-actions owner">
                <button type="button" className="style-button" onClick={() => setVisibility(outfit.visibility === "public" ? "private" : "public")}>
                  {outfit.visibility === "public" ? "Make private" : "Publish: make public"}
                </button>
                <button type="button" className="style-button" onClick={remove}>Delete</button>
              </div>
            )}

            {adapting && (
              <form className="outfit-adapt" onSubmit={(event) => { event.preventDefault(); adaptLook(wish); }}>
                <label htmlFor="adapt-wish">What should change? The stylist keeps the rest.</label>
                <div className="explore-search">
                  <input id="adapt-wish" value={wish} onChange={(event) => setWish(event.target.value)} maxLength={200} placeholder="Make it cheaper" />
                  <button type="submit" className="primary-button" disabled={adapt.status === "working" || wish.trim().length < 2}>
                    {adapt.status === "working" ? "Adapting…" : "Adapt"}
                  </button>
                </div>
                <div className="adapt-ideas">
                  {ADAPT_IDEAS.map((idea) => (
                    <button key={idea} type="button" disabled={adapt.status === "working"} onClick={() => { setWish(idea); adaptLook(idea); }}>
                      {idea}
                    </button>
                  ))}
                </div>
                {adapt.status === "working" && (
                  <p className="measure-hint" role="status">The stylist is planning the change and finding real products. This can take up to a minute.</p>
                )}
                {adapt.error && <p className="inline-error" role="alert">{adapt.error}</p>}
              </form>
            )}

            {look.error && <p className="inline-error" role="alert">{look.error}</p>}
          </div>

          {look.status === "ready" && (
            <section className="outfit-look" aria-label="Get This Look">
              <h2>Get This Look · {formatPrice(look.total)} in stock now</h2>
              <ul>
                {look.pieces.map((piece) => (
                  <li key={piece.product_id} className={piece.available ? "" : "sold-out"}>
                    <span className="sheet-slot">{CATEGORY_NAMES[piece.category] || piece.category}</span>
                    {piece.available ? (
                      <div className="product-list grid browse-grid">{renderProductCard(piece.product, "grid")}</div>
                    ) : (
                      <>
                        <p className="measure-hint">
                          {piece.product ? `${piece.product.title} has sold out.` : "This product is no longer sold."}
                          {piece.alternatives.length ? " Similar, in stock:" : " Nothing similar is in stock right now."}
                        </p>
                        <div className="product-list grid browse-grid">
                          {piece.alternatives.map((product) => renderProductCard(product, "grid"))}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <p className="measure-hint">Prices and sizes are the catalogue's, from its last sync with each store. You buy on the brand's own store.</p>
            </section>
          )}
        </article>
      )}
    </>
  );
}

// ---------- Publish: pick real products, arrange them, title and tags ----------

function Compose() {
  const { user, formatPrice, regionCode, renderClosetSignIn } = useOmniFit();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ status: "idle", products: [], message: "" });
  const [chosen, setChosen] = useState([]);
  const [form, setForm] = useState({ title: "", description: "", tags: "", visibility: "public" });
  const [publish, setPublish] = useState({ status: "idle", error: "" });

  if (!user) return renderClosetSignIn();

  const find = async (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearch({ status: "loading", products: [], message: "" });
    try {
      // colour "all": a plain catalogue search, not kept in the search history
      const data = await api("/api/browse", { method: "POST", json: { question: query.trim(), region: regionCode || "IN", personalize: false, colour: "all" } });
      const products = (data.products || []).filter((product) => product.id && product.image);
      setSearch({
        status: "ready",
        products,
        message: data.browse === false
          ? "Search for one item at a time, like “white sneakers” or “linen shirt men”."
          : products.length ? "" : "Nothing in the catalogue matched. Try other words.",
      });
    } catch (error) {
      setSearch({ status: "ready", products: [], message: error.message });
    }
  };

  const add = (product) => setChosen((list) => (list.some((item) => item.id === product.id) || list.length >= 8 ? list : [...list, product]));
  const move = (index, by) => setChosen((list) => {
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    return next;
  });

  const submit = async (event) => {
    event.preventDefault();
    setPublish({ status: "working", error: "" });
    try {
      const data = await api("/api/social/outfits", {
        method: "POST",
        json: {
          title: form.title.trim(),
          description: form.description.trim(),
          tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 5),
          visibility: form.visibility,
          items: chosen.map((product) => ({ product_id: product.id })),
        },
      });
      go(`o/${data.outfit.id}`);
    } catch (error) {
      setPublish({ status: "idle", error: error.message });
    }
  };

  return (
    <>
      <button type="button" className="social-back" onClick={() => go()}>← Community</button>
      <div className="compose">
        <section className="social-section" aria-label="Pick products">
          <h2>1. Pick real products</h2>
          <form className="explore-search" onSubmit={find}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the catalogue: “linen shirt men”" aria-label="Search the catalogue" />
            <button type="submit" className="primary-button" disabled={search.status === "loading"}>
              {search.status === "loading" ? "Searching…" : "Search"}
            </button>
          </form>
          {search.message && <p className="measure-hint">{search.message}</p>}
          <div className="compose-results">
            {search.products.map((product) => {
              const picked = chosen.some((item) => item.id === product.id);
              return (
                <button key={product.id} type="button" className={`compose-product ${picked ? "picked" : ""}`} onClick={() => add(product)} disabled={picked}>
                  <img src={product.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  <b>{product.title}</b>
                  <span>{product.store} · {formatPrice(product.price)}</span>
                  <em>{picked ? "✓ Added" : "＋ Add"}</em>
                </button>
              );
            })}
          </div>
        </section>

        <form className="social-section compose-outfit" onSubmit={submit} aria-label="Your outfit">
          <h2>2. Arrange your outfit</h2>
          {chosen.length === 0 && <p className="measure-hint">Add 2 to 8 products. The first four make the cover.</p>}
          <ol className="compose-chosen">
            {chosen.map((product, index) => (
              <li key={product.id}>
                <img src={product.image} alt="" referrerPolicy="no-referrer" />
                <span>{product.title}<small>{formatPrice(product.price)}</small></span>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${product.title} up`}>↑</button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === chosen.length - 1} aria-label={`Move ${product.title} down`}>↓</button>
                <button type="button" onClick={() => setChosen((list) => list.filter((item) => item.id !== product.id))} aria-label={`Remove ${product.title}`}>✕</button>
              </li>
            ))}
          </ol>

          <h2>3. Title and tags</h2>
          <label className="compose-field">
            Title
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={80} required placeholder="Weekend basics" />
          </label>
          <label className="compose-field">
            Description (optional)
            <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={300} placeholder="Why it works" />
          </label>
          <label className="compose-field">
            Tags, separated by commas (optional)
            <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="casual, weekend" />
          </label>
          <div className="page-tabs compose-visibility" role="radiogroup" aria-label="Who can see it">
            {[["public", "🌍 Public"], ["private", "🔒 Private"]].map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={form.visibility === value} className={form.visibility === value ? "active" : ""} onClick={() => setForm({ ...form, visibility: value })}>
                {label}
              </button>
            ))}
          </div>
          <p className="measure-hint">
            {form.visibility === "public"
              ? "Public: anyone can see this outfit and your name. Nothing else about you is shown."
              : "Private: only you can see it."}
          </p>
          {publish.error && <p className="inline-error" role="alert">{publish.error}</p>}
          <button type="submit" className="primary-button" disabled={chosen.length < 2 || !form.title.trim() || publish.status === "working"}>
            {publish.status === "working" ? "Publishing…" : form.visibility === "public" ? "Publish outfit" : "Save outfit"}
          </button>
        </form>
      </div>
    </>
  );
}

export default function SocialPage() {
  const { openView } = useOmniFit();
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash);
  const [, screen = "", id = ""] = hash.replace(/^#/, "").split("/");

  return (
    <section className="explore social">
      <div className="page-tabs" role="tablist" aria-label="Explore">
        <button type="button" role="tab" aria-selected={false} onClick={() => openView("explore")}>🧭 Shop</button>
        <button type="button" role="tab" aria-selected className="active" onClick={() => go()}>👥 Community</button>
      </div>

      {screen === "" && (
        <div className="foryou-header">
          <span className="eyebrow">👥 COMMUNITY</span>
          <h1>Outfits from real people, in real products</h1>
        </div>
      )}

      {screen === "u" && id ? <Profile key={id} personId={id} />
        : screen === "me" ? <Profile key="me" personId="me" />
        : screen === "o" && id ? <Outfit key={id} outfitId={id} />
        : screen === "new" ? <Compose />
        : <Discover />}
    </section>
  );
}
