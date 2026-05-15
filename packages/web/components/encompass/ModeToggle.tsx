import Link from "next/link";

interface Props {
  currentMode: "curation" | "drift";
  basePath: string;
  currentFilter: string | null;
}

export function ModeToggle({ currentMode, basePath, currentFilter }: Props): JSX.Element {
  const curationHref = `${basePath}?view=curation`;
  const driftHref = currentFilter
    ? `${basePath}?view=drift&filter=${encodeURIComponent(currentFilter)}`
    : `${basePath}?view=drift`;

  const segmentClass = (active: boolean): string =>
    `px-3 py-1 text-[11px] font-bold ${
      active
        ? "bg-[#1f4478] text-white"
        : "bg-white text-[#1a2b4a] border border-[#6b7a8f]"
    }`;

  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[11px] font-bold text-[#1a2b4a]">View:</span>
      <Link
        href={curationHref}
        className={segmentClass(currentMode === "curation")}
        aria-current={currentMode === "curation" ? "page" : undefined}
      >
        Curation
      </Link>
      <Link
        href={driftHref}
        className={segmentClass(currentMode === "drift")}
        aria-current={currentMode === "drift" ? "page" : undefined}
      >
        Drift
      </Link>
    </div>
  );
}
