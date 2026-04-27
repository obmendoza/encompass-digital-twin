import { NextRequest, NextResponse } from "next/server";

const apiUrl = process.env.API_URL ?? process.env.TWIN_API_URL ?? "http://127.0.0.1:4000";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  try {
    const body = await request.json();
    const res = await fetch(`${apiUrl}/onboarding/${tenantId}/extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-super-admin": "true",
        "x-user-id": "admin",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }
}
