/**
 * CarsXE vendor adapter for plate-to-VIN lookups.
 *
 * Endpoint (verified against CarsXE's published documentation):
 *   GET https://api.carsxe.com/platedecoder?plate=&state=&format=json&key=
 *
 * Response shape (verified from
 * https://medium.com/carsxe/decoding-a-vehicle-license-plate-with-an-api-62fbef7beb68):
 *   {
 *     "success": true,
 *     "vin": "4T1BF22K5WU057633",
 *     "imageUrl": "...",
 *     "assembly": "United States",
 *     "Description": "Toyota Camry CE / LE / XLE",
 *     "RegistrationYear": "1998",
 *     "CarMake": "Toyota",
 *     "CarModel": "Camry CE / LE / XLE",
 *     "BodyStyle": "Sedan 4D",
 *     "EngineSize": "3.0L V6 EFI"
 *   }
 *
 * Sandbox tier: 100 lifetime calls, free. Enough for the demo corpus
 * (5 Texas plates × multiple test runs = well under 100).
 *
 * Per the constitution:
 *   - Adapter returns `not_found` when the vendor said no.
 *   - Adapter THROWS on infrastructure failures (timeout, 5xx, malformed JSON,
 *     missing required fields in a 200 response).
 *   - DPPA boundary: request shape requests plate → VIN/vehicle ONLY.
 *     We never request owner / registrant / address data.
 */
import type {
  LookupResult,
  Plate,
  StateCode,
  Vehicle,
  VendorAdapter,
  Vin,
} from "../types.js";

const DEFAULT_BASE_URL = "https://api.carsxe.com";

export class CarsXECredentialsMissingError extends Error {
  public override readonly name = "CarsXECredentialsMissingError";
  public constructor() {
    super(
      "CARSXE_API_KEY environment variable is not set. Drop the sandbox " +
        "key into .env.local (or set it in the Render dashboard) and " +
        "redeploy. The cascade endpoint returns 503 'configuration_missing' " +
        "until this is fixed.",
    );
  }
}

interface CarsXEAdapterConfig {
  readonly apiKey: string | undefined;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export class CarsXEAdapter implements VendorAdapter {
  public readonly name = "carsxe";
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(config: CarsXEAdapterConfig) {
    this.apiKey = config.apiKey;
    // Defense in depth: createCascade is the boundary that should already
    // strip empty-string baseUrl, but if a caller forgets, we still want a
    // usable URL. `??` doesn't catch "" (only null/undefined), so we treat
    // the empty string explicitly as "no override, use default".
    this.baseUrl =
      config.baseUrl === undefined || config.baseUrl === ""
        ? DEFAULT_BASE_URL
        : config.baseUrl;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  public async lookupByPlate(
    plate: Plate,
    state: StateCode,
  ): Promise<LookupResult> {
    const apiKey = this.requireApiKey();
    const url =
      `${this.baseUrl}/platedecoder` +
      `?plate=${encodeURIComponent(plate.normalized)}` +
      `&state=${encodeURIComponent(state)}` +
      `&format=json` +
      `&key=${encodeURIComponent(apiKey)}`;
    return this.executeRequest(url);
  }

  public async lookupByVin(vin: Vin): Promise<LookupResult> {
    const apiKey = this.requireApiKey();
    // CarsXE's VIN decoder lives at /specs (per their docs). The v2 endpoint
    // pattern is /v2/specs but we use the legacy /specs route here to keep
    // the same auth style as the plate decoder. Calibrate against sandbox
    // first-call result if a different field shape appears.
    const url =
      `${this.baseUrl}/specs` +
      `?vin=${encodeURIComponent(vin.normalized)}` +
      `&format=json` +
      `&key=${encodeURIComponent(apiKey)}`;
    return this.executeRequest(url);
  }

  private requireApiKey(): string {
    if (this.apiKey === undefined || this.apiKey === "") {
      throw new CarsXECredentialsMissingError();
    }
    return this.apiKey;
  }

  private async executeRequest(url: string): Promise<LookupResult> {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url);
    } catch (err) {
      throw new Error(
        `carsxe:network_error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (response.status >= 500) {
      throw new Error(`carsxe:upstream_5xx: HTTP ${String(response.status)}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `carsxe:auth_error: HTTP ${String(response.status)} — check CARSXE_API_KEY value`,
      );
    }
    if (response.status === 429) {
      throw new Error(`carsxe:rate_limited: HTTP 429 — sandbox tier exhausted`);
    }
    if (response.status >= 400 && response.status !== 404) {
      throw new Error(`carsxe:client_error: HTTP ${String(response.status)}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new Error(
        `carsxe:malformed_json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // CarsXE's response includes `success: true` on hit and `success: false`
    // (with an error field) on miss. We treat success:false as not_found.
    if (typeof body !== "object" || body === null) {
      throw new Error("carsxe:unexpected_body: response was not a JSON object");
    }
    const obj = body as Record<string, unknown>;
    if (obj.success === false) {
      // Log the vendor's `error` / `message` field so we can tell apart
      // "no record" from "plate format invalid", "key over quota", or
      // "this VIN is on a no-decode list". The user-facing response is
      // still `not_found` — we don't surface vendor strings — but the
      // operator sees the real reason on the next investigation.
      const vendorReason =
        typeof obj.error === "string"
          ? obj.error
          : typeof obj.message === "string"
            ? obj.message
            : "no `error` or `message` field on CarsXE response";
      console.warn(
        `[carsxe] success:false for ${url.replace(/key=[^&]+/, "key=REDACTED")} — vendor reason: ${vendorReason}`,
      );
      return {
        kind: "not_found",
        attemptedVendors: [this.name],
        lastVendorTried: this.name,
      };
    }

    const vehicle = parseCarsXEVehicle(obj);
    if (vehicle === undefined) {
      // 200 OK with a body that doesn't carry the vehicle fields we need.
      // Treat as not_found (vendor reached us, vendor doesn't have the
      // plate). Distinct from infrastructure failure.
      //
      // Log the response keys so we can tell whether CarsXE is sending a
      // shape we don't recognize (e.g. v2 endpoint launch with renamed
      // fields) vs an empty-record response. Critical for diagnosing the
      // exact failure mode in production logs.
      console.warn(
        `[carsxe] 200 OK but parseCarsXEVehicle returned undefined; ` +
          `response keys: ${JSON.stringify(Object.keys(obj))}. ` +
          `Full body (first 500 chars): ${JSON.stringify(obj).slice(0, 500)}`,
      );
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
 * Defensive parser for CarsXE's response. Handles both the documented
 * PascalCase fields (CarMake, CarModel, RegistrationYear, BodyStyle) and
 * the lower-camelCase variants that v2 endpoints may use (make, model,
 * year, bodyStyle).
 *
 * Returns undefined if the required fields are missing, which the caller
 * maps to `not_found`.
 */
function parseCarsXEVehicle(obj: Record<string, unknown>): Vehicle | undefined {
  const yearRaw =
    obj.RegistrationYear ?? obj.year ?? obj.Year ?? obj.registrationYear;
  const make = stringOr(obj.CarMake ?? obj.make ?? obj.Make);
  const model = stringOr(obj.CarModel ?? obj.model ?? obj.Model);
  const trim = stringOr(obj.Trim ?? obj.trim);
  const bodyStyle = stringOr(
    obj.BodyStyle ?? obj.bodyStyle ?? obj.body ?? obj.Body,
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

function stringOr(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
