"use client";

import { useState } from "react";

export function DemoBanner() {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div className="mb-2 border-2 border-[#0a52a0] bg-gradient-to-r from-[#e8f0fe] to-[#f0f5ff] p-3 relative">
      <button
        onClick={() => setVisible(false)}
        className="absolute top-1 right-2 text-[#6b7a8f] hover:text-[#0a52a0] text-[14px]"
      >
        ×
      </button>

      <div className="text-[13px] font-bold text-[#0a52a0] mb-2">
        Welcome to the Encompass Digital Twin
      </div>

      <div className="grid grid-cols-4 gap-3 text-[10px]">
        <div className="bg-white rounded p-2 border border-[#c8c4b5]">
          <div className="font-bold text-[#1f4478] mb-1">1. Browse Loans</div>
          <div className="text-[#404040]">20 NQM scenarios in the Pipeline. Click any loan to open the underwriting cockpit.</div>
        </div>
        <div className="bg-white rounded p-2 border border-[#c8c4b5]">
          <div className="font-bold text-[#1f4478] mb-1">2. Run AI Agent</div>
          <div className="text-[#404040]">Click "Multi-Agent (5 specialists)" on the Transmittal page. Watch the live activity feed.</div>
        </div>
        <div className="bg-white rounded p-2 border border-[#c8c4b5]">
          <div className="font-bold text-[#1f4478] mb-1">3. Review &amp; Decide</div>
          <div className="text-[#404040]">See the AI Underwriting Report. Accept, override, or send back to the VA.</div>
        </div>
        <div className="bg-white rounded p-2 border border-[#c8c4b5]">
          <div className="font-bold text-[#1f4478] mb-1">4. Explore</div>
          <div className="text-[#404040]">Workshop to generate scenarios. eFolder for documents. Metrics for analytics.</div>
        </div>
      </div>

      <div className="mt-2 flex gap-2">
        <a href="/workshop" className="enc-btn enc-btn--primary text-[10px] no-underline text-black">Open Workshop</a>
        <a href="/va" className="enc-btn text-[10px] no-underline text-black">VA Dashboard</a>
        <span className="text-[9px] text-[#6b7a8f] ml-auto mt-1">Dismiss this guide →</span>
      </div>
    </div>
  );
}
