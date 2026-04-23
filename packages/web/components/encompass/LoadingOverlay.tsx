"use client";

export function LoadingOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white border-2 border-[#0a52a0] rounded p-6 text-center max-w-[300px]">
        <div className="relative mx-auto w-[40px] h-[40px] mb-3">
          <div className="absolute inset-0 border-4 border-[#e0dfdb] rounded-full" />
          <div className="absolute inset-0 border-4 border-t-[#0a52a0] rounded-full animate-spin" />
        </div>
        <div className="text-[12px] font-bold text-[#1f4478]">{message}</div>
        <div className="text-[10px] text-[#6b7a8f] mt-1">Please wait...</div>
      </div>
    </div>
  );
}
