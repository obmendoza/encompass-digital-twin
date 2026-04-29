import { NextRequest, NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const resp = await fetch(`${AGENT_URL}/api/guidelines/ingest`, {
    method: "POST",
    body: formData,
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
