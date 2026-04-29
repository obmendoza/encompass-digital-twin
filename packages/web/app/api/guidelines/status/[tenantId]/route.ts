import { NextRequest, NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8000";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const resp = await fetch(`${AGENT_URL}/api/guidelines/status/${tenantId}`);
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
