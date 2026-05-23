/**
 * Factory that constructs the VendorCascade from environment configuration.
 * Centralizes the "which adapters are available" decision so the rest of
 * the codebase does not see env vars (constitution rule: business logic
 * never reads env directly).
 *
 * If no adapter is configured (no env vars set), this returns `undefined`
 * so the route layer can render a 503 "configuration_missing" response
 * rather than crashing with a missing-vendor error inside the cascade.
 */
import { VendorCascade } from "./VendorCascade.js";
import { CarsXEAdapter } from "./adapters/CarsXEAdapter.js";
import { VinAuditAdapter } from "./adapters/VinAuditAdapter.js";
import type { VendorAdapter } from "./types.js";

export interface CascadeFactoryEnv {
  /** CarsXE is the prototype primary vendor: self-service signup, sandbox tier free. */
  readonly CARSXE_API_KEY?: string | undefined;
  readonly CARSXE_BASE_URL?: string | undefined;
  /** VinAudit is the prototype fallback once their B2B sales team issues a key. */
  readonly VINAUDIT_API_KEY?: string | undefined;
  readonly VINAUDIT_BASE_URL?: string | undefined;
}

export function createCascade(env: CascadeFactoryEnv): VendorCascade | undefined {
  const adapters: VendorAdapter[] = [];

  // Cascade order: CarsXE primary (self-service signup, working today),
  // VinAudit fallback (B2B sales pending). The cascade walks in array order
  // so the primary's miss/timeout falls through to the secondary.
  // Treat empty string the same as undefined: .env.local files commonly
  // declare a key with no value (`CARSXE_BASE_URL=` on its own line) to
  // document that the override is supported, not to set the override to
  // the empty string. Passing "" through as baseUrl crashes the URL
  // constructor inside the fetch call with the unhelpful message
  // "Failed to parse URL from /platedecoder?...". Guard at the boundary.
  if (env.CARSXE_API_KEY !== undefined && env.CARSXE_API_KEY !== "") {
    adapters.push(
      new CarsXEAdapter({
        apiKey: env.CARSXE_API_KEY,
        ...(env.CARSXE_BASE_URL !== undefined && env.CARSXE_BASE_URL !== ""
          ? { baseUrl: env.CARSXE_BASE_URL }
          : {}),
      }),
    );
  }

  if (env.VINAUDIT_API_KEY !== undefined && env.VINAUDIT_API_KEY !== "") {
    adapters.push(
      new VinAuditAdapter({
        apiKey: env.VINAUDIT_API_KEY,
        ...(env.VINAUDIT_BASE_URL !== undefined && env.VINAUDIT_BASE_URL !== ""
          ? { baseUrl: env.VINAUDIT_BASE_URL }
          : {}),
      }),
    );
  }

  // Slice 2 adds the DataOne enterprise fallback adapter here.
  // If no adapter is configured, return undefined so the route layer surfaces
  // a structured 503 configuration_missing error.

  if (adapters.length === 0) {
    return undefined;
  }

  return new VendorCascade(adapters);
}
