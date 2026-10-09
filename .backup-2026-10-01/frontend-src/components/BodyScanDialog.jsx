import { suggestSizes } from "../sizing";
import { useOmniFit } from "../app/context";
import { ACCEPTED_IMAGE_TYPES } from "../app/shared";

// Body Scan: height, on-device measuring, confirm and save
export default function BodyScanDialog() {
  const { cameraOpen, department, bodyScan, setBodyScan, bodyFileRef, measurements, openCamera, runBodyScan, saveBodyScan, askStylist } = useOmniFit();

  return (
    <>
      {bodyScan && !cameraOpen && (
        <div
          className="dialog-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget && bodyScan.status !== "measuring") {
              setBodyScan(null);
            }
          }}
        >
          <div className="dialog scan-dialog" role="dialog" aria-modal="true" aria-labelledby="body-title">
            <div className="dialog-header">
              <div>
                <h2 id="body-title">📏 Body Scan</h2>
                <p>Your measurements from one photo, measured on your own phone</p>
              </div>
              <button
                type="button"
                className="dialog-close"
                onClick={() => setBodyScan(null)}
                aria-label="Close Body Scan"
                disabled={bodyScan.status === "measuring"}
              >
                ×
              </button>
            </div>

            <input
              ref={bodyFileRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(",")}
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  runBodyScan(file);
                }
              }}
            />

            {(bodyScan.status === "intro" || bodyScan.status === "error") && (() => {
              const heightOk = Number(bodyScan.heightCm) >= 120 && Number(bodyScan.heightCm) <= 220;
              const feet = heightOk ? Number(bodyScan.heightCm) / 30.48 : 0;
              return (
                <>
                  {bodyScan.status === "intro" && (
                    <ul className="scan-points">
                      <li><span aria-hidden="true">📐</span><span>Your height sets the scale for every measurement.</span></li>
                      <li>
                        <span aria-hidden="true">📱</span>
                        <span>Prop the phone at waist height, step back 2–3 m and face it, arms slightly away from your body. Fitted clothes read best.</span>
                      </li>
                      <li><span aria-hidden="true">🔒</span><span>Measured on this device: the photo never leaves your phone and isn't saved.</span></li>
                      <li><span aria-hidden="true">✏️</span><span>You check every number before it's saved.</span></li>
                    </ul>
                  )}
                  {bodyScan.status === "error" && <p className="inline-error">{bodyScan.error}</p>}

                  <label className="measure-field">
                    <span>Your height (cm)</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="120"
                      max="220"
                      placeholder="e.g. 168"
                      value={bodyScan.heightCm}
                      onChange={(event) => setBodyScan({ ...bodyScan, heightCm: event.target.value })}
                    />
                    <small>
                      {heightOk
                        ? `≈ ${Math.floor(feet)} ft ${Math.round((feet % 1) * 12)} in`
                        : "5 ft 6 in ≈ 168 cm · 5 ft 10 in ≈ 178 cm"}
                    </small>
                  </label>

                  <div className="scan-actions">
                    <button type="button" className="primary-button" disabled={!heightOk} onClick={() => openCamera("body")}>
                      Open camera (5 s timer)
                    </button>
                    <button type="button" className="ghost-light" disabled={!heightOk} onClick={() => bodyFileRef.current?.click()}>
                      Use a photo
                    </button>
                  </div>
                </>
              );
            })()}

            {bodyScan.status === "measuring" && (
              <p className="cart-status"><span className="spinner dark small" /> Measuring on your device…</p>
            )}

            {(bodyScan.status === "result" || bodyScan.status === "saved") && (() => {
              const values = bodyScan.values;
              const fields = [
                ["chest", "Chest / bust"],
                ["waist", "Waist"],
                ["hip", "Hip"],
              ];
              const chart = measurements.chart || (["men", "women"].includes(department) ? department : null);
              const sizes = chart ? suggestSizes({ ...measurements, ...values }, chart, measurements.fit).sizes : {};
              return (
                <>
                  <div className="measure-grid">
                    {fields.map(([key, label]) => (
                      <label className="measure-field" key={key}>
                        <span>{label} (in)</span>
                        <input
                          type="number"
                          step="0.5"
                          value={values[key] ?? ""}
                          disabled={bodyScan.status === "saved"}
                          onChange={(event) =>
                            setBodyScan({ ...bodyScan, values: { ...values, [key]: event.target.value } })
                          }
                        />
                      </label>
                    ))}
                    <div className="measure-field">
                      <span>Shoulder · inseam</span>
                      <strong className="measure-static">{values.shoulder}″ · {values.inseam}″</strong>
                    </div>
                  </div>

                  <ul className="scan-notes">
                    {(bodyScan.notes || []).map((note) => <li key={note}>{note}</li>)}
                  </ul>

                  {Object.keys(sizes).length > 0 && (
                    <p className="measure-hint">
                      That's about <strong>
                        {[sizes.top && `Tops ${sizes.top}`, sizes.bottom && `Waist ${sizes.bottom}`].filter(Boolean).join(" · ")}
                      </strong> on a standard Indian chart.
                    </p>
                  )}

                  {bodyScan.status === "saved" ? (
                    <>
                      <p className="save-success">✓ Saved to your Style DNA; products in your size now come first</p>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => {
                          setBodyScan(null);
                          askStylist("Show me outfits in my size");
                        }}
                      >
                        Show me outfits in my size →
                      </button>
                    </>
                  ) : (
                    <div className="scan-actions">
                      <button type="button" className="primary-button" onClick={saveBodyScan}>
                        Looks right, save
                      </button>
                      <button type="button" className="ghost-light" onClick={() => openCamera("body")}>
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
