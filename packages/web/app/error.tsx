"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen bg-[#ece9d8] flex items-center justify-center">
      <div className="border border-[#6b7a8f] bg-white w-[500px]">
        <div className="bg-gradient-to-b from-[#8a0000] to-[#5a0000] text-white px-4 py-2">
          <div className="text-[12px] font-bold">Application Error</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] mb-3 text-[#404040]">
            Something went wrong. This error has been logged.
          </div>
          <div className="text-[10px] bg-[#f5f3e8] p-2 border border-[#c8c4b5] mb-3 font-mono break-all">
            {error.message}
          </div>
          <div className="flex gap-2">
            <button onClick={reset} className="enc-btn enc-btn--primary">Try Again</button>
            <a href="/" className="enc-btn no-underline text-black">Back to Pipeline</a>
          </div>
        </div>
      </div>
    </div>
  );
}
