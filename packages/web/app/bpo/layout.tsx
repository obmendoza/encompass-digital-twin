import type { ReactNode } from "react";

export const metadata = { title: "UAS BPO Portal" };

// Note: Next.js App Router only permits <html>/<body> in the ROOT layout
// (app/layout.tsx). Nested layouts must render plain elements. We supply
// distinct chrome via a wrapper div — visually separate from the internal
// app — and the root layout still provides html/body.
export default function BpoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f3e8]">
      <header className="bg-[#0a3060] text-white px-4 py-2 flex items-center gap-3">
        <span className="text-[14px] font-bold">UAS BPO Portal</span>
        <span className="text-[10px] px-2 py-[1px] bg-white/20 rounded uppercase tracking-wider">
          BPO SME
        </span>
        <span className="ml-auto text-[11px] opacity-70">
          External partner — limited access
        </span>
      </header>
      <main className="p-4 max-w-[1200px] mx-auto">{children}</main>
    </div>
  );
}
