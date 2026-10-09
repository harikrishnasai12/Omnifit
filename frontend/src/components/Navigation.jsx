import { useOmniFit } from "../app/context";

// The five places: Home, Explore, the Stylist orb (centre), Try-On and You.
// Desktop: a left sidebar. Phone: a bottom bar with the orb raised in the middle.
const NAV_ITEMS = [
  { key: "home", icon: "🏠", label: "Home" },
  { key: "explore", icon: "🧭", label: "Explore" },
  { key: "stylist", icon: "✦", label: "Stylist", orb: true },
  { key: "tryon", icon: "🪞", label: "Try-On" },
  { key: "you", icon: "🙂", label: "You" },
];

// Wardrobe and Saved looks live inside "You"
const YOU_VIEWS = ["you", "wardrobe", "library"];

export default function Navigation() {
  const {
    view, openView, user, accountMenuOpen, setAccountMenuOpen, historyOn, toggleHistory,
    clearHistory, signOut, deleteAccount, setAuthPrompt,
  } = useOmniFit();

  // Community is a tab of Explore
  const isActive = (key) =>
    key === "you" ? YOU_VIEWS.includes(view) : key === "explore" ? ["explore", "community"].includes(view) : view === key;

  const account = user ? (
    <div className="account-menu">
      <button
        type="button"
        className="avatar-button"
        aria-haspopup="menu"
        aria-expanded={accountMenuOpen}
        aria-label={`Account: ${user.name}`}
        onClick={() => setAccountMenuOpen(!accountMenuOpen)}
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>

      {accountMenuOpen && (
        <div className="account-dropdown" role="menu">
          <p>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </p>
          <button type="button" role="menuitem" onClick={() => openView("library")}>
            📚 Saved looks
          </button>
          <button type="button" role="menuitem" onClick={() => openView("wardrobe")}>
            👕 My Wardrobe
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={Boolean(historyOn)}
            className="history-toggle"
            onClick={toggleHistory}
            disabled={historyOn === null}
          >
            🕘 History
            <span className={`history-state ${historyOn ? "on" : ""}`}>
              {historyOn === null ? "…" : historyOn ? "On" : "Off"}
            </span>
          </button>
          <button type="button" role="menuitem" onClick={clearHistory}>
            🧹 Clear my history
          </button>
          <button type="button" role="menuitem" onClick={signOut}>
            Sign out
          </button>
          <button type="button" role="menuitem" className="danger" onClick={deleteAccount}>
            Delete account &amp; data
          </button>
        </div>
      )}
    </div>
  ) : (
    <button
      className="style-button sign-in-button"
      type="button"
      onClick={() => setAuthPrompt({ reason: "" })}
    >
      Sign in
    </button>
  );

  return (
    <>
      {/* Top bar: brand + account (the sidebar replaces it on desktop) */}
      <header className="topbar">
        <a href="/" className="brand">
          <span className="brand-name">OmniFit</span>
          <span className="brand-live"><span className="live-dot" />Live</span>
        </a>
        {account}
      </header>

      <nav className="app-nav" aria-label="OmniFit">
        <a href="/" className="brand sidebar-brand">
          <span className="brand-name">OmniFit</span>
          <span className="brand-live"><span className="live-dot" />Live</span>
        </a>

        <div className="app-nav-items" role="tablist">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={isActive(item.key)}
              className={`app-nav-item ${item.orb ? "orb" : ""} ${isActive(item.key) ? "active" : ""}`}
              onClick={() => openView(item.key)}
            >
              <span className="app-nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="app-nav-label">{item.label}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-account">{account}</div>
      </nav>
    </>
  );
}
