/**
 * VendorCascade — pure orchestrator. Tries adapters in order with a per-vendor
 * timeout. Returns a discriminated-union `LookupResult` so the caller (the
 * DegradationLayer in slice 1.6) can pattern-match on the named failure mode.
 *
 * The cascade NEVER swallows errors silently (CAT-1). When an adapter throws,
 * the throw is captured into a structured `attemptedVendors` entry and the
 * next adapter is tried; if every adapter throws, the cascade returns
 * `transient_error` so the caller can decide to retry. A NotFound from any
 * adapter is a "this vendor doesn't have it" signal, NOT an error.
 *
 * Cascade short-circuits on the first `resolved` result. It does NOT keep
 * trying further adapters once a Resolved comes back, because that would
 * waste vendor calls and increase latency for no value.
 */
import type {
  LookupResult,
  Plate,
  StateCode,
  VendorAdapter,
  Vin,
} from "./types.js";

/**
 * Default per-vendor timeout. Adapters that exceed this are treated as
 * "this vendor failed for this attempt" and the cascade falls through.
 */
export const DEFAULT_VENDOR_TIMEOUT_MS = 2_000;

interface CascadeAttempt {
  readonly vendor: string;
  readonly outcome: "resolved" | "not_found" | "error" | "timeout";
  readonly error?: string;
  readonly latencyMs: number;
}

export class VendorCascade implements VendorAdapter {
  public readonly name = "VendorCascade";

  public constructor(
    private readonly adapters: readonly VendorAdapter[],
    private readonly timeoutMs: number = DEFAULT_VENDOR_TIMEOUT_MS,
  ) {
    if (adapters.length === 0) {
      throw new Error(
        "VendorCascade requires at least one VendorAdapter. " +
          "The factory in createCascade.ts should never construct a cascade " +
          "with zero adapters; if VINAUDIT_API_KEY is missing the route layer " +
          "should return 503 BEFORE reaching this constructor.",
      );
    }
  }

  public async lookupByPlate(
    plate: Plate,
    state: StateCode,
  ): Promise<LookupResult> {
    return this.run((adapter) => adapter.lookupByPlate(plate, state));
  }

  public async lookupByVin(vin: Vin): Promise<LookupResult> {
    return this.run((adapter) => adapter.lookupByVin(vin));
  }

  /**
   * Runs the cascade. The caller provides the per-adapter invocation as a
   * callback so plate and VIN paths share this orchestration code without
   * duplication. Returns the first `resolved` result, OR aggregates the
   * attempted-vendor list into a `not_found` / `transient_error` result.
   */
  private async run(
    callAdapter: (adapter: VendorAdapter) => Promise<LookupResult>,
  ): Promise<LookupResult> {
    const attempts: CascadeAttempt[] = [];

    for (const adapter of this.adapters) {
      const startedAt = Date.now();
      try {
        const result = await this.withTimeout(callAdapter(adapter));
        const latencyMs = Date.now() - startedAt;

        if (result.kind === "resolved") {
          // Preserve viaVendor and override latencyMs to reflect actual call
          // time (the adapter may have measured slightly differently).
          return {
            kind: "resolved",
            vehicle: result.vehicle,
            viaVendor: adapter.name,
            latencyMs,
          };
        }

        if (result.kind === "not_found") {
          attempts.push({
            vendor: adapter.name,
            outcome: "not_found",
            latencyMs,
          });
          continue;
        }

        // Any other kind (transient_error, bot_detected, format_error) bubbles
        // up immediately — those are NOT "try the next vendor" situations.
        return result;
      } catch (err) {
        const latencyMs = Date.now() - startedAt;
        const isTimeout =
          err instanceof Error && err.message === "VendorCascade:timeout";
        attempts.push({
          vendor: adapter.name,
          outcome: isTimeout ? "timeout" : "error",
          error: err instanceof Error ? err.message : String(err),
          latencyMs,
        });
      }
    }

    // No adapter resolved. Decide between not_found and transient_error.
    const anyNotFound = attempts.some((a) => a.outcome === "not_found");
    const attemptedVendors = attempts.map((a) => a.vendor);
    const lastVendor = attempts[attempts.length - 1]?.vendor ?? "unknown";

    if (anyNotFound) {
      return {
        kind: "not_found",
        attemptedVendors,
        lastVendorTried: lastVendor,
      };
    }

    // All attempts errored or timed out. The caller should retry.
    return {
      kind: "transient_error",
      retryable: true,
      cause: attempts
        .map((a) => `${a.vendor}:${a.outcome}${a.error ? `:${a.error}` : ""}`)
        .join("; "),
      attemptedVendors,
    };
  }

  /**
   * Races the adapter promise against a timeout. The timeout itself is
   * implemented with AbortController so the adapter has a chance to cancel
   * an in-flight fetch instead of letting it leak.
   */
  private async withTimeout(promise: Promise<LookupResult>): Promise<LookupResult> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<LookupResult>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error("VendorCascade:timeout"));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }
}
