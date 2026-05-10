import { actionSetBpoToken } from "./actions";

export default async function BpoLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const errorMsg = sp.error === "missing" ? "Token is required" : null;
  return (
    <div className="enc-panel max-w-[420px] mx-auto mt-8">
      <h2 className="text-[16px] font-bold text-[#1a2b4a] mb-3">BPO SME Sign In</h2>
      <p className="text-[11px] text-[#6b7a8f] mb-3">
        Enter the API token issued for your engagement. Tokens are scoped to a single tenant.
      </p>
      <form action={actionSetBpoToken}>
        <input
          name="token"
          type="password"
          autoComplete="off"
          placeholder="API token"
          className="enc-input w-full mb-2"
          required
        />
        {errorMsg && <div className="text-[11px] text-[#c00] mb-2">{errorMsg}</div>}
        <button type="submit" className="enc-btn enc-btn--primary w-full">
          Sign In
        </button>
      </form>
    </div>
  );
}
