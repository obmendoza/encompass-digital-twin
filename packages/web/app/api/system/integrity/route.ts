import { NextResponse } from "next/server";

const API = process.env.TWIN_API_URL ?? "http://127.0.0.1:4000";

export async function GET() {
  try {
    const res = await fetch(`${API}/system/integrity`, { cache: "no-store" });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "API unavailable" }, { status: 502 });
  }
}
