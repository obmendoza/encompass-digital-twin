import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "documents";
const memStore = new Map<string, { buffer: Buffer; mimeType: string; originalName: string }>();

let sbClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  if (!sbClient) {
    sbClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return sbClient;
}

export async function saveFile(
  key: string,
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): Promise<string> {
  const sb = getSupabase();
  if (sb) {
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(key, buffer, { contentType: mimeType, upsert: true });
    if (!error) {
      const { data } = sb.storage.from(BUCKET).getPublicUrl(key);
      return data.publicUrl;
    }
    console.error("[file-store] Supabase upload failed, using memory:", error.message);
  }
  memStore.set(key, { buffer, mimeType, originalName });
  return `/uploads/${key}`;
}

export async function getFile(
  key: string,
): Promise<{ buffer: Buffer; mimeType: string; originalName: string } | undefined> {
  // Check memory first (covers fallback uploads)
  const mem = memStore.get(key);
  if (mem) return mem;

  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb.storage.from(BUCKET).download(key);
      if (!error && data) {
        const buffer = Buffer.from(await data.arrayBuffer());
        return { buffer, mimeType: data.type || "application/octet-stream", originalName: key };
      }
    } catch {
      // fall through to undefined
    }
  }
  return undefined;
}

export function deleteFile(key: string): boolean {
  return memStore.delete(key);
}

export function generateKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
