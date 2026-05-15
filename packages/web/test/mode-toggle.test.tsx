import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ModeToggle } from "@/components/encompass/ModeToggle";

describe("ModeToggle", () => {
  afterEach(() => cleanup());

  it("renders two segments and marks the active mode", () => {
    render(<ModeToggle currentMode="curation" basePath="/loan/L-1/transmittal" currentFilter={null} />);
    const curationLink = screen.getByRole("link", { name: /curation/i });
    const driftLink = screen.getByRole("link", { name: /drift/i });
    expect(curationLink).toHaveAttribute("aria-current", "page");
    expect(driftLink).not.toHaveAttribute("aria-current");
  });

  it("Curation link drops ?filter to avoid carrying disagreement filter into Curation", () => {
    render(<ModeToggle currentMode="drift" basePath="/loan/L-1/transmittal" currentFilter="disagreements" />);
    const curationLink = screen.getByRole("link", { name: /curation/i });
    expect(curationLink.getAttribute("href")).toMatch(/\?view=curation$/);
    expect(curationLink.getAttribute("href")).not.toContain("filter=");
  });

  it("Drift link preserves ?filter if currentFilter is set", () => {
    render(<ModeToggle currentMode="curation" basePath="/loan/L-1/transmittal" currentFilter="disagreements" />);
    const driftLink = screen.getByRole("link", { name: /drift/i });
    expect(driftLink.getAttribute("href")).toContain("view=drift");
    expect(driftLink.getAttribute("href")).toContain("filter=disagreements");
  });

  it("Drift link without filter omits filter param", () => {
    render(<ModeToggle currentMode="curation" basePath="/loan/L-1/transmittal" currentFilter={null} />);
    const driftLink = screen.getByRole("link", { name: /drift/i });
    expect(driftLink.getAttribute("href")).toMatch(/\?view=drift$/);
  });
});
