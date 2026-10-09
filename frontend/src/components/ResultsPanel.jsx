import { useState } from "react";
import { useOmniFit } from "../app/context";
import { DEPARTMENT_NAMES, OCCASION_ICONS, WEATHER_ICONS, NO_BUDGET } from "../app/shared";
import ProductSheet from "./ProductSheet";

// The answer on screen: product grid for plain searches, looks and items from the stylist
export default function ResultsPanel() {
  const { image, recommendation, budget, setBudget, browseRequest, setBrowseRequest, occasions, speaking, personalizeOn, resultsRef, renderShopLinks, catalogAvailable, formatPrice, describeBudget, budgetIsSet, canSpeak, toggleSpeaking, togglePersonalize, priceRange, browseData, browseLoading, askStylistInstead, browseColour, renderProductCard, getSwatchColor, renderItemOption, renderCompleteOutfit, getResultTitle, currentRegion, setDepartment, sendChat, sending, boardSheet, setBoardSheet, recordStoreClick, openCartPicker, lookBudget } = useOmniFit();

  // "Change" on the detected section: pick another one right here
  const [changingSection, setChangingSection] = useState(false);

  // Saves the section and asks the stylist to redo the looks on screen for it
  const changeSection = (value) => {
    setChangingSection(false);
    setDepartment(value);
    sendChat(`Show these for ${DEPARTMENT_NAMES[value].toLowerCase()} instead`, { withPhoto: false });
  };

  // "Just show products": offered when every suggestion is the same kind of
  // item, so one catalogue search covers them all
  const productsQuery = (() => {
    if (!catalogAvailable || recommendation?.request_type !== "item_options") {
      return null;
    }
    const items = recommendation.recommendations;
    const kinds = new Set(items.map((item) => (item?.item || "").trim().toLowerCase().split(/\s+/).pop()));
    return kinds.size === 1 ? items[0]?.any_colour_query || items[0]?.search_query || null : null;
  })();

  return (
    <>
        <section
          className="results"
          ref={resultsRef}
          aria-live="polite"
        >


          {/* BROWSE: every colour and model of a plain item search */}

          {browseRequest && browseData && (() => {
            const activeColour = browseData.colour || "all";
            const shopQuery = activeColour !== "all"
              ? `${activeColour} ${browseData.query}`
              : browseData.query;
            const pickColour = (colour) =>
              setBrowseRequest({ question: browseRequest.question, colour });

            return (
              <div className="result-card browse-card">

                <div className="result-header">
                  <div>
                    <span className="result-label">SHOP EVERY STYLE</span>
                    <h2>“{browseRequest.question}”</h2>
                  </div>
                  <div className="ai-badge">
                    🛍️ {browseData.products.length} {browseData.products.length === 1 ? "pick" : "picks"}
                  </div>
                </div>

                {/* What OmniFit decided to do with the message, and the way to switch */}
                <p className="mode-switch">
                  <span>🛍️ Showing products</span>
                  <button type="button" onClick={askStylistInstead} disabled={sending}>
                    Style it instead
                  </button>
                </p>

                <div className="profile-bar">
                  {DEPARTMENT_NAMES[browseData.department] && (
                    <span className="profile-chip department">
                      {browseData.department_source === "question"
                        ? "✨ From your search: "
                        : "Shopping for: "}
                      <strong>{DEPARTMENT_NAMES[browseData.department]}</strong>
                    </span>
                  )}
                </div>

                {/* COLOUR CHIPS */}

                {browseData.colours?.length > 1 && (
                  <div className="colour-chips" role="group" aria-label="Colour">
                    <button
                      type="button"
                      className={`colour-chip ${activeColour === "all" ? "active" : ""}`}
                      aria-pressed={activeColour === "all"}
                      onClick={() => pickColour("all")}
                    >
                      All colours
                    </button>

                    {browseData.colours.map(({ colour, count }) => {
                      const swatch = getSwatchColor(colour);
                      return (
                        <button
                          type="button"
                          key={colour}
                          className={`colour-chip ${activeColour === colour ? "active" : ""}`}
                          aria-pressed={activeColour === colour}
                          onClick={() => pickColour(colour)}
                        >
                          {swatch && <span className="color-swatch" style={{ background: swatch }} />}
                          {colour}
                          <span className="colour-count">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* PRICE HINT */}

                {(budgetIsSet || browseData.price_range) && (
                  <div className="budget-insight">
                    {budgetIsSet ? (
                      <>
                        <span>
                          💰 Showing products for <strong>{describeBudget(budget)}</strong>
                        </span>
                        <button type="button" onClick={() => setBudget(NO_BUDGET)}>
                          Show all prices
                        </button>
                      </>
                    ) : (
                      <>
                        <span>
                          💡 Most cost{" "}
                          <strong>
                            {formatPrice(browseData.price_range.typical_low)} – {formatPrice(browseData.price_range.typical_high)}
                          </strong>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setBudget({
                              preset: "custom",
                              min: browseData.price_range.typical_low,
                              max: browseData.price_range.typical_high,
                            })
                          }
                        >
                          Use as my budget
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* PRODUCTS */}

                {browseData.products.length ? (
                  <div className={`product-list grid browse-grid ${browseLoading ? "refreshing" : ""}`}>
                    {browseData.products.map((product) => renderProductCard(product, "grid"))}
                  </div>
                ) : (
                  <p className="no-products">
                    {budgetIsSet
                      ? "No partner-brand match in your budget. Try the stores below."
                      : "No partner-brand match in this colour. Try the stores below."}
                  </p>
                )}

                {renderShopLinks(shopQuery, { startOpen: !browseData.products.length })}

                <button
                  type="button"
                  className="ask-stylist"
                  onClick={askStylistInstead}
                >
                  ✨ Ask the stylist how to wear these →
                </button>

              </div>
            );
          })()}


          {/* RESULT */}

          {recommendation && (

            <div className="result-card">

              <div className="result-header">

                <div>

                  <span className="result-label">
                    YOUR STYLE GUIDE
                  </span>

                  <h2>
                    {getResultTitle()}
                  </h2>

                </div>

                <div className="result-header-actions">
                  {canSpeak && (
                    <button
                      type="button"
                      className={`listen-button ${speaking ? "active" : ""}`}
                      onClick={toggleSpeaking}
                      aria-pressed={speaking}
                    >
                      {speaking ? "⏹ Stop" : "🔊 Listen"}
                    </button>
                  )}

                  <div className="ai-badge">
                    ✦ AI Stylist
                  </div>
                </div>

              </div>

              <p className="mode-switch">
                <span>✦ Styling your outfit</span>
                {productsQuery && (
                  <button type="button" onClick={() => browseColour(productsQuery)}>
                    Just show products
                  </button>
                )}
              </p>

              {/* SHOPPING PROFILE */}

              {recommendation.profile &&
                (recommendation.profile.department !== "unknown" ||
                  recommendation.profile.styles?.length > 0) && (

                <div className="profile-bar">

                  {DEPARTMENT_NAMES[recommendation.profile?.department] && (
                    <span className="profile-chip department">
                      {recommendation.profile.department_source === "detected"
                        ? `✨ Detected from your ${image ? "outfit" : "question"}: `
                        : "Shopping for: "}
                      <strong>{DEPARTMENT_NAMES[recommendation.profile.department]}</strong>

                      {recommendation.profile.department_source === "detected" && !changingSection && (
                        <button
                          type="button"
                          onClick={() => setChangingSection(true)}
                        >
                          Change
                        </button>
                      )}

                      {recommendation.profile.department_source === "detected" && changingSection &&
                        Object.keys(DEPARTMENT_NAMES)
                          .filter((value) => value !== recommendation.profile.department)
                          .map((value) => (
                            <button
                              type="button"
                              key={value}
                              disabled={sending}
                              onClick={() => changeSection(value)}
                            >
                              {DEPARTMENT_NAMES[value]}
                            </button>
                          ))}
                    </span>
                  )}

                  {recommendation.occasion && (
                    <span className="profile-chip occasion">
                      {OCCASION_ICONS[recommendation.occasion.id] || "✨"}{" "}
                      {[
                        occasions.find((item) => item.id === recommendation.occasion.id)?.label,
                        ...Object.values(recommendation.occasion.answers || {}),
                      ].filter(Boolean).join(" · ")}
                    </span>
                  )}

                  {recommendation.profile?.wardrobe_pieces > 0 && (
                    <span className="profile-chip occasion">
                      👕 Knows your wardrobe ({recommendation.profile.wardrobe_pieces} pieces)
                    </span>
                  )}

                  {recommendation.weather?.high != null && (
                    <span className="profile-chip weather">
                      {WEATHER_ICONS[recommendation.weather.rain ? "rain" : recommendation.weather.feel] || "🌤️"}{" "}
                      {recommendation.weather.high}°C{recommendation.weather.rain ? ", rain likely" : ""}: picked for the weather
                    </span>
                  )}

                  {recommendation.profile?.styles?.map((style) => (
                    <span className="profile-chip" key={style}>
                      {style.replace("-", " ")}
                    </span>
                  ))}

                </div>

              )}


              {/* WHY THIS: STYLE LIBRARY INFLUENCE */}

              {recommendation.profile?.personalized_with?.length > 0 && (
                <p className="why-note">
                  ✨ <strong>Why these?</strong> Personalised from your Style Library:{" "}
                  {recommendation.profile.personalized_with.join(", ").replace(/-/g, " ")}.{" "}
                  {personalizeOn && (
                    <button type="button" className="text-button" onClick={() => togglePersonalize(false)}>
                      Surprise me next time
                    </button>
                  )}
                </p>
              )}


              {/* WHAT OMNIFIT SAW IN THE PHOTO */}

              {recommendation.outfit_analysis?.visible_items?.length > 0 && (

                <div className="seen-panel">

                  <div className="seen-header">
                    <strong>👁️ What I see in your photo</strong>
                    {recommendation.outfit_analysis.overall_style && (
                      <span>{recommendation.outfit_analysis.overall_style}</span>
                    )}
                  </div>

                  <ul className="seen-items">
                    {recommendation.outfit_analysis.visible_items.map((seen, index) => (
                      <li key={`${seen.item}-${index}`}>
                        <span className="seen-item">{seen.item}</span>
                        <span className="seen-detail">
                          {[seen.color, seen.pattern !== "solid" ? seen.pattern : "", seen.fit]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {recommendation.colour_pairings?.length > 0 && (
                    <div className="colour-pairings">
                      <span className="pairings-label">🎨 Colours that go with your outfit</span>
                      <div className="pairings-chips">
                        {recommendation.colour_pairings.map((pairing) => {
                          const swatch = getSwatchColor(pairing.colour);
                          return (
                            <button
                              type="button"
                              key={pairing.query}
                              className="pairing-chip"
                              title={`Shop ${pairing.colour} ${pairing.item} in every style`}
                              onClick={() => browseColour(pairing.query)}
                            >
                              {swatch && <span className="color-swatch" style={{ background: swatch }} />}
                              {pairing.colour} {pairing.item}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="seen-hint">
                    Not quite right? Try a brighter photo with the whole outfit in frame.
                  </p>

                </div>

              )}


              {/* BUDGET INSIGHT */}

              {catalogAvailable && (budgetIsSet || priceRange) && (

                <div className="budget-insight">

                  {budgetIsSet ? (
                    <>
                      {lookBudget ? (
                        <span>
                          💰 Each look kept within <strong>{formatPrice(lookBudget)}</strong> in all.
                          Pieces you already have don't count.
                        </span>
                      ) : (
                        <span>
                          💰 Showing partner-brand products for{" "}
                          <strong>{describeBudget(budget)}</strong>
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => setBudget(NO_BUDGET)}
                      >
                        Show all prices
                      </button>
                    </>
                  ) : (
                    <>
                      <span>
                        💡 Most matching products cost{" "}
                        <strong>
                          {formatPrice(priceRange.typical_low)} – {formatPrice(priceRange.typical_high)}
                        </strong>
                      </span>

                      {/* A per-product range isn't a budget for a whole look */}
                      {recommendation.request_type === "item_options" && (
                        <button
                          type="button"
                          onClick={() =>
                            setBudget({
                              preset: "custom",
                              min: priceRange.typical_low,
                              max: priceRange.typical_high,
                            })
                          }
                        >
                          Use as my budget
                        </button>
                      )}
                    </>
                  )}

                </div>

              )}


              {/* -------------------------------- */}
              {/* ITEM OPTIONS */}
              {/* -------------------------------- */}

              {recommendation.request_type ===
                "item_options" && (

                <div className="option-grid">

                  {recommendation.recommendations.map(
                    (item, index) =>
                      renderItemOption(item, index)
                  )}

                </div>

              )}


              {/* -------------------------------- */}
              {/* COMPLETE OUTFITS */}
              {/* -------------------------------- */}

              {(
                recommendation.request_type ===
                  "complete_outfit" ||
                recommendation.request_type ===
                  "complete_outfits"
              ) && (

                <div className="outfit-list">

                  {recommendation.recommendations.map(
                    (outfit, index) =>
                      renderCompleteOutfit(
                        outfit,
                        index
                      )
                  )}

                </div>

              )}


              {/* SHOPPING NOTE */}

              {currentRegion && (
                <p className="shop-note">
                  🛍️{" "}
                  {catalogAvailable
                    ? "Product cards come from independent partner brands and are refreshed daily, so check the final price and size on the store. "
                    : ""}
                  "Search all stores" opens live results on marketplaces in{" "}
                  <strong>{currentRegion.name}</strong>. Change the region with
                  the 📍 menu at the top.
                </p>
              )}


            </div>

          )}

        </section>

        {/* "Shop the look" for one of the stylist's looks */}
        {boardSheet && (
          <ProductSheet
            look={boardSheet}
            formatPrice={formatPrice}
            onClose={() => setBoardSheet(null)}
            onSignal={(kind, look, extra) => {
              const store = look.pieces.find((piece) => piece.product.id === extra?.product_id)?.product.store;
              if (kind === "product_tap" && store) {
                recordStoreClick(store);
              }
            }}
            openCartPicker={openCartPicker}
          />
        )}
    </>
  );
}
