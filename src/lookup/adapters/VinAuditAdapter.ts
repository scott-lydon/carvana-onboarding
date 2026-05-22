/**
 * VinAudit vendor adapter for plate-to-VIN and VIN-to-vehicle lookups.
 *
 * IMPORTANT — provisional endpoint and response shape:
 *   The request/response shapes below are based on VinAudit's publicly
 *   documented Vehicle Data / Vehicle History API pattern. The exact field
 *   names and request structure must be confirmed against the sandbox
 *   credentials VinAudit issues to the B2B account (the response includes
 *   sandbox-specific docs). When credentials arrive, calibrate the
 *   `parsePlateResponse` and `parseVinResponse` helpers against an actual
 *   sandbox response and run the integration tests in
 *   `tests/integration/VinAuditAdapter.spec.ts` to lock the contract.
 *
 * Until credentials arrive, this adapter throws a typed error from its
 * `requireApiKey` check; the route layer catches that and returns a 503
 * "configuration_missing" to the client, NOT a 500.
 *
 * Per the constitution:
 *   - Adapter returns `not_found` on a missing plate (vendor said "no").
 *   - Adapter THROWS on infrastructure failures (timeout, 5xx, malformed JSON).
 *   - Cascade catches the throw and falls through to the next vendor.
 *
 * DPPA boundary (CAT-6): this adapter does NOT request, parse, or expose any
 * owner/registrant/driver fields. The `Vehicle` interface in `types.ts`
 * does not have those fields by design.
 */
import type {
  LookupResult,
  Plate,
  StateCode,
  Vehicle,
  VendorAdapter,
  Vin,
} from "../types.js";

const DEFAULT_BASE_URL = "https://api.vinaudit.com";

export class VinAuditCredentialsMissingError extends Error {
  public override readonly name = "VinAuditCredentialsMissingError";
  public constructor() {
    super(
      "VINAUDIT_API_KEY environment variable is not set. Drop the B2B " +
        "sandbox key into .env.local (or set it in the Render dashboard) " +
        "and redeploy. The cascade endpoint returns 503 'configuration_missing' " +
        "until this is fixed.",
    );
  }
}

interface VinAuditAdapterConfig {
  readonly apiKey: string | undefined;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export class VinAuditAdapter implements VendorAdapter {
  public readonly name = "vinaudit";
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(config: VinAuditAdapterConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  public async lookupByPlate(
    plate: Plate,
    state: StateCode,
  ): Promise<LookupResult> {
    const apiKey = this.requireApiKey();
    // PROVISIONAL endpoint shape; calibrate against sandbox docs in slice 1.2
    // verification. The query-string-with-key pattern matches VinAudit's
    // public documentation for the History / Vehicle Data API products.
    const url = `${this.baseUrl}/v2/query?key=${encodeURIComponent(apiKey)}&plate=${encodeURIComponent(plate.normalized)}&state=${encodeURIComponent(state)}&format=json`;
    return this.executeRequest(url);
  }

  public async lookupByVin(vin: Vin): Promise<LookupResult> {
    const apiKey = this.requireApiKey();
    const url = `${this.baseUrl}/v2/query?key=${encodeURIComponent(apiKey)}&vin=${encodeURIComponent(vin.normalized)}&format=json`;
    return this.executeRequest(url);
  }

  /**
   * Required-API-key guard. Throws a typed error the route layer maps to 503
   * "configuration_missing" — distinct from any plate/VIN data failure.
   */
  private requireApiKey(): string {
    if (this.apiKey === undefined || this.apiKey === "") {
      throw new VinAuditCredentialsMissingError();
    }
    return this.apiKey;
  }

  /**
   * Issues the HTTP request and maps the response to `LookupResult`. On a
   * network error or non-2xx status we THROW (the cascade catches and falls
   * through). On a 2xx with a parseable body but no vehicle, we return
   * `not_found`. On a 2xx with a parseable body and vehicle data, we return
   * `resolved`.
   */
  private async executeRequest(url: string): Promise<LookupResult> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url);
    } catch (err) {
      // Network-level failure (DNS, refused, abort). Throw so cascade falls
      // through. NEVER catch-log-continue here (CAT-1).
      throw new Error(
        `vinaudit:network_error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (response.status >= 500) {
      throw new Error(`vinaudit:upstream_5xx: HTTP ${String(response.status)}`);
    }
    if (response.status >= 400 && response.status !== 404) {
      // 4xx other than 404 means our request was wrong (auth, rate limit,
      // shape). Throw so it bubbles up; we should NOT pretend it's not_found.
      throw new Error(`vinaudit:client_error: HTTP ${String(response.status)}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new Error(
        `vinaudit:malformed_json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const vehicle = parseVehicleFromResponse(body);
    if (vehicle === undefined) {
      return {
        kind: "not_found",
        attemptedVendors: [this.name],
        lastVendorTried: this.name,
      };
    }

    return {
      kind: "resolved",
      vehicle,
      viaVendor: this.name,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/**
 * Defensive parser for VinAudit's response body. Returns the parsed Vehicle on
 * success, undefined on a "not found" or otherwise unrecognized response.
 *
 * PROVISIONAL: real field names are sandbox-confirmed. We check a few likely
 * shapes (`{ vehicle: {...} }`, `{ data: {...} }`, top-level fields) so the
 * adapter is forgiving if VinAudit's response shape differs slightly from
 * our guess. Unit tests use representative fixtures.
 */
function parseVehicleFromResponse(body: unknown): Vehicle | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const candidate = pickVehiclePayload(body as Record<string, unknown>);
  if (candidate === undefined) return undefined;

  const yearRaw = candidate.year;
  const make = stringOrUndefined(candidate.make);
  const model = stringOrUndefined(candidate.model);
  const trim = stringOrUndefined(candidate.trim);
  const bodyStyle = stringOrUndefined(
    candidate.body ?? candidate.bodyStyle ?? candidate.body_style,
  );

  const year =
    typeof yearRaw === "number"
      ? yearRaw
      : typeof yearRaw === "string"
        ? parseInt(yearRaw, 10)
        : NaN;

  if (!Number.isFinite(year) || make === undefined || model === undefined) {
    return undefined;
  }

  return { year, make, model, trim, bodyStyle };
}

function pickVehiclePayload(
  body: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const v = body.vehicle;
  if (typeof v === "object" && v !== null) return v as Record<string, unknown>;
  const d = body.data;
  if (typeof d === "object" && d !== null) return d as Record<string, unknown>;
  // Some VinAudit endpoints return the vehicle fields at the top level.
  if (typeof body.make === "string" && typeof body.model === "string") {
    return body;
  }
  return undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
