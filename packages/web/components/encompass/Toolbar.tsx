import Link from "next/link";

const BTNS = ["Open", "Save", "Print", "Conditions", "Log", "eFolder", "AUS"];

export function Toolbar({ userRole }: { userRole?: string }) {
  return (
    <div className="bg-[#ece9d8] border-b border-[#9aa0a8] px-2 py-[2px] flex gap-1">
      <Link href="/" className="enc-btn font-bold">Pipeline</Link>
      {(!userRole || ["demo", "va", "uw", "admin"].includes(userRole)) && (
        <Link href="/workshop" className="enc-btn">Workshop</Link>
      )}
      {(!userRole || ["va", "uw", "admin"].includes(userRole)) && (
        <Link href="/hitl" className="enc-btn">HITL Inbox</Link>
      )}
      {userRole && ["va", "uw", "admin"].includes(userRole) && (
        <Link href="/va" className="enc-btn">VA Dashboard</Link>
      )}
      {userRole && ["va", "uw", "admin"].includes(userRole) && (
        <Link href="/metrics" className="enc-btn">Metrics</Link>
      )}
      {userRole && ["uw", "admin"].includes(userRole) && (
        <Link href="/uw" className="enc-btn font-bold text-[#1f4478]">UW Queue</Link>
      )}
      {userRole === "admin" && (
        <Link href="/admin" className="enc-btn font-bold text-[#8a0000]">Admin</Link>
      )}
      {BTNS.map((b) => (
        <button key={b} className="enc-btn">{b}</button>
      ))}
    </div>
  );
}
