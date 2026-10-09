import { FIT_PREFERENCES, MEASUREMENT_FIELDS, measurementError } from "../sizing";
import { useOmniFit } from "../app/context";
import { FACE_SHAPE_CHOICES, UNDERTONE_CHOICES, AGE_GROUP_CHOICES, SIZE_CHOICES, DEPARTMENT_OPTIONS, BUDGET_PRESETS } from "../app/shared";

// Edit Style DNA: shopping, age, accessories & colours, measurements, sizes
export default function StyleDnaDialog() {
  const { regions, regionCode, locating, locationMessage, setShowLocationPrompt, department, setDepartment, budget, setBudget, learnedTaste, mySizes, ageGroup, personal, measurements, styleOpen, setStyleOpen, selectRegion, detectLocation, describeBudget, choosePersonal, chooseAgeGroup, updateMeasurement, sizeAdvice, applySuggestedSizes, updateMySize, resetTaste, openBodyScan } = useOmniFit();

  return (
    <>
      {styleOpen && (

        <div
          className="dialog-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setStyleOpen(false);
            }
          }}
        >

          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="style-title"
          >

            <div className="dialog-header">
              <div>
                <h2 id="style-title">🧬 Edit Style DNA</h2>
                <p>Saved on this device. The stylist fills most of this in as you chat.</p>
              </div>

              <button
                type="button"
                className="dialog-close"
                onClick={() => setStyleOpen(false)}
                aria-label="Close Style DNA"
              >
                ×
              </button>
            </div>

            <h3 className="dialog-section">Shopping</h3>

            <div className="measure-chart" role="radiogroup" aria-label="Shopping for">
              <span className="size-setting-label">Shopping for</span>
              {DEPARTMENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={department === option.value}
                  className={`occasion-option ${department === option.value ? "active" : ""}`}
                  onClick={() => setDepartment(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="measure-chart" role="radiogroup" aria-label="Budget">
              <span className="size-setting-label">Budget</span>
              {BUDGET_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={budget.preset === preset.id}
                  className={`occasion-option ${budget.preset === preset.id ? "active" : ""}`}
                  onClick={() => setBudget({ preset: preset.id, min: preset.min, max: preset.max })}
                >
                  {preset.min || preset.max ? describeBudget(preset) : "Any"}
                </button>
              ))}
            </div>

            {regions.length > 0 && (
              <div className="measure-chart">
                <span className="size-setting-label">Stores in</span>
                <select
                  className="voice-select"
                  value={regionCode}
                  onChange={(event) => {
                    selectRegion(event.target.value, "manual");
                    setShowLocationPrompt(false);
                  }}
                  aria-label="Shopping region"
                >
                  {regions.map((region) => (
                    <option key={region.code} value={region.code}>{region.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="occasion-option"
                  onClick={() => detectLocation()}
                  disabled={locating}
                >
                  {locating ? "Locating…" : "📍 Use my location"}
                </button>
              </div>
            )}
            {locationMessage && <p className="measure-hint">{locationMessage}</p>}

            <h3 className="dialog-section">Age group <small>(optional)</small></h3>

            <div className="measure-chart" role="radiogroup" aria-label="Age group">
              {AGE_GROUP_CHOICES.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  role="radio"
                  aria-checked={ageGroup === choice.key}
                  className={`occasion-option ${ageGroup === choice.key ? "active" : ""}`}
                  onClick={() => chooseAgeGroup(choice.key)}
                >
                  {choice.label} <small>{choice.ages}</small>
                </button>
              ))}
            </div>
            <p className="measure-hint">
              Shows trends for your generation and gently shapes suggestions. Tap again to clear.
            </p>

            <h3 className="dialog-section">Accessories &amp; colours <small>(optional)</small></h3>

            {[
              ["face_shape", "Face shape", FACE_SHAPE_CHOICES],
              ["undertone", "Skin undertone", UNDERTONE_CHOICES],
            ].map(([field, label, choices]) => {
              const picked = choices.find((choice) => choice.key === personal[field]);
              return (
                <div key={field}>
                  <div className="measure-chart" role="radiogroup" aria-label={label}>
                    <span className="size-setting-label">{label}</span>
                    {choices.map((choice) => (
                      <button
                        key={choice.key}
                        type="button"
                        role="radio"
                        aria-checked={personal[field] === choice.key}
                        className={`occasion-option ${personal[field] === choice.key ? "active" : ""}`}
                        onClick={() => choosePersonal(field, choice.key)}
                        title={choice.hint}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                  {picked && <p className="measure-hint">{picked.hint}</p>}
                </div>
              );
            })}
            <p className="measure-hint">
              Only used to suggest earrings, frames, necklaces and colours that complement you.
              Choose them here, or let Style Scan estimate them from one selfie if you ask it to.
            </p>

            <h3 className="dialog-section">My measurements <small>(inches, optional)</small></h3>

            <button type="button" className="scan-cta" onClick={openBodyScan}>
              <span aria-hidden="true">📏</span>
              <span><strong>Body Scan</strong>: measure with your camera instead. Measured on your phone, nothing uploaded.</span>
            </button>

            <div className="measure-chart" role="radiogroup" aria-label="Size chart">
              <span className="size-setting-label">Size chart</span>
              {[["men", "Men's"], ["women", "Women's"]].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={measurements.chart === key}
                  className={`occasion-option ${measurements.chart === key ? "active" : ""}`}
                  onClick={() => updateMeasurement("chart", key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="measure-grid">
              {MEASUREMENT_FIELDS.map((field) => (
                <label className="measure-field" key={field.key}>
                  <span>{field.label}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min={field.min}
                    max={field.max}
                    placeholder="in"
                    value={measurements[field.key] ?? ""}
                    onChange={(event) => updateMeasurement(field.key, event.target.value)}
                  />
                  <small>{field.hint}</small>
                </label>
              ))}
            </div>

            <div className="measure-chart" role="radiogroup" aria-label="Fit I like">
              <span className="size-setting-label">Fit I like</span>
              {FIT_PREFERENCES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={measurements.fit === option.key}
                  className={`occasion-option ${measurements.fit === option.key ? "active" : ""}`}
                  onClick={() => updateMeasurement("fit", option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {(() => {
              const problem = measurementError(measurements);
              const suggested = Object.entries(sizeAdvice.sizes);
              if (problem) {
                return <p className="inline-error">{problem}</p>;
              }
              if (!measurements.chart && (measurements.chest || measurements.waist)) {
                return <p className="measure-hint">Choose a size chart to see your sizes.</p>;
              }
              if (!suggested.length) {
                return (
                  <p className="measure-hint">
                    Enter a measurement or two and OmniFit suggests your sizes. Saved only on this device.
                  </p>
                );
              }
              const labels = { top: "Tops", bottom: "Waist", footwear: "UK" };
              const applied = suggested.every(([kind, size]) => mySizes[kind] === size);
              return (
                <div className="measure-result">
                  <p>
                    <strong>Your sizes:</strong>{" "}
                    {suggested.map(([kind, size]) => `${labels[kind]} ${size}`).join(" · ")}
                    <small> (standard Indian chart; brands vary a little)</small>
                  </p>
                  {sizeAdvice.notes.length > 0 && (
                    <ul>
                      {sizeAdvice.notes.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="primary-button"
                    onClick={applySuggestedSizes}
                    disabled={applied}
                  >
                    {applied ? "✓ Using these as my sizes" : "Use these as my sizes"}
                  </button>
                </div>
              );
            })()}

            <h3 className="dialog-section">My sizes</h3>

            {Object.entries(SIZE_CHOICES).map(([kind, choice]) => (
              <div className="size-setting" key={kind}>
                <div>
                  <span className="size-setting-label">{choice.label}</span>
                  <span className="size-setting-hint">{choice.hint}</span>
                </div>

                <div className="size-options" role="radiogroup" aria-label={choice.label}>
                  {choice.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={mySizes[kind] === option}
                      className={mySizes[kind] === option ? "active" : ""}
                      onClick={() =>
                        updateMySize(kind, mySizes[kind] === option ? null : option)
                      }
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <h3 className="dialog-section">What OmniFit has learned</h3>

            {(() => {
              const { styles, stores } = learnedTaste;

              return styles.length || stores.length ? (
                <>
                  <p className="taste-line">
                    <strong>Styles you ask for:</strong>{" "}
                    {styles.map((style) => style.replace("-", " ")).join(", ") || "—"}
                  </p>
                  <p className="taste-line">
                    <strong>Brands you open:</strong> {stores.join(", ") || "—"}
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={resetTaste}
                  >
                    Reset what OmniFit learned
                  </button>
                </>
              ) : (
                <p className="taste-line">
                  Nothing yet. As you ask questions and open products, OmniFit
                  ranks brands that match your taste first.
                </p>
              );
            })()}

            <button
              type="button"
              className="primary-button"
              onClick={() => setStyleOpen(false)}
            >
              Done
            </button>

          </div>

        </div>

      )}
    </>
  );
}
