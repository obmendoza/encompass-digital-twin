const BTNS = ["Pipeline", "Open", "Save", "Print", "Conditions", "Log", "eFolder", "AUS"];
export function Toolbar() {
  return (
    <div className="bg-[#ece9d8] border-b border-[#9aa0a8] px-2 py-[2px] flex gap-1">
      {BTNS.map((b) => (
        <button key={b} className="enc-btn">{b}</button>
      ))}
    </div>
  );
}
