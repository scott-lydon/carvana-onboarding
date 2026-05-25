// @vitest-environment node
/**
 * Adversary test — CAT-1 / vendor cost regression in probePermutations.
 *
 * Finding: When all 8 workers (PERMUTATION_PARALLELISM) concurrently resolve
 * in the same microtask flush, the `stop` flag is set only AFTER a resolved
 * entry is pushed. In JavaScript's single-threaded event loop, once all workers
 * have started their `await cascade.lookupByPlate` calls, all of their
 * continuations are queued and execute before any worker can act on `stop=true`
 * from another worker's push. This allows `resolved.length` to exceed
 * MAX_INTERPRETATIONS (6) — the implementation allows up to PERMUTATION_PARALLELISM
 * (8) resolved entries on a fully-hit cascade.
 *
 * Reproduction: stub cascade that resolves all plates, plate with 8+ confusable
 * permutations, assert resolved.length <= MAX_INTERPRETATIONS.
 *
 * Violated spec: "Soft-cap on resolved hits at MAX_INTERPRETATIONS: as soon as we
 * have that many, we stop firing new probes." (server/routes/lookup.ts:141-143)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import express, { type Request, type Response } from "express";
import { VendorCascade } from "../../src/lookup/VendorCascade.ts";
import { makePlateLookupHandler } from "../../server/routes/lookup.ts";
import type {
  LookupResult,
  Plate,
  StateCode,
  VendorAdapter,
  Vin,
} from "../../src/lookup/types.ts";

/**
 * Stub adapter that MISSES the one configured "primary" plate but
 * RESOLVES every other plate it sees. This lets probePermutations
 * actually run (the primary lookup returns not_found, triggering the
 * recovery fan-out) AND every permutation resolves, so we can assert
 * the MAX_INTERPRETATIONS cap is honored against the real code path.
 *
 * Note on the prior shape: an earlier version of this test used a
 * resolve-EVERY-plate stub, which short-circuited at the primary
 * lookup so the recovery code never ran. That made the test depend
 * on a parallel inline simulation of the race rather than the real
 * implementation. The new shape exercises the real route handler so
 * a regression in the actual probePermutations is what fails the
 * test, not a hand-rolled simulation.
 */
function makeStubMissingPrimary(missPlate: string): VendorAdapter {
  return {
    name: "miss-primary-stub",
    lookupByPlate(plate: Plate, _state: StateCode): Promise<LookupResult> {
      if (plate.normalized === missPlate) {
        return Promise.resolve({
          kind: "not_found",
          attemptedVendors: ["miss-primary-stub"],
          lastVendorTried: "miss-primary-stub",
        });
      }
      return Promise.resolve({
        kind: "resolved",
        vehicle: { year: 2020, make: "TestMake", model: "TestModel" },
        viaVendor: "miss-primary-stub",
        latencyMs: 1,
      });
    },
    lookupByVin(_vin: Vin): Promise<LookupResult> {
      return Promise.resolve({
        kind: "not_found",
        attemptedVendors: ["miss-primary-stub"],
        lastVendorTried: "miss-primary-stub",
      });
    },
  };
}

/** The plate that the stub misses on the primary lookup. Picked so it
 *  has many confusable characters and produces ≥ PARALLELISM=8
 *  permutations, exercising the worker race the test is hunting. */
const MISS_PLATE = "17EBSB2G";

async function startApp(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const cascade = new VendorCascade([makeStubMissingPrimary(MISS_PLATE)]);
  const handler = makePlateLookupHandler(cascade);
  app.post("/api/lookup/plate", (req: Request, res: Response): void => {
    void handler(req, res);
  });
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server failed to bind.");
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((r) => {
            server.close(() => { r(); });
          }),
      });
    });
  });
}

describe("CAT-1 sliceG — probePermutations MAX_INTERPRETATIONS cap enforcement", () => {
  let serverPort: number;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    const { port, close } = await startApp();
    serverPort = port;
    closeServer = close;
  });

  afterAll(async () => {
    await closeServer();
  });

  it(
    "interpretations[] never exceeds MAX_INTERPRETATIONS (6) even when " +
      "every permutation resolves and all PARALLELISM workers race",
    async () => {
      // Post the miss-primary plate. The stub returns not_found ONLY for
      // this plate; every confusable permutation hits the resolve branch.
      // 17EBSB2G has eight confusable characters (1, 7, E, B, S, B, 2, G)
      // so the permuter emits the full 24 candidates, hitting every
      // single worker and exercising the post-stop race.
      const res = await fetch(
        `http://localhost:${String(serverPort)}/api/lookup/plate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plate: MISS_PLATE, state: "TX" }),
        },
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { interpretations?: unknown[] };
      expect(Array.isArray(body.interpretations)).toBe(true);
      const interpretations = body.interpretations ?? [];
      // The cap is exact — implementation promises "as soon as we have
      // that many, we stop firing new probes". Allow strictly ≤ 6.
      expect(interpretations.length).toBeLessThanOrEqual(6);
      // Sanity: SOMETHING must come back; if zero, the test's stub or
      // the permuter changed and the cap test became vacuous.
      expect(interpretations.length).toBeGreaterThan(0);
    },
  );
});
