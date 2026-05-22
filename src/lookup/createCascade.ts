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
import { VinAuditAdapter } from "./adapters/VinAuditAdapter.js";
import type { VendorAdapter } from "./types.js";

export interface CascadeFactoryEnv {
  readonly VINAUDIT_API_KEY?: string | undefined;
  readonly VINAUDIT_BASE_URL?: string | undefined;
}

export function createCascade(env: CascadeFactoryEnv): VendorCascade | undefined {
  const adapters: VendorAdapter[] = [];

  if (env.VINAUDIT_API_KEY !== undefined && env.VINAUDIT_API_KEY !== "") {
    adapters.push(
      new VinAuditAdapter({
        apiKey: env.VINAUDIT_API_KEY,
        ...(env.VINAUDIT_BASE_URL !== undefined
          ? { baseUrl: env.VINAUDIT_BASE_URL }
          : {}),
      }),
    );
  }

  // Slice 2 adds the DataOne fallback adapter here.
  // Slice 1.x: if VinAudit credentials are not yet configured, return
  // undefined so the route layer can surface a clear configuration error.

  if (adapters.length === 0) {
    return undefined;
  }

  return new VendorCascade(adapters);
}
