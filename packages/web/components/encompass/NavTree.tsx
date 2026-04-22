"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const GROUPS: Array<{ title: string; items: string[] }> = [
  { title: "Loan", items: ["Borrower Summary", "Alerts & Messages"] },
  { title: "Forms", items: ["1003 Page 1", "1003 Page 2", "1003 Page 3", "Transmittal Summary", "URLA – Additional", "GFE", "HUD-1"] },
  { title: "Tools", items: ["Income Analysis", "Conditions", "Conversation Log", "AUS Tracking", "Compliance", "Program Overlays"] },
  { title: "Services", items: ["eFolder", "Credit", "AUS (DU / LPA)", "Product & Pricing", "Appraisal"] },
];

const LINKS: Record<string, (loanId: string) => string> = {
  "Income Analysis": (id) => `/loan/${id}/income`,
  "1003 Page 1": (id) => `/loan/${id}/1003/page1`,
  "1003 Page 2": (id) => `/loan/${id}/1003/page2`,
  "1003 Page 3": (id) => `/loan/${id}/1003/page3`,
  "Transmittal Summary": (id) => `/loan/${id}/transmittal`,
  "eFolder": (id) => `/loan/${id}/efolder`,
  "Credit": (id) => `/loan/${id}/credit`,
  "Appraisal": (id) => `/loan/${id}/appraisal`,
  "Compliance": (id) => `/loan/${id}/compliance`,
  "Program Overlays": (id) => `/loan/${id}/overlays`,
  "Conversation Log": (id) => `/loan/${id}/log`,
  "Conditions": (id) => `/loan/${id}/conditions`,
};

function deriveActiveItem(pathname: string): string {
  if (pathname.endsWith("/transmittal")) return "Transmittal Summary";
  if (pathname.endsWith("/1003/page1")) return "1003 Page 1";
  if (pathname.endsWith("/1003/page2")) return "1003 Page 2";
  if (pathname.endsWith("/1003/page3")) return "1003 Page 3";
  if (pathname.endsWith("/income")) return "Income Analysis";
  if (pathname.endsWith("/efolder")) return "eFolder";
  if (pathname.endsWith("/credit")) return "Credit";
  if (pathname.endsWith("/appraisal")) return "Appraisal";
  if (pathname.endsWith("/compliance")) return "Compliance";
  if (pathname.endsWith("/log")) return "Conversation Log";
  if (pathname.endsWith("/overlays")) return "Program Overlays";
  if (pathname.endsWith("/conditions")) return "Conditions";
  return "Transmittal Summary";
}

export function NavTree({ loanId }: { loanId: string }) {
  const pathname = usePathname();
  const activeItem = deriveActiveItem(pathname);

  return (
    <div className="bg-white border-r border-[#6b7a8f] text-[10px] w-[172px]">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="bg-gradient-to-b from-[#e2ddc7] to-[#cfc9ae] font-bold px-2 py-[2px] border-y border-[#6b7a8f]">{g.title}</div>
          <ul className="m-0 p-0 list-none">
            {g.items.map((i) => (
              <li key={i}
                  className={"pl-4 pr-2 py-[1px] border-b border-dotted border-[#dcd7c0] cursor-pointer " +
                    (i === activeItem ? "bg-[#316ac5] text-white" : "")}>
                {LINKS[i] ? (
                  <Link href={LINKS[i]!(loanId)} className="block w-full h-full no-underline text-inherit hover:underline">
                    {i}
                  </Link>
                ) : (
                  i
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
