import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-19T12:00:00.000Z";
const actor = { kind: "human" as const, id: "uw1" };

async function loaded() {
  const { app } = buildServer({ now: fixed });
  await app.inject({ method: "POST", url: "/world/load-scenario",
    payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
  // Add a document to upload to
  await app.inject({ method: "POST", url: "/loans/2501000101/documents",
    payload: { doc: { name: "Test Upload.pdf", docType: "BankStatement" }, actor } });
  return app;
}

describe("upload routes", () => {
  it("POST upload attaches file to document", async () => {
    const app = await loaded();
    // Get the document ID
    const loan = (await app.inject({ method: "GET", url: "/loans/2501000101" })).json();
    const docId = loan.documents.at(-1).id;

    // Create a fake PDF buffer
    const boundary = "----FormBoundary";
    const body = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="test.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n` +
      `%PDF-1.4 fake pdf content\r\n` +
      `--${boundary}--\r\n`
    );

    const res = await app.inject({
      method: "POST",
      url: `/loans/2501000101/documents/${docId}/upload`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.ok).toBe(true);
    expect(result.fileKey).toBeDefined();
    expect(result.fileUrl).toMatch(/^\/uploads\//);
    expect(result.document.status).toBe("Received");
  });

  it("GET /uploads/:fileKey serves the stored file", async () => {
    const app = await loaded();
    const loan = (await app.inject({ method: "GET", url: "/loans/2501000101" })).json();
    const docId = loan.documents.at(-1).id;

    const boundary = "----FormBoundary2";
    const fileContent = "Hello World PDF Content";
    const body = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="hello.pdf"\r\n` +
      `Content-Type: application/pdf\r\n\r\n` +
      `${fileContent}\r\n` +
      `--${boundary}--\r\n`
    );

    const upload = await app.inject({
      method: "POST",
      url: `/loans/2501000101/documents/${docId}/upload`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    const fileKey = upload.json().fileKey;

    const download = await app.inject({ method: "GET", url: `/uploads/${fileKey}` });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("application/pdf");
    expect(download.body).toContain(fileContent);
  });

  it("GET /uploads/nonexistent returns 404", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({ method: "GET", url: "/uploads/nonexistent" });
    expect(res.statusCode).toBe(404);
  });
});
