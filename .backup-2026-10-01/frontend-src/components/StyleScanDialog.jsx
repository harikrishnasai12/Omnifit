import { useState } from "react";
import { useOmniFit } from "../app/context";
import { AGE_GROUP_CHOICES, DEPARTMENT_NAMES } from "../app/shared";

// The optional age-group and section guess: shown for the person to confirm
// or correct. Nothing changes in their Style DNA until they tap "Use these".
function ScanSuggestion({ suggestion }) {
  const { ageGroup, chooseAgeGroup, setDepartment } = useOmniFit();
  const [picked, setPicked] = useState({ age: suggestion.age_group, section: suggestion.section });
  const [status, setStatus] = useState("pending");

  if (status === "dismissed") {
    return null;
  }
  if (status === "used") {
    const saved = [picked.age && "Age group", picked.section && "Section"].filter(Boolean).join(" and ");
    return <p className="save-success">✓ {saved || "Nothing"} saved to your Style DNA</p>;
  }

  return (
    <div className="scan-suggestion">
      <strong>A guess from your selfie: is it right?</strong>
      <p>Made on this device and often wrong. Correct it, or skip it.</p>

      <div className="scan-suggestion-row" role="radiogroup" aria-label="Age group">
        <span>Age group</span>
        {AGE_GROUP_CHOICES.map((choice) => (
          <button
            type="button"
            key={choice.key}
            role="radio"
            aria-checked={picked.age === choice.key}
            className={`occasion-option ${picked.age === choice.key ? "active" : ""}`}
            onClick={() => setPicked({ ...picked, age: choice.key })}
          >
            {choice.ages}
          </button>
        ))}
      </div>

      <div className="scan-suggestion-row" role="radiogroup" aria-label="Shopping for">
        <span>Shopping for</span>
        {Object.entries(DEPARTMENT_NAMES).map(([value, label]) => (
          <button
            type="button"
            key={value}
            role="radio"
            aria-checked={picked.section === value}
            className={`occasion-option ${picked.section === value ? "active" : ""}`}
            onClick={() => setPicked({ ...picked, section: value })}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="scan-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            // chooseAgeGroup toggles, so only call it for a different group
            if (picked.age && picked.age !== ageGroup) {
              chooseAgeGroup(picked.age);
            }
            if (picked.section) {
              setDepartment(picked.section);
            }
            setStatus("used");
          }}
        >
          Use these
        </button>
        <button type="button" className="ghost-light" onClick={() => setStatus("dismissed")}>
          Don't use
        </button>
      </div>
    </div>
  );
}

// Style Scan: consent, scanning, face shape + undertone result
export default function StyleScanDialog() {
  const { cameraOpen, styleScan, setStyleScan, setStyleOpen, openCamera, saveStyleScan, askStylist } = useOmniFit();

  return (
    <>
      {styleScan && !cameraOpen && (
        <div
          className="dialog-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget && styleScan.status !== "scanning") {
              setStyleScan(null);
            }
          }}
        >
          <div className="dialog scan-dialog" role="dialog" aria-modal="true" aria-labelledby="scan-title">
            <div className="dialog-header">
              <div>
                <h2 id="scan-title">✨ Style Scan</h2>
                <p>Accessories and colours that complement you</p>
              </div>
              <button
                type="button"
                className="dialog-close"
                onClick={() => setStyleScan(null)}
                aria-label="Close Style Scan"
                disabled={styleScan.status === "scanning"}
              >
                ×
              </button>
            </div>

            {styleScan.status === "consent" && (
              <>
                <ul className="scan-points">
                  <li><span aria-hidden="true">📷</span> One selfie, facing a window or a white light.</li>
                  <li>
                    <span aria-hidden="true">🔍</span>
                    <span>
                      The AI looks at just two things: your <strong>face shape</strong> (for earrings, frames,
                      necklaces) and your skin's <strong>undertone</strong>, warm, cool or neutral (for colours
                      and jewellery metal).
                    </span>
                  </li>
                  <li>
                    <span aria-hidden="true">🚫</span>
                    <span>
                      It never judges looks or how light or dark your skin is. It doesn't guess your age or
                      gender unless you tick the box below.
                    </span>
                  </li>
                  <li><span aria-hidden="true">🗑️</span> The photo isn't saved anywhere. You decide whether to keep the result.</li>
                </ul>
                <label className="scan-optin">
                  <input
                    type="checkbox"
                    checked={Boolean(styleScan.estimate)}
                    onChange={(event) => setStyleScan({ ...styleScan, estimate: event.target.checked })}
                  />
                  <span>
                    <strong>Also guess my age group and shopping section</strong> from this selfie. It's worked out
                    on this device, never sent or saved, and often wrong: you check it before anything is used.
                  </span>
                </label>
                <button type="button" className="primary-button" onClick={() => openCamera("scan")}>
                  I agree, open the camera
                </button>
                <p className="measure-hint">
                  Prefer to choose yourself?{" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setStyleScan(null);
                      setStyleOpen(true);
                    }}
                  >
                    Pick them in Style DNA
                  </button>
                </p>
              </>
            )}

            {styleScan.status === "scanning" && (
              <p className="cart-status"><span className="spinner dark small" /> Reading your face shape and undertone…</p>
            )}

            {styleScan.status === "error" && (
              <>
                <p className="inline-error">{styleScan.error}</p>
                <button type="button" className="primary-button" onClick={() => openCamera("scan")}>
                  Try again
                </button>
              </>
            )}

            {(styleScan.status === "result" || styleScan.status === "saved") && (() => {
              const result = styleScan.result;
              const sureness = { high: "Clear reading", medium: "Fairly sure", low: "Best guess" };
              return (
                <>
                  <div className="scan-results">
                    {result.face_shape && (
                      <div className="scan-result">
                        <span>Face shape</span>
                        <strong>{result.face_shape.charAt(0).toUpperCase() + result.face_shape.slice(1)}</strong>
                        <small>{sureness[result.face_shape_confidence]}</small>
                        {result.accessory_tip && <p>{result.accessory_tip}</p>}
                      </div>
                    )}
                    {result.undertone && (
                      <div className="scan-result">
                        <span>Undertone</span>
                        <strong>{result.undertone.charAt(0).toUpperCase() + result.undertone.slice(1)}</strong>
                        <small>{sureness[result.undertone_confidence]}</small>
                        {result.colour_tip && <p>{result.colour_tip}</p>}
                      </div>
                    )}
                  </div>
                  <p className="measure-hint">
                    Estimates from one photo. Keep them, retake, or change them anytime in Style DNA.
                  </p>

                  {result.suggestion && <ScanSuggestion suggestion={result.suggestion} />}
                  {styleScan.estimate && !result.suggestion && (
                    <p className="measure-hint">I couldn't make an age group or section guess from this photo.</p>
                  )}

                  {styleScan.status === "saved" ? (
                    <>
                      <p className="save-success">✓ Saved to your Style DNA</p>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => {
                          setStyleScan(null);
                          askStylist(
                            `Suggest earrings, frames and colours that suit my ${result.face_shape || ""} face shape and ${result.undertone || ""} undertone`
                          );
                        }}
                      >
                        Show me what suits me →
                      </button>
                    </>
                  ) : (
                    <div className="scan-actions">
                      <button type="button" className="primary-button" onClick={saveStyleScan}>
                        Save to my Style DNA
                      </button>
                      <button type="button" className="ghost-light" onClick={() => openCamera("scan")}>
                        Retake
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}
