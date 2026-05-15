import Link from "next/link";

interface Props {
  disagreementCount: number;
  programs: Array<{ program: string; portalStatus: string; pcV2Status: string }>;
  basePath: string;
}

export function EligibilityDriftBanner({ disagreementCount, programs, basePath }: Props): JSX.Element | null {
  if (disagreementCount === 0) return null;
  return (
    <div className="mb-2 p-2 border-l-4 border-[#8a4b00] bg-[#fff4e6] text-[11px]">
      <div className="font-bold text-[#8a4b00]">
        ⚠ Eligibility drift suspected for {disagreementCount} program{disagreementCount > 1 ? "s" : ""} (heuristic match)
      </div>
      <div className="mt-1">
        {programs.map((p) => p.program).join(" · ")}
      </div>
      <Link
        href={`${basePath}?view=drift&filter=disagreements`}
        className="text-[#1f4478] underline mt-1 inline-block"
      >
        Open in Drift mode to verify
      </Link>
    </div>
  );
}
