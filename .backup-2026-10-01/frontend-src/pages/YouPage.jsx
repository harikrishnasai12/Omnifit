import StyleLibrary from "../StyleLibrary";
import Wardrobe from "../Wardrobe";
import { useOmniFit } from "../app/context";

// You: what OmniFit has learned (Style DNA), your wardrobe and saved looks.
// (Step f replaces the Style DNA grid with the plain-language taste summary.)
export default function YouPage() {
  const {
    view, openView, user, regionCode, coords, renderProductCard, renderStyleDna, renderClosetSignIn,
    libraryTaste, setLibraryTaste, sharedPayload, setSharedPayload, installPrompt, setInstallPrompt,
  } = useOmniFit();

  const section = view === "wardrobe" || view === "library" ? view : "you";

  return (
    <>
      <div className="page-tabs" role="tablist" aria-label="You">
        {[
          { key: "you", label: "🧬 Style DNA" },
          { key: "wardrobe", label: "👕 Wardrobe" },
          { key: "library", label: "📚 Saved looks" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={section === tab.key}
            className={section === tab.key ? "active" : ""}
            onClick={() => openView(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {section === "you" ? renderStyleDna() : !user ? renderClosetSignIn() : section === "wardrobe" ? (
        <Wardrobe
          user={user}
          regionCode={regionCode}
          coords={coords}
          renderProduct={(product) => renderProductCard(product, "compact")}
        />
      ) : (
        <StyleLibrary
          user={user}
          taste={libraryTaste}
          onTasteChange={setLibraryTaste}
          regionCode={regionCode}
          renderProduct={(product) => renderProductCard(product, "compact")}
          sharedPayload={sharedPayload}
          onSharedHandled={() => setSharedPayload(null)}
          installPrompt={installPrompt}
          onInstall={async () => {
            installPrompt.prompt();
            await installPrompt.userChoice.catch(() => null);
            setInstallPrompt(null);
          }}
        />
      )}
    </>
  );
}
