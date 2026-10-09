import "./App.css";
import "./Chat.css";
import "./Shell.css";
import "./Feed.css";
import "./Theme.css";
import { lazy, Suspense } from "react";
import AuthDialog from "./AuthDialog";
import { useOmniFit } from "./app/context";
import { OmniFitProvider } from "./app/OmniFitProvider";
import BodyScanDialog from "./components/BodyScanDialog";
import CameraModal from "./components/CameraModal";
import CartDialog from "./components/CartDialog";
import Navigation from "./components/Navigation";
import StyleDnaDialog from "./components/StyleDnaDialog";
import StyleScanDialog from "./components/StyleScanDialog";
import ExplorePage from "./pages/ExplorePage";
import HomePage from "./pages/HomePage";
import StylistPage from "./pages/StylistPage";
import TryOnPage from "./pages/TryOnPage";
import YouPage from "./pages/YouPage";

// "Behind the scenes" panel: dev builds only (left out of production bundles)
const DevPanel = import.meta.env.DEV ? lazy(() => import("./components/DevPanel")) : null;

const PAGES = {
  home: HomePage,
  explore: ExplorePage,
  stylist: StylistPage,
  tryon: TryOnPage,
  you: YouPage,
  wardrobe: YouPage,
  library: YouPage,
};

// The app shell: navigation, the current page, and the dialogs. All state and
// logic live in OmniFitProvider (app/OmniFitProvider.jsx).
function Shell() {
  const { view, authPrompt, shareNeedsSignIn, googleClientId, handleSignedIn, closeAuth } = useOmniFit();
  const Page = PAGES[view] || HomePage;

  return (
    <div className={`app app-shell view-${view}`}>
      <Navigation />

      <main>
        <Page />
      </main>

      <CameraModal />

      {(authPrompt || shareNeedsSignIn) && (
        <AuthDialog
          reason={
            shareNeedsSignIn
              ? "Sign in to save the look you shared to your Style Library."
              : authPrompt?.reason
          }
          googleClientId={googleClientId}
          onSignedIn={handleSignedIn}
          onClose={closeAuth}
        />
      )}

      <StyleScanDialog />
      <BodyScanDialog />
      <StyleDnaDialog />
      <CartDialog />

      {DevPanel && (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      )}
    </div>
  );
}

function App() {
  return (
    <OmniFitProvider>
      <Shell />
    </OmniFitProvider>
  );
}

export default App;
