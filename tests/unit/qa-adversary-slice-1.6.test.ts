/**
 * Tests landing here are written by `qa-adversary` (and in this case, by the
 * Cowork session running the adversary's attacks directly because the bridge
 * transport timed out — see `docs/qa-reports/slice-1.6.md`).
 *
 * Each test reproduces a finding so the regression cannot return silently.
 */
import { describe, expect, it } from "vitest";
import type { Response as ExpressResponse } from "express";
import { makePlateLookupHandler, makeVinLookupHandler } from "../../server/routes/lookup.js";
import type { LookupResult, VendorAdapter } from "../../src/lookup/types.js";
import { VendorCascade } from "../../src/lookup/VendorCascade.js";

interface CapturedResponse {
  status: number;
  body: unknown;
}

function buildFakeResponse(): { res: ExpressResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: 0, body: null };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as ExpressResponse;
  return { res, captured };
}

/**
 * Adversary finding R1 (slice-1.6.md): when the cascade throws unexpectedly,
 * `lookup.ts` was forwarding `err.message` verbatim into the response body's
 * `detail` field. The constitution forbids surfacing raw exception messages
 * to the client. The fix replaces `detail` with a fixed generic string and
 * logs the actual exception server-side.
 *
 * This test pins the safer behavior. If a future refactor reverts to
 * `err.message`, this test fails.
 */
describe("qa-adversary R1 — unexpected cascade throw must not leak err.message", () => {
  const SECRET = "SECRET_TOKEN_hunter2_password_DB=postgres://user:pass@host";

  const throwingAdapter: VendorAdapter = {
    name: "throwing-adapter",
    lookupByPlate: () => {
      throw new Error(SECRET);
    },
    lookupByVin: () => {
      throw new Error(SECRET);
    },
  };

  /**
   * VendorCascade's own try/catch swallows adapter throws and converts to
   * `transient_error`, so to trigger the route-level "unexpected throw" path
   * we need a cascade-shaped object that itself throws. Subclass and override.
   */
  class ThrowingCascade extends VendorCascade {
    public constructor() {
      super([throwingAdapter]);
    }
    public override lookupByPlate(): Promise<LookupResult> {
      return Promise.reject(new Error(SECRET));
    }
    public override lookupByVin(): Promise<LookupResult> {
      return Promise.reject(new Error(SECRET));
    }
  }

  it("plate handler hides err.message when cascade throws unexpectedly", async () => {
    const handler = makePlateLookupHandler(new ThrowingCascade());
    const { res, captured } = buildFakeResponse();
    const req = { body: { plate: "XRJ4041", state: "TX" } } as never;
    await handler(req, res);

    expect(captured.status).toBe(500);
    const body = captured.body as Record<string, unknown>;
    expect(body.kind).toBe("transient_error");
    expect(body.cause).toBe("unexpected_cascade_throw");
    // The literal secret string MUST NOT appear anywhere in the response body.
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("SECRET_TOKEN");
    expect(JSON.stringify(body)).not.toContain("postgres://");
  });

  it("vin handler hides err.message when cascade throws unexpectedly", async () => {
    const handler = makeVinLookupHandler(new ThrowingCascade());
    const { res, captured } = buildFakeResponse();
    const req = { body: { vin: "JTEEW21A060032314" } } as never;
    await handler(req, res);

    expect(captured.status).toBe(500);
    const body = captured.body as Record<string, unknown>;
    expect(body.kind).toBe("transient_error");
    expect(body.cause).toBe("unexpected_cascade_throw");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("SECRET_TOKEN");
    expect(JSON.stringify(body)).not.toContain("postgres://");
  });
});
