"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setError(error.message); setLoading(false); return; }
    }

    router.push("/");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#ece9d8] flex items-center justify-center">
      <div className="border border-[#6b7a8f] bg-white w-[400px]">
        <div className="bg-gradient-to-b from-[#0a52a0] to-[#07305e] text-white px-4 py-3">
          <div className="text-[14px] font-bold">Encompass Digital Twin</div>
          <div className="text-[11px] opacity-80">NQM Underwriting Platform</div>
        </div>

        <form onSubmit={handleSubmit} className="p-4">
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              className={`flex-1 py-1 text-[11px] font-bold border ${mode === "login" ? "bg-[#0a52a0] text-white border-[#0a52a0]" : "bg-white text-[#0a52a0] border-[#6b7a8f]"}`}
              onClick={() => setMode("login")}
            >Sign In</button>
            <button
              type="button"
              className={`flex-1 py-1 text-[11px] font-bold border ${mode === "signup" ? "bg-[#0a52a0] text-white border-[#0a52a0]" : "bg-white text-[#0a52a0] border-[#6b7a8f]"}`}
              onClick={() => setMode("signup")}
            >Register</button>
          </div>

          <div className="mb-3">
            <label className="block text-[10px] text-[#404040] mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-[#7f9db9] px-2 py-1 text-[11px]"
              required
            />
          </div>

          <div className="mb-3">
            <label className="block text-[10px] text-[#404040] mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-[#7f9db9] px-2 py-1 text-[11px]"
              required
              minLength={6}
            />
          </div>

          {error && (
            <div className="mb-3 text-[10px] text-[#c00] bg-[#fef0f0] border border-[#c00] p-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full enc-btn enc-btn--primary py-2 text-[12px]"
          >
            {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>

          <div className="mt-3 text-center text-[9px] text-[#6b7a8f]">
            {mode === "login"
              ? "New users are assigned the Demo role by default."
              : "After registration, an admin can upgrade your role to VA or UW."}
          </div>
        </form>
      </div>
    </div>
  );
}
