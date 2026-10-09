import { useOmniFit } from "../app/context";

// Try-On: step (i-plan) adds the live AR overlay here. Until then it offers
// the camera features that already exist.
export default function TryOnPage() {
  const { setStyleScan, openBodyScan } = useOmniFit();

  return (
    <section className="dna">
      <div className="dna-hero">
        <span className="eyebrow">🪞 TRY-ON</span>
        <h1>See it on you</h1>
        <p>
          Live try-on (the outfit following you on camera, right on your phone) is being built next.
          Meanwhile, let the AI match accessories, colours and sizes to you.
        </p>
        <div className="dna-actions">
          <button type="button" className="primary-button" onClick={() => setStyleScan({ status: "consent" })}>
            ✨ Style Scan
          </button>
          <button type="button" className="primary-button" onClick={openBodyScan}>
            📏 Body Scan
          </button>
        </div>
      </div>
    </section>
  );
}
