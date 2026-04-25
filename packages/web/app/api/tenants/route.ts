import { NextResponse } from "next/server";

export async function GET() {
  const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
  try {
    const res = await fetch(`${apiUrl}/tenants`, {
      headers: { "x-super-admin": "true", "x-user-id": "system" },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json([], { status: res.status });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
