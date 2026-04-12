import Link from "next/link";

interface Tab {
  label: string;
  href: string;
}

export function TabBar({ tabs, activeLabel }: { tabs: Tab[]; activeLabel: string }) {
  return (
    <div className="flex gap-[2px] border-b-2 border-[#1f4478] mb-1">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href}
          className={`px-3 py-[2px] border border-b-0 border-[#6b7a8f] text-[10px] no-underline ${
            t.label === activeLabel
              ? "bg-white font-bold text-black"
              : "bg-[#d4d0c8] text-black hover:bg-[#e2ddc7]"
          }`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
