import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL || "http://localhost:4000";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const resp = await fetch(`${API_URL}/onboarding/${tenantId}/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-super-admin": "true",
      "x-user-id": "admin",
    },
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
