import { NextResponse } from "next/server";

const API = process.env.TWIN_API_URL ?? "http://127.0.0.1:4000";

export async function GET() {
  try {
    const res = await fetch(`${API}/system/health`, { cache: "no-store" });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ api: "error", loans: 0, auditLog: 0, timestamp: new Date().toISOString() }, { status: 502 });
  }
}
