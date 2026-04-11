const GROUPS: Array<{ title: string; items: string[] }> = [
  { title: "Loan", items: ["Borrower Summary", "Alerts & Messages"] },
  { title: "Forms", items: ["1003 Page 1", "1003 Page 2", "1003 Page 3", "Transmittal Summary", "URLA – Additional", "GFE", "HUD-1"] },
  { title: "Tools", items: ["Conditions", "Conversation Log", "AUS Tracking"] },
  { title: "Services", items: ["Credit", "AUS (DU / LPA)", "Product & Pricing"] },
];

export function NavTree({ activeItem = "Transmittal Summary" }: { activeItem?: string }) {
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
                {i}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
