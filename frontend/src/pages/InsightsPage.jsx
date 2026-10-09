import { useEffect, useState } from "react";
import { api } from "../api";

const AUDIENCE_TITLES = {
  style: "Styles they like",
  colour: "Colours they like",
  price_band: "What they spend per piece",
  occasion: "What they dress for",
};

// Brand insights: what OmniFit's shoppers do with one partner brand's
// products. A developer page for now (dev builds, backend in dev mode on this
// computer); there are no retailer accounts yet.
export default function InsightsPage() {
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState("");
  const [state, setState] = useState({ status: "loading", data: null, error: "" });

  useEffect(() => {
    api("/api/dev/insights")
      .then((data) => {
        setStores(data.stores);
        setStoreId(data.stores[0]?.id || "");
        if (!data.stores.length) {
          setState({ status: "error", data: null, error: "The catalogue is empty. Run sync_catalog.py first." });
        }
      })
      .catch(() =>
        setState({
          status: "error",
          data: null,
          error: "Brand insights need the backend started with OMNIFIT_DEV_MODE=1, opened on this computer.",
        })
      );
  }, []);

  useEffect(() => {
    if (!storeId) {
      return undefined;
    }
    let cancelled = false;
    api(`/api/dev/insights/${encodeURIComponent(storeId)}`)
      .then((data) => !cancelled && setState({ status: "ready", data, error: "" }))
      .catch((error) => !cancelled && setState({ status: "error", data: null, error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const data = state.data;
  const widest = Math.max(1, ...(data?.funnel || []).map((stage) => stage.people));
  const audience = Object.entries(data?.audience || {}).filter(([, items]) => items.length);

  return (
    <section className="insights">
      <div className="foryou-header">
        <span className="eyebrow">📊 BRAND INSIGHTS · FOR PARTNER BRANDS</span>
        <h1>What shoppers do with your products</h1>
        <p className="insights-note">
          From signed-in shoppers' activity in the Home feed over the last {data?.days || 30} days. A number
          appears only when at least {data?.min_people || 3} different shoppers are behind it.
        </p>
      </div>

      {stores.length > 0 && (
        <label className="insights-pick">
          <span>Brand</span>
          <select
            className="voice-select"
            value={storeId}
            onChange={(event) => {
              setState({ status: "loading", data: null, error: "" });
              setStoreId(event.target.value);
            }}
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </label>
      )}

      {state.status === "loading" && <p className="cart-status"><span className="spinner dark small" /> Loading…</p>}
      {state.status === "error" && <p className="inline-error" role="alert">{state.error}</p>}

      {data && (
        <>
          {data.demo_shoppers > 0 && (
            <p className="insights-demo" role="note">
              Demo data: {data.demo_shoppers} of the {data.shoppers} shoppers counted here were made by
              seed_demo.py, not real people.
            </p>
          )}

          <div className="insights-tiles">
            <div className="insights-tile">
              <span>Products in the catalogue</span>
              <strong>{data.store.products.toLocaleString("en-IN")}</strong>
            </div>
            <div className="insights-tile">
              <span>In stock now</span>
              <strong>{data.store.in_stock.toLocaleString("en-IN")}</strong>
            </div>
            <div className="insights-tile">
              <span>Shoppers who saw your products</span>
              <strong>{data.enough ? data.shoppers.toLocaleString("en-IN") : `Fewer than ${data.min_people}`}</strong>
            </div>
          </div>

          <article className="insights-card">
            <h2>From seeing a look to the cart</h2>
            {data.enough ? (
              <>
                <table className="insights-funnel">
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">Shoppers</th>
                      <th scope="col">Times</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.funnel.map((stage) => (
                      <tr key={stage.stage} title={`${stage.label}: ${stage.people} shoppers, ${stage.events} times`}>
                        <th scope="row">
                          {stage.label}
                          <span className="insights-bar" aria-hidden="true">
                            {stage.people > 0 && <span style={{ width: `${(stage.people / widest) * 100}%` }} />}
                          </span>
                        </th>
                        <td>{stage.people.toLocaleString("en-IN")}</td>
                        <td>{stage.events.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="insights-foot">
                  Looks with your products were skipped {data.skips.toLocaleString("en-IN")} times. All steps except the
                  last are about a whole look, which may include other brands.
                </p>
              </>
            ) : (
              <p className="insights-empty">
                Not enough shoppers have seen looks with {data.store.name} products yet to show this.
              </p>
            )}
          </article>

          <article className="insights-card">
            <h2>Shoppers who like {data.store.name} also like</h2>
            {audience.length ? (
              <div className="insights-audience">
                {audience.map(([dimension, items]) => (
                  <div key={dimension}>
                    <h3>{AUDIENCE_TITLES[dimension]}</h3>
                    <ul>
                      {items.map((item) => (
                        <li key={item.value}>
                          <span>{item.label}</span>
                          <small>{item.people} shoppers</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="insights-empty">Not enough shoppers have a taste for this brand yet.</p>
            )}
          </article>

          <article className="insights-card">
            <h2>What shoppers want, and what you have in stock</h2>
            {data.demand.length ? (
              <table className="insights-demand">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Shoppers who like it</th>
                    <th scope="col">Your products in stock</th>
                  </tr>
                </thead>
                <tbody>
                  {data.demand.map((row) => (
                    <tr key={row.garment}>
                      <th scope="row">{row.label}</th>
                      <td>{row.people.toLocaleString("en-IN")}</td>
                      <td>
                        {row.in_stock.toLocaleString("en-IN")}
                        {row.in_stock === 0 && <span className="insights-gap">Not in your range</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="insights-empty">Not enough shoppers yet to show what's in demand.</p>
            )}
            <p className="insights-foot">
              Demand is across all of OmniFit, not only your shoppers. Stock is counted by the item named in each
              product's title, so it is approximate.
            </p>
          </article>
        </>
      )}
    </section>
  );
}
