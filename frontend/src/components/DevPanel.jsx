import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import "./DevPanel.css";

// "Behind the scenes": what the backend did for each request (Gemma calls,
// catalogue searches, Intent Engine, weather, streamed chat events), live.
// Dev builds only, and only when the backend runs with OMNIFIT_DEV_MODE=1 on
// this computer; the backend refuses these requests through the tunnel.

const KINDS = {
  gemma: { label: "Gemma (AI)", icon: "✦" },
  catalog: { label: "Catalogue", icon: "🛍" },
  intent: { label: "Intent Engine", icon: "🎯" },
  context: { label: "Context", icon: "🌦" },
  memory: { label: "Memory", icon: "🧠" },
  voice: { label: "Voice", icon: "🎙" },
  stream: { label: "To the page", icon: "→" },
};
const POLL_MS = 1500;
const SHOWN = 25;

function formatValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(" · ");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => {
        const text = formatValue(item);
        return text ? `${key}: ${text}` : null;
      })
      .filter(Boolean)
      .join("; ");
  }
  return String(value);
}

function Trace({ trace }) {
  const total = Math.max(trace.ms || 1, 1);
  return (
    <article className="dev-trace">
      <header>
        <strong>
          {trace.method} {trace.path}
        </strong>
        <span className={trace.status >= 400 ? "bad" : ""}>{trace.status ?? "…"}</span>
        <span>{trace.ms ? `${(trace.ms / 1000).toFixed(2)} s` : "running"}</span>
      </header>
      {(trace.persona || trace.dev_date) && (
        <p className="dev-meta">
          {trace.persona && <>👤 {trace.persona} </>}
          {trace.dev_date && <>📅 test date {trace.dev_date}</>}
        </p>
      )}

      <div className="dev-bar" aria-hidden="true">
        {trace.steps
          .filter((step) => step.ms)
          .map((step, index) => (
            <span
              key={index}
              className={`k-${step.kind}`}
              style={{
                left: `${(step.at_ms / total) * 100}%`,
                width: `${Math.max((step.ms / total) * 100, 0.8)}%`,
              }}
              title={`${step.label}: ${step.ms} ms`}
            />
          ))}
      </div>

      <ol className="dev-steps">
        {trace.steps.map((step, index) => {
          const detail = formatValue(step.data);
          return (
            <li key={index} className={`k-${step.kind}`}>
              <span className="dev-icon">{KINDS[step.kind]?.icon || "•"}</span>
              <div>
                <p>
                  {step.label}
                  {step.ms !== null && <em>{step.ms >= 1000 ? `${(step.ms / 1000).toFixed(1)} s` : `${step.ms} ms`}</em>}
                </p>
                {detail && <small>{detail}</small>}
              </div>
            </li>
          );
        })}
        {!trace.steps.length && <li className="dev-empty">No backend steps (served directly)</li>}
      </ol>
    </article>
  );
}

export default function DevPanel() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [traces, setTraces] = useState([]);
  const [hideBefore, setHideBefore] = useState(0);
  const lastId = useRef(0);

  useEffect(() => {
    api("/api/dev/status")
      .then(() => setEnabled(true))
      .catch(() => setEnabled(false));
  }, []);

  const poll = useCallback(async () => {
    try {
      const { traces: fresh } = await api(`/api/dev/trace?since=${Math.max(lastId.current - SHOWN, 0)}`);
      if (fresh.length) {
        lastId.current = fresh.at(-1).id;
        // Newest first; running requests are re-fetched until they finish
        setTraces((current) => {
          const byId = new Map(current.map((trace) => [trace.id, trace]));
          fresh.forEach((trace) => byId.set(trace.id, trace));
          return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, SHOWN * 2);
        });
      }
    } catch {
      // The backend restarted or dev mode was turned off
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const first = setTimeout(poll, 0);
    const timer = setInterval(poll, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [open, poll]);

  if (!enabled) return null;

  const shown = traces.filter((trace) => trace.id > hideBefore).slice(0, SHOWN);

  return (
    <>
      <button
        type="button"
        className={`dev-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        ⚙ Behind the scenes
      </button>

      {open && (
        <aside className="dev-panel" aria-label="Behind the scenes">
          <header className="dev-panel-head">
            <div>
              <h2>Behind the scenes</h2>
              <p>What the backend does for every tap, live. Dev mode only.</p>
            </div>
            <div className="dev-actions">
              <button type="button" onClick={() => { window.location.hash = "#insights"; setOpen(false); }}>
                📊 Brand insights
              </button>
              <button type="button" onClick={() => setHideBefore(traces[0]?.id || 0)}>
                Clear
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
          </header>

          <div className="dev-legend">
            {Object.entries(KINDS).map(([kind, { label, icon }]) => (
              <span key={kind} className={`k-${kind}`}>
                {icon} {label}
              </span>
            ))}
          </div>

          <div className="dev-list">
            {shown.length ? (
              shown.map((trace) => <Trace key={trace.id} trace={trace} />)
            ) : (
              <p className="dev-empty">Use the app: each request appears here with its steps and timings.</p>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
