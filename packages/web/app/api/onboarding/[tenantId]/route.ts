import { NextRequest, NextResponse } from "next/server";

const apiUrl = process.env.API_URL ?? process.env.TWIN_API_URL ?? "http://127.0.0.1:4000";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  try {
    const res = await fetch(`${apiUrl}/onboarding/${tenantId}`, {
      headers: { "x-super-admin": "true", "x-user-id": "admin" },
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  try {
    const body = await request.json();
    const ifMatch = request.headers.get("if-match") ?? "1";
    const res = await fetch(`${apiUrl}/onboarding/${tenantId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": ifMatch,
        "x-super-admin": "true",
        "x-user-id": "admin",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
  }
}
