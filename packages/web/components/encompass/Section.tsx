import type { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="enc-sec">
      <h4>{title}</h4>
      <div className="enc-grid-8">{children}</div>
    </div>
  );
}
