import { useEffect, useRef, useState } from "react";
import { api } from "./api";

// Sign in / create account. Google sign-in appears only when the backend
// has a GOOGLE_CLIENT_ID configured.
function AuthDialog({ reason, googleClientId, onSignedIn, onClose }) {
  const [mode, setMode] = useState("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const googleButtonRef = useRef(null);

  // Keep the latest callback for the Google script, which is set up once
  const onSignedInRef = useRef(onSignedIn);
  useEffect(() => {
    onSignedInRef.current = onSignedIn;
  }, [onSignedIn]);

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) {
      return;
    }

    const renderButton = () => {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          setBusy(true);
          setError("");
          try {
            const data = await api("/api/auth/google", { method: "POST", json: { credential } });
            onSignedInRef.current(data);
          } catch (signInError) {
            setError(signInError.message);
          } finally {
            setBusy(false);
          }
        },
      });

      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
        width: 300,
        text: "continue_with",
      });
    };

    if (window.google?.accounts?.id) {
      renderButton();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = renderButton;
    script.onerror = () => setError("Google sign-in couldn't load. Use email instead.");
    document.head.appendChild(script);
  }, [googleClientId]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const data =
        mode === "signin"
          ? await api("/api/auth/login", { method: "POST", json: { email, password } })
          : await api("/api/auth/register", {
              method: "POST",
              json: { email, password, name, consent },
            });

      onSignedIn(data);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="dialog auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        onSubmit={submit}
      >
        <div className="dialog-header">
          <div>
            <h2 id="auth-title">
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h2>
            <p>{reason || "Save looks and get suggestions that match your taste."}</p>
          </div>

          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="segmented auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            className={mode === "signin" ? "active" : ""}
            onClick={() => { setMode("signin"); setError(""); }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? "active" : ""}
            onClick={() => { setMode("register"); setError(""); }}
          >
            Create account
          </button>
        </div>

        {googleClientId && (
          <>
            <div className="google-button" ref={googleButtonRef} />
            <div className="auth-divider"><span>or with email</span></div>
          </>
        )}

        {mode === "register" && (
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              maxLength={60}
            />
          </label>
        )}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={254}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <div className="password-input">
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={mode === "register" ? 8 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              maxLength={200}
            />
            <button
              type="button"
              className="text-button"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {mode === "register" && <small>At least 8 characters.</small>}
        </label>

        {mode === "register" && (
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I agree that OmniFit stores the looks I save (screenshots and links)
              and my conversation history (questions, photos I send and the
              suggestions I get) to personalise my suggestions and improve the
              stylist. I can turn History off or clear it any time, and delete
              my account and all data at any time.
            </span>
          </label>
        )}

        {error && <p className="inline-error" role="alert">{error}</p>}

        <button
          type="submit"
          className="primary-button"
          disabled={busy || (mode === "register" && !consent)}
        >
          {busy ? <span className="spinner" /> : null}
          {mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}

export default AuthDialog;
