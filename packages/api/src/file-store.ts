const store = new Map<string, { buffer: Buffer; mimeType: string; originalName: string }>();

export function saveFile(key: string, buffer: Buffer, mimeType: string, originalName: string): void {
  store.set(key, { buffer, mimeType, originalName });
}

export function getFile(key: string): { buffer: Buffer; mimeType: string; originalName: string } | undefined {
  return store.get(key);
}

export function deleteFile(key: string): boolean {
  return store.delete(key);
}

export function generateKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
