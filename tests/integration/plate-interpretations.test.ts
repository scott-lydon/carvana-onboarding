// @vitest-environment node
/**
 * Integration test for the OCR-confusable recovery path through
 * /api/lookup/plate.
 *
 * Setup uses a stub VendorCascade (built from a single stub
 * VendorAdapter) that resolves a hard-coded plate→vehicle mapping. This
 * keeps the test deterministic and removes the dependency on a live
 * CarsXE key while still exercising the real route handler, the real
 * Plate domain primitive, and the real confusable permuter end-to-end.
 *
 * Coverage:
 *   - A primary not_found triggers permutation fan-out.
 *   - Resolved permutations surface as `interpretations[]` on the 404.
 *   - The original plate is NEVER in the interpretations list.
 *   - The widget's render trigger field (`interpretations`) is always
 *     present on plate-side not_found, including when zero permutations
 *     resolved (empty array, not missing key).
 *   - Each interpretation carries the swap descriptors so the widget
 *     can diff-highlight the changed characters.
 *   - The XRJ4041 ←→ XRJ4047 recovery (7-vs-1 case from 2026-05-24)
 *     produces the real plate as a top-ranked candidate.
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
 * Stub VendorAdapter that resolves an in-memory plate→vehicle map.
 * Any plate not in the map returns `not_found`. The cascade is built
 * from this single adapter so the route handler exercises the real
 * miss → confusable-permutation → re-lookup pipeline.
 */
function makeStubAdapter(
  resolvedPlates: ReadonlyMap<string, LookupResult>,
): VendorAdapter {
  // Use Promise.resolve(...) (not async) to satisfy the
  // @typescript-eslint/require-await rule while still returning a
  // Promise — these stubs do no awaiting, they answer synchronously.
  return {
    name: "stub",
    lookupByPlate(plate: Plate, _state: StateCode): Promise<LookupResult> {
      const hit = resolvedPlates.get(plate.normalized);
      if (hit !== undefined) return Promise.resolve(hit);
      return Promise.resolve({
        kind: "not_found",
        attemptedVendors: ["stub"],
        lastVendorTried: "stub",
      });
    },
    lookupByVin(_vin: Vin): Promise<LookupResult> {
      return Promise.resolve({
        kind: "not_found",
        attemptedVendors: ["stub"],
        lastVendorTried: "stub",
      });
    },
  };
}

async function startApp(
  resolvedPlates: ReadonlyMap<string, LookupResult>,
): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const adapter = makeStubAdapter(resolvedPlates);
  const cascade = new VendorCascade([adapter]);
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
            server.close(() => {
              r();
            });
          }),
      });
    });
  });
}

const realHighlander: LookupResult = {
  kind: "resolved",
  vehicle: { year: 2021, make: "Toyota", model: "Highlander" },
  viaVendor: "stub",
  latencyMs: 10,
};

describe("plate lookup recovery — confusable permutations", () => {
  let serverPort: number;
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    // Two real-incident scenarios from 2026-05-24, scoped to distinct
    // plate prefixes so each test's "is this resolved or not?" is
    // unambiguous in the stub map:
    //   - 7-vs-1: real plate XRJ4041, OCR misread XRJ4047. Map
    //     resolves XRJ4041 only; posting XRJ4047 hits not_found and
    //     recovery surfaces XRJ4041.
    //   - 7-vs-T: real plate ABC1237, OCR misread ABC123T. Map
    //     resolves ABC1237 only; posting ABC123T hits not_found and
    //     recovery surfaces ABC1237.
    const realFordF150: LookupResult = {
      kind: "resolved",
      vehicle: { year: 2019, make: "Ford", model: "F-150" },
      viaVendor: "stub",
      latencyMs: 12,
    };
    const resolved = new Map<string, LookupResult>([
      ["XRJ4041", realHighlander],
      ["ABC1237", realFordF150],
    ]);
    const { port, close } = await startApp(resolved);
    serverPort = port;
    closeServer = close;
  });

  afterAll(async () => {
    await closeServer();
  });

  async function postLookup(
    plate: string,
    state: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetch(`http://localhost:${String(serverPort)}/api/lookup/plate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plate, state }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body };
  }

  it("recovers XRJ4041 when OCR misreads it as XRJ4047 (7-vs-1 case)", async () => {
    const { status, body } = await postLookup("XRJ4047", "TX");
    expect(status).toBe(404);
    expect(body.kind).toBe("not_found");
    expect(body.origin).toBe("plate");
    expect(body.originalPlate).toBe("XRJ4047");
    expect(Array.isArray(body.interpretations)).toBe(true);
    const interpretations = body.interpretations as readonly {
      kind: string;
      plate: string;
      vehicle: { year: number; make: string; model: string };
      viaVendor: string;
      editCount: number;
      swaps: readonly { index: number; fromChar: string; toChar: string }[];
    }[];
    const platesFound = interpretations.map((i) => i.plate);
    expect(platesFound).toContain("XRJ4041");

    const target = interpretations.find((i) => i.plate === "XRJ4041");
    expect(target).toBeDefined();
    expect(target?.vehicle).toEqual({
      year: 2021,
      make: "Toyota",
      model: "Highlander",
    });
    expect(target?.swaps).toHaveLength(1);
    expect(target?.swaps[0]).toMatchObject({
      index: 6,
      fromChar: "7",
      toChar: "1",
    });
    expect(target?.editCount).toBe(1);
  });

  it("recovers ABC1237 when OCR misreads it as ABC123T (7-vs-T case)", async () => {
    // User-reported 2026-05-24: the serif on a 7 read as the T crossbar.
    // The single-hop T→7 swap at the final position should surface the
    // real plate ABC1237 as a candidate.
    const { status, body } = await postLookup("ABC123T", "TX");
    expect(status).toBe(404);
    const interpretations = body.interpretations as readonly {
      plate: string;
      vehicle: { year: number; make: string; model: string };
      swaps: readonly { index: number; fromChar: string; toChar: string }[];
    }[];
    expect(interpretations.map((i) => i.plate)).toContain("ABC1237");
    const target = interpretations.find((i) => i.plate === "ABC1237");
    expect(target?.vehicle).toEqual({
      year: 2019,
      make: "Ford",
      model: "F-150",
    });
    expect(target?.swaps[0]).toMatchObject({
      index: 6,
      fromChar: "T",
      toChar: "7",
    });
  });

  it("never includes the original plate in the interpretations list", async () => {
    const { body } = await postLookup("XRJ4047", "TX");
    const interpretations = body.interpretations as readonly {
      plate: string;
    }[];
    for (const interp of interpretations) {
      expect(interp.plate).not.toBe("XRJ4047");
    }
  });

  it("always emits the interpretations field, even when zero permutations resolve", async () => {
    // YYYY contains no confusable characters per the seed pairs, so
    // the permuter emits zero candidates. The route MUST still attach
    // `interpretations: []` so the client renders the widget with the
    // retake/retype affordances.
    const { status, body } = await postLookup("YYYY", "TX");
    expect(status).toBe(404);
    expect(body.interpretations).toEqual([]);
    expect(body.originalPlate).toBe("YYYY");
  });

  it("primary hit short-circuits — no interpretations field on resolved", async () => {
    const { status, body } = await postLookup("XRJ4041", "TX");
    expect(status).toBe(200);
    expect(body.kind).toBe("resolved");
    expect(body.interpretations).toBeUndefined();
  });
});
