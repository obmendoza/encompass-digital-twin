import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Encompass Digital Twin — NQM Underwriting Platform",
  description: "AI-powered digital twin for Non-Qualified Mortgage underwriting",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
