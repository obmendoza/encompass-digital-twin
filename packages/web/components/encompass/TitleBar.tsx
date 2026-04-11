export function TitleBar({ scenarioId }: { scenarioId: string | null }) {
  return (
    <div className="bg-gradient-to-b from-[#0a52a0] to-[#07305e] text-white px-2 py-1 text-[11px] font-bold flex justify-between border-b border-black">
      <span>Encompass360 — Underwriting (Digital Twin)</span>
      <span>{scenarioId ?? "— no scenario —"}</span>
    </div>
  );
}
