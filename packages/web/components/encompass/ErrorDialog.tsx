"use client";

export function ErrorDialog({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-[#ece9d8] border border-[#6b7a8f] w-[380px]">
        <div className="bg-gradient-to-b from-[#0a52a0] to-[#07305e] text-white px-2 py-1 text-[11px] font-bold">
          Error
        </div>
        <div className="p-3 text-[11px]">{message}</div>
        <div className="p-2 text-right">
          <button className="enc-btn" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}
