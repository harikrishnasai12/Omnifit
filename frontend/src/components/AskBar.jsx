import { useRef, useState } from "react";
import { useOmniFit } from "../app/context";
import { ACCEPTED_IMAGE_TYPES } from "../app/shared";

// The one way in from Home and Explore: type it, or show a photo. Everything
// goes to the stylist, which works out whether to show products or style a look.
export default function AskBar({ placeholder = "Ask for anything, or show a photo", hero = false }) {
  const { askStylist, selectImageFile, setQuestion, openView } = useOmniFit();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  // A photo goes to the stylist with whatever was typed, ready to send
  const attach = (file) => {
    if (!file) {
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError("Please use a JPG, PNG, or WEBP photo.");
      return;
    }
    selectImageFile(file);
    setQuestion(text.trim());
    setText("");
    openView("stylist");
  };

  return (
    <>
    <form
      className={`ask-bar explore-search ${hero ? "hero" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) {
          askStylist(text.trim());
          setText("");
        }
      }}
    >
      <button
        type="button"
        className="ask-bar-photo"
        onClick={() => fileRef.current?.click()}
        aria-label="Show a photo of an outfit"
      >
        <span aria-hidden="true">📷</span>
      </button>

      <input
        type="search"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setError("");
        }}
        placeholder={placeholder}
        aria-label="Ask the stylist or search every partner store"
        enterKeyHint="send"
      />

      <button type="submit" className="send-button" disabled={!text.trim()} aria-label="Ask">
        ➤
      </button>

    </form>

    <input
      ref={fileRef}
      type="file"
      accept={ACCEPTED_IMAGE_TYPES.join(",")}
      hidden
      onChange={(event) => {
        attach(event.target.files?.[0]);
        event.target.value = "";
      }}
    />

    {error && <p className="inline-error ask-bar-error" role="alert">{error}</p>}
    </>
  );
}
