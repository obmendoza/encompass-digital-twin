import { NextRequest, NextResponse } from "next/server";

const apiUrl = process.env.API_URL ?? process.env.TWIN_API_URL ?? "http://127.0.0.1:4000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${apiUrl}/onboarding`, {
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
  } catch (e) {
    return NextResponse.json({ error: "Failed to create onboarding" }, { status: 500 });
  }
}
