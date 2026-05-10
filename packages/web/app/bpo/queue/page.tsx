import Link from "next/link";
import { redirect } from "next/navigation";
import { bpoApi } from "@/lib/bpo-client";

export const dynamic = "force-dynamic";

export default async function BpoQueue() {
  let auth;
  try {
    auth = await bpoApi.auth();
  } catch {
    redirect("/bpo/login");
  }

  let queue;
  try {
    queue = await bpoApi.getQueue();
  } catch (e: unknown) {
    return (
      <div className="enc-panel">
        <h2 className="text-[14px] font-bold text-[#1a2b4a]">Queue Error</h2>
        <p className="text-[11px] text-[#c00]">
          {e instanceof Error ? e.message : "Failed to fetch queue"}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="enc-panel mb-3">
        <div className="text-[11px] text-[#6b7a8f]">
          Signed in as <b>{auth.smeName}</b> ({auth.smeId}) · partner {auth.partnerId} · tenant{" "}
          {auth.tenantId}
        </div>
      </div>

      <div className="enc-sec">
        <h4>Loans Awaiting Your Review ({queue.items.length})</h4>
        {queue.items.length === 0 ? (
          <p className="p-2 text-[11px] text-[#6b7a8f]">Queue empty.</p>
        ) : (
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-[#d4d0c8] text-left">
                <th className="px-2 py-1 border-b border-[#6b7a8f]">Loan</th>
                <th className="px-2 py-1 border-b border-[#6b7a8f]">Pool</th>
                <th className="px-2 py-1 border-b border-[#6b7a8f]">Action</th>
              </tr>
            </thead>
            <tbody>
              {queue.items.map((r) => (
                <tr key={r.loan_id} className="border-b border-[#c8c4b5]">
                  <td className="px-2 py-1">{r.loan_id}</td>
                  <td className="px-2 py-1 text-[#6b7a8f]">{r.assigned_pool_id.slice(0, 8)}…</td>
                  <td className="px-2 py-1">
                    <Link href={`/bpo/loans/${r.loan_id}/review`} className="enc-btn">
                      Claim &amp; Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
