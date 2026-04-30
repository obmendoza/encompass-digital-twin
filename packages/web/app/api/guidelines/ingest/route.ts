import { NextRequest, NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8000";

// Ingestion can take 5-10 minutes for large PDFs (matrix extraction with multi-turn Claude Vision)
export const maxDuration = 600; // 10 minutes

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  try {
    const resp = await fetch(`${AGENT_URL}/api/guidelines/ingest`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(600_000), // 10 min timeout
    });
    const text = await resp.text();
    if (!text) {
      return NextResponse.json(
        { error: "Empty response from agent service" },
        { status: 502 }
      );
    }
    const data = JSON.parse(text);
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Ingestion proxy failed: ${message}` },
      { status: 502 }
    );
  }
}
