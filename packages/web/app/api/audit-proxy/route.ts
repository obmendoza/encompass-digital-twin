import { NextRequest, NextResponse } from "next/server";

const TWIN_API = process.env.TWIN_API_URL ?? "http://127.0.0.1:4000";

export async function GET(req: NextRequest) {
  const loanId = req.nextUrl.searchParams.get("loanId");
  if (!loanId) return NextResponse.json([], { status: 400 });

  try {
    const res = await fetch(`${TWIN_API}/loans/${loanId}/audit`, {
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json([], { status: res.status });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
