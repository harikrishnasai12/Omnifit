import { useOmniFit } from "../app/context";
import ResultsPanel from "../components/ResultsPanel";

// The conversation with the AI stylist: thread, the active answer, composer.
// (Step d turns this into the Stylist orb, available on every screen.)
export default function StylistPage() {
  const { renderChatThread, renderComposer } = useOmniFit();

  return (
    <>
      {renderChatThread()}
      <ResultsPanel />
      {renderComposer()}
    </>
  );
}
