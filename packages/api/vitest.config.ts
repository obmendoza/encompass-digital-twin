import { defineConfig } from "vitest/config";

// Serialize test files so concurrent withTenantTx calls don't exhaust the
// Supabase session pooler's 15-client cap. Vitest's default is one worker
// thread per file in parallel; with ~30 test files all hitting the same
// pooler that overruns the cap and produces EMAXCONNSESSION cascades.
//
// `fileParallelism: false` runs test files sequentially. Tests within a
// file still run in parallel within their describe blocks (vitest default),
// which is fine — within-file pool usage is bounded.
//
// If/when the project moves off the session pooler (e.g. to a dedicated
// transaction pooler with higher cap), this can be flipped back to true.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
