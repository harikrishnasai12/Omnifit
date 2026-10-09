import { useEffect, useRef, useState } from "react";
import { API_BASE_URL, api } from "./api";

const PLATFORM_LABELS = {
  youtube: "▶ YouTube",
  pinterest: "📌 Pinterest",
};

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Pull the first web link out of shared text ("Check this out https://...")
const firstLink = (text) => (String(text || "").match(/https:\/\/\S+/) || [""])[0];

function StyleLibrary({ user, taste, onTasteChange, regionCode, renderProduct, sharedPayload, onSharedHandled, installPrompt, onInstall }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);

  // Shop panel for one saved look: { id, status, pieces, error }
  const [shopping, setShopping] = useState(null);

  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    api("/api/library")
      .then((data) => {
        if (!cancelled) {
          setItems(data.items);
          onTasteChange(data.taste);
        }
      })
      .catch((error) => !cancelled && setLoadError(error.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
    // Load once per signed-in user
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const chooseFile = (chosen) => {
    if (!chosen) {
      return;
    }

    if (!ACCEPTED_TYPES.includes(chosen.type)) {
      setSaveError("Please use a JPG, PNG or WEBP screenshot.");
      return;
    }

    if (preview) {
      URL.revokeObjectURL(preview);
    }

    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
    setLink("");
    setSaveError("");
  };

  const clearForm = () => {
    if (preview) {
      URL.revokeObjectURL(preview);
    }
    setFile(null);
    setPreview(null);
    setLink("");
    setNote("");
  };

  const save = async ({ shareFile, shareLink, fromShare } = {}) => {
    const imageToSend = shareFile || file;
    const linkToSend = shareLink ?? link.trim();

    if (!imageToSend && !linkToSend) {
      setSaveError("Add a screenshot or paste a YouTube / Pinterest link.");
      return;
    }

    const form = new FormData();
    if (imageToSend) {
      form.append("image", imageToSend);
    } else {
      form.append("url", linkToSend);
    }
    form.append("note", note);
    form.append("source", fromShare ? "share" : "upload");

    setSaving(true);
    setSaveError("");
    setSavedMessage("");

    try {
      const data = await api("/api/library", { method: "POST", form });
      setItems((current) => [data.item, ...current]);
      onTasteChange(data.taste);
      setSavedMessage(`Saved: ${data.item.analysis.summary || "new look"}`);
      clearForm();
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setSaving(false);
    }
  };

  // A look shared from Instagram / Pinterest / YouTube via the Android share menu
  useEffect(() => {
    if (!sharedPayload) {
      return;
    }

    const shareLink = firstLink(sharedPayload.url) || firstLink(sharedPayload.text);

    // Started from a timer (not the effect body); the cleanup cancels it if
    // React re-runs the effect, so each shared look is saved exactly once
    const timer = setTimeout(() => {
      save({ shareFile: sharedPayload.file, shareLink: sharedPayload.file ? "" : shareLink, fromShare: true });
      onSharedHandled();
    }, 0);

    return () => clearTimeout(timer);
    // Handle each shared payload once; save/onSharedHandled change every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedPayload]);

  const remove = async (item) => {
    if (!window.confirm("Remove this look from your Style Library?")) {
      return;
    }

    try {
      const data = await api(`/api/library/${item.id}`, { method: "DELETE" });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      onTasteChange(data.taste);
      if (shopping?.id === item.id) {
        setShopping(null);
      }
    } catch (error) {
      setSaveError(error.message);
    }
  };

  const shopLook = async (item) => {
    if (shopping?.id === item.id) {
      setShopping(null);
      return;
    }

    setShopping({ id: item.id, status: "loading", pieces: [], error: "" });

    try {
      const data = await api(`/api/library/${item.id}/shop?region=${encodeURIComponent(regionCode || "IN")}`);
      setShopping({
        id: item.id,
        status: data.catalog_available ? "ready" : "unavailable",
        pieces: data.pieces || [],
        error: "",
      });
    } catch (error) {
      setShopping({ id: item.id, status: "error", pieces: [], error: error.message });
    }
  };

  const tasteChips = [
    ...(taste?.styles || []).map((style) => style.replace("-", " ")),
    ...(taste?.colors || []),
    ...(taste?.garments || []),
  ];

  return (
    <section className="library">

      <div className="library-header">
        <div>
          <span className="result-label">YOUR STYLE LIBRARY</span>
          <h2>Looks you love, all in one place</h2>
          <p>
            Save outfits you spot on Instagram, Pinterest and YouTube. OmniFit learns
            your taste from them and gently personalises every suggestion.
          </p>
        </div>
      </div>

      {/* WHAT OMNIFIT HAS LEARNED */}

      <div className="taste-card">
        <strong>✨ What OmniFit has learned</strong>
        {tasteChips.length ? (
          <div className="taste-chips">
            {tasteChips.map((chip) => <span key={chip}>{chip}</span>)}
          </div>
        ) : (
          <p>Save a few looks and your taste will appear here.</p>
        )}
        <small>From {taste?.item_count || 0} saved look{taste?.item_count === 1 ? "" : "s"}.</small>
      </div>

      {/* ADD A LOOK */}

      <div className="panel library-add">
        <div className="panel-heading">
          <span className="step">+</span>
          <div>
            <h2>Save a look</h2>
            <p>Screenshot from any app, or a YouTube / Pinterest link</p>
          </div>
        </div>

        <div className="library-add-grid">
          <div
            className={`upload-area small ${dragActive ? "drag-active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              chooseFile(event.dataTransfer.files?.[0]);
            }}
          >
            {preview ? (
              <img className="library-preview" src={preview} alt="Screenshot to save" />
            ) : (
              <>
                <div className="upload-icon">📱</div>
                <p className="upload-title">Drop a screenshot</p>
                <p className="upload-subtitle">or click to choose · JPG, PNG, WEBP</p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            hidden
            onChange={(event) => {
              chooseFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          <div className="library-add-fields">
            <label className="field">
              <span>…or paste a link</span>
              <input
                type="url"
                placeholder="https://youtube.com/…  or  https://pin.it/…"
                value={link}
                disabled={Boolean(file)}
                onChange={(event) => {
                  setLink(event.target.value);
                  setSaveError("");
                }}
              />
              <small>Instagram links can't be read by other apps; use a screenshot.</small>
            </label>

            <label className="field">
              <span>Note (optional)</span>
              <input
                type="text"
                placeholder="e.g. love the overshirt"
                maxLength={300}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>

            {saveError && <p className="inline-error" role="alert">{saveError}</p>}
            {savedMessage && !saveError && <p className="save-success" role="status">✓ {savedMessage}</p>}

            <div className="library-add-actions">
              {(file || link) && !saving && (
                <button type="button" className="ghost-light" onClick={clearForm}>Clear</button>
              )}
              <button
                type="button"
                className="primary-button"
                disabled={saving || (!file && !link.trim())}
                onClick={() => save()}
              >
                {saving ? <><span className="spinner" /> Analysing the look…</> : "Save to library"}
              </button>
            </div>
          </div>
        </div>

        <details className="share-help">
          <summary>How to save straight from Instagram, Pinterest or YouTube</summary>
          <ol>
            <li>
              <strong>Android:</strong> install OmniFit (browser menu ⋮ → <em>Install app</em>
              {installPrompt && (
                <> or <button type="button" className="text-button" onClick={onInstall}>install now</button></>
              )}
              ). Then in Instagram, Pinterest or YouTube tap <em>Share</em> → <strong>OmniFit</strong>.
            </li>
            <li>
              <strong>iPhone / computer:</strong> take a screenshot and drop it here, or copy a
              YouTube / Pinterest link and paste it above.
            </li>
          </ol>
        </details>
      </div>

      {/* SAVED LOOKS */}

      {loading && <p className="cart-status"><span className="spinner dark small" /> Loading your library…</p>}
      {loadError && <p className="inline-error">{loadError}</p>}

      {!loading && !items.length && !loadError && (
        <p className="library-empty">
          Your library is empty. Save your first look above; three or more saves give OmniFit a clear picture of your taste.
        </p>
      )}

      <div className="library-grid">
        {items.map((item) => (
          <article className="library-card" key={item.id}>
            <div className="library-image">
              {item.has_image && (
                <img
                  src={`${API_BASE_URL}/api/library/${item.id}/image`}
                  alt={item.analysis.summary || "Saved look"}
                  loading="lazy"
                />
              )}
              {PLATFORM_LABELS[item.platform] && (
                <span className="platform-badge">{PLATFORM_LABELS[item.platform]}</span>
              )}
              {item.source === "share" && !item.platform && (
                <span className="platform-badge">↗ Shared</span>
              )}
            </div>

            <div className="library-body">
              <p className="library-summary">{item.analysis.summary || item.title || "Saved look"}</p>

              <div className="taste-chips small">
                {[...item.analysis.styles, ...item.analysis.colors].slice(0, 5).map((tag) => (
                  <span key={tag}>{tag.replace("-", " ")}</span>
                ))}
              </div>

              {item.note && <p className="library-note">“{item.note}”</p>}

              <div className="library-actions">
                <button type="button" className="add-to-cart" onClick={() => shopLook(item)}>
                  {shopping?.id === item.id ? "Hide products" : "🛍️ Shop this look"}
                </button>
                {item.source_url && (
                  <a className="text-button" href={item.source_url} target="_blank" rel="noopener noreferrer">
                    Source ↗
                  </a>
                )}
                <button type="button" className="text-button danger" onClick={() => remove(item)}>
                  Remove
                </button>
              </div>
            </div>

            {shopping?.id === item.id && (
              <div className="library-shop">
                {shopping.status === "loading" && (
                  <p className="cart-status"><span className="spinner dark small" /> Finding similar pieces…</p>
                )}
                {shopping.status === "error" && <p className="inline-error">{shopping.error}</p>}
                {shopping.status === "unavailable" && (
                  <p className="no-products">Product matches are available for India right now.</p>
                )}
                {shopping.status === "ready" && shopping.pieces.map((piece) => (
                  <div className="library-piece" key={piece.piece}>
                    <span className="item-label">{piece.piece}</span>
                    {piece.products.length ? (
                      <div className="product-list compact">
                        {piece.products.slice(0, 2).map((product) => renderProduct(product))}
                      </div>
                    ) : (
                      <p className="no-products">No close match in partner brands.</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export default StyleLibrary;
