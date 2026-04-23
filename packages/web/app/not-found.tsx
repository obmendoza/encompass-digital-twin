import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#ece9d8] flex items-center justify-center">
      <div className="border border-[#6b7a8f] bg-white w-[400px] text-center">
        <div className="bg-gradient-to-b from-[#0a52a0] to-[#07305e] text-white px-4 py-3">
          <div className="text-[14px] font-bold">Page Not Found</div>
        </div>
        <div className="p-6">
          <div className="text-[40px] mb-2">🏠</div>
          <div className="text-[11px] text-[#404040] mb-4">
            The page you&apos;re looking for doesn&apos;t exist or the loan may have been reset.
          </div>
          <Link href="/" className="enc-btn enc-btn--primary no-underline text-black">
            Back to Pipeline
          </Link>
        </div>
      </div>
    </div>
  );
}
