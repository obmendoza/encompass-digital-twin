import Link from "next/link";

const BTNS = ["Open", "Save", "Print", "Conditions", "Log", "eFolder", "AUS"];
export function Toolbar() {
  return (
    <div className="bg-[#ece9d8] border-b border-[#9aa0a8] px-2 py-[2px] flex gap-1">
      <Link href="/" className="enc-btn font-bold">Pipeline</Link>
      {BTNS.map((b) => (
        <button key={b} className="enc-btn">{b}</button>
      ))}
    </div>
  );
}
