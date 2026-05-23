/**
 * EntryForm — the load-bearing slice 1.6 component. Replaces the placeholder
 * App.tsx scaffold so reviewers landing on the deployed URL see the actual
 * product, not the "Status: ok" status indicator.
 *
 * What this does:
 *   1. Renders a tab toggle between License Plate and VIN entry.
 *   2. Accepts user input, posts to /api/lookup/plate or /api/lookup/vin.
 *   3. Pattern-matches the discriminated `LookupResult` from the cascade
 *      to the appropriate user-facing copy (DegradationLayer responsibility,
 *      inlined here for slice 1.6 brevity; slice 1.7 extracts it).
 *
 * Constitution rules honored:
 *   - CAT-2: form values are preserved across errors (tab and field state).
 *   - CAT-3: every error copy path describes the SYSTEM constraint, never
 *     blames the user.
 *   - The fetch is wrapped in try/catch with an explicit network-error
 *     branch that surfaces via the result panel, not silently.
 */
import { useState } from "react";
import type { JSX, FormEvent } from "react";

type Tab = "plate" | "vin";

type ApiResponseBody =
  | {
      kind: "resolved";
      vehicle: {
        year: number;
        make: string;
        model: string;
        trim?: string | undefined;
        bodyStyle?: string | undefined;
      };
      viaVendor: string;
      latencyMs: number;
    }
  | {
      kind: "not_found";
      attemptedVendors: readonly string[];
      lastVendorTried: string;
    }
  | {
      kind: "transient_error";
      retryable: true;
      cause: string;
      attemptedVendors: readonly string[];
    }
  | {
      kind: "bot_detected";
      advisedAction: "use_different_session" | "contact_support";
    }
  | {
      kind: "format_error";
      field: "plate" | "vin" | "state" | "body";
      reason: string;
    }
  | { kind: "configuration_missing"; message: string };

type UiState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "result"; body: ApiResponseBody }
  | { phase: "network_error"; message: string };

export function EntryForm(): JSX.Element {
  const [tab, setTab] = useState<Tab>("plate");
  const [plate, setPlate] = useState("");
  const [state, setState] = useState("TX");
  const [vin, setVin] = useState("");
  const [ui, setUi] = useState<UiState>({ phase: "idle" });

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setUi({ phase: "loading" });
    void (async () => {
      try {
        const endpoint = tab === "plate" ? "/api/lookup/plate" : "/api/lookup/vin";
        const payload =
          tab === "plate" ? { plate, state } : { vin };
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await res.json()) as ApiResponseBody;
        setUi({ phase: "result", body });
      } catch (err) {
        // Network-level failure (offline, DNS, CORS). Surface to user, do
        // NOT swallow silently. This is the constitution CAT-1 rule.
        const message =
          err instanceof Error
            ? err.message
            : "Unknown network error while reaching our server.";
        setUi({ phase: "network_error", message });
      }
    })();
  };

  return (
    <main className="entry-root">
      <header className="entry-header">
        <h1>Sell your car — get a real offer in 2 minutes</h1>
        <p className="lede">
          A working prototype of a graceful-degradation, honest-error-copy,
          OCR-augmented recovery layer for Carvana&rsquo;s sell-flow entry step.
          Type any US plate (try one of the Texas asterisk plates from{" "}
          <a
            href="https://github.com/scott-lydon/carvana-onboarding/tree/main/test-plates"
            target="_blank"
            rel="noreferrer"
          >
            test-plates/
          </a>
          ) and watch the cascade resolve.
        </p>
      </header>

      <section className="tab-row" role="tablist" aria-label="Lookup method">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "plate"}
          className={`tab ${tab === "plate" ? "tab-active" : ""}`}
          onClick={() => {
            // Switching tabs resets the result panel so the old tab's
            // error/result does not visually contaminate the new tab.
            // Field state (plate, state, vin) is intentionally PRESERVED
            // per CAT-2 — only the transient DegradationPanel state clears.
            // See docs/qa-reports/slice-1.6.md F3.
            setTab("plate");
            setUi({ phase: "idle" });
          }}
        >
          License Plate
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "vin"}
          className={`tab ${tab === "vin" ? "tab-active" : ""}`}
          onClick={() => {
            setTab("vin");
            setUi({ phase: "idle" });
          }}
        >
          VIN
        </button>
      </section>

      <form onSubmit={handleSubmit} className="entry-form">
        {tab === "plate" ? (
          <div className="field-row">
            <label className="field">
              <span>License Plate</span>
              <input
                type="text"
                value={plate}
                onChange={(e) => {
                  setPlate(e.target.value);
                }}
                placeholder="e.g. XRJ ★ 4041"
                autoCapitalize="characters"
                spellCheck={false}
                required
              />
              <small className="hint">
                Asterisks, spaces, dashes are stripped automatically.
              </small>
            </label>
            <label className="field state-field">
              <span>State</span>
              <input
                type="text"
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                }}
                placeholder="TX"
                maxLength={2}
                autoCapitalize="characters"
                required
              />
              {/* Empty hint preserves the 3-row grid alignment between the
                  plate and state columns (label / input / hint each share
                  a row). */}
              <small className="hint" aria-hidden="true">&nbsp;</small>
            </label>
          </div>
        ) : (
          <div className="field-row">
            <label className="field">
              <span>VIN</span>
              <input
                type="text"
                value={vin}
                onChange={(e) => {
                  setVin(e.target.value);
                }}
                placeholder="17-character VIN (no I/O/Q)"
                spellCheck={false}
                required
              />
              <small className="hint">
                Whitespace and dashes are stripped automatically.
              </small>
            </label>
          </div>
        )}
        <button
          type="submit"
          className="submit"
          disabled={ui.phase === "loading"}
        >
          {ui.phase === "loading" ? "Looking up…" : "Get my offer"}
        </button>
      </form>

      <DegradationPanel ui={ui} onRetry={(): void => { setUi({ phase: "idle" }); }} />

      <footer className="entry-footer">
        <a
          href="https://github.com/scott-lydon/carvana-onboarding"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
        {" · "}
        <a
          href="https://github.com/scott-lydon/carvana-onboarding/blob/main/docs/SELL_FLOW_AUDIT.md"
          target="_blank"
          rel="noreferrer"
        >
          Audit report
        </a>
        {" · "}
        <a
          href="https://github.com/scott-lydon/carvana-onboarding/blob/main/docs/AUTOMATION_DETECTION_MESSAGING_BRIEF.md"
          target="_blank"
          rel="noreferrer"
        >
          Bot-detection brief
        </a>
      </footer>
    </main>
  );
}

/**
 * DegradationPanel pattern-matches the cascade's discriminated result to
 * user-facing copy and next-action prompts. This is the literal opposite of
 * Carvana's "one error string for six causes" pattern documented in the
 * audit report.
 */
function DegradationPanel(props: {
  ui: UiState;
  onRetry: () => void;
}): JSX.Element | null {
  const { ui, onRetry } = props;

  if (ui.phase === "idle") return null;
  if (ui.phase === "loading") {
    return (
      <section className="result result-loading" aria-live="polite">
        <p>Reaching our vehicle data…</p>
      </section>
    );
  }
  if (ui.phase === "network_error") {
    return (
      <section className="result result-error" aria-live="polite">
        <h2>Can&rsquo;t reach our server</h2>
        <p>
          We could not reach our lookup service. Check your network and{" "}
          <button type="button" className="link" onClick={onRetry}>
            try again
          </button>
          .
        </p>
        <details>
          <summary>Diagnostic</summary>
          <pre>{ui.message}</pre>
        </details>
      </section>
    );
  }

  const body = ui.body;
  switch (body.kind) {
    case "resolved": {
      const v = body.vehicle;
      const trim = v.trim !== undefined ? ` ${v.trim}` : "";
      const bodyStyle =
        v.bodyStyle !== undefined ? ` (${v.bodyStyle})` : "";
      return (
        <section className="result result-ok" aria-live="polite">
          <h2>
            {String(v.year)} {v.make} {v.model}
            {trim}
            {bodyStyle}
          </h2>
          <p className="muted">
            Resolved in {String(body.latencyMs)} ms via{" "}
            <code>{body.viaVendor}</code>.
          </p>
          <p>
            Is this your car?{" "}
            <button type="button" className="link" onClick={onRetry}>
              No, try again
            </button>
          </p>
        </section>
      );
    }
    case "not_found": {
      return (
        <section className="result result-not-found" aria-live="polite">
          <h2>We couldn&rsquo;t find your plate in our vendor data</h2>
          <p>
            We checked <code>{body.attemptedVendors.join(", ")}</code>. About
            10&ndash;15% of plates don&rsquo;t return a match (commercial,
            specialty, recently issued). What you can do:
          </p>
          <ul>
            <li>Switch to VIN entry (top tab) and try with your 17-character VIN.</li>
            <li>
              Snap a photo of your VIN sticker or registration card from the
              chat surface — the &ldquo;Scan VIN with camera&rdquo; button
              below the conversation runs the same OCR pipeline.
            </li>
            <li>
              <button type="button" className="link" onClick={onRetry}>
                Try the plate again
              </button>{" "}
              in case of a typo.
            </li>
          </ul>
        </section>
      );
    }
    case "transient_error": {
      return (
        <section className="result result-error" aria-live="polite">
          <h2>Our vehicle data is temporarily unavailable</h2>
          <p>
            We&rsquo;re having trouble reaching our data partners
            (<code>{body.attemptedVendors.join(", ")}</code>). This is on our
            side, not yours.{" "}
            <button type="button" className="link" onClick={onRetry}>
              Try again
            </button>
            .
          </p>
          <details>
            <summary>Technical detail</summary>
            <pre>{body.cause}</pre>
          </details>
        </section>
      );
    }
    case "bot_detected": {
      return (
        <section className="result result-bot" aria-live="polite">
          <h2>We&rsquo;ve detected automated behavior</h2>
          <p>
            This session looks automated. To protect against fraud, please try
            from a fresh browser session, or contact our team at{" "}
            <code>sell-help@carvana.com</code> if you believe this is in error.
          </p>
          <p className="muted">
            Honest-error principle: this is intentionally distinct copy from a
            real plate-not-found, because the underlying cause is different.
            See the{" "}
            <a
              href="https://github.com/scott-lydon/carvana-onboarding/blob/main/docs/AUTOMATION_DETECTION_MESSAGING_BRIEF.md"
              target="_blank"
              rel="noreferrer"
            >
              messaging brief
            </a>
            .
          </p>
        </section>
      );
    }
    case "format_error": {
      return (
        <section className="result result-format" aria-live="polite">
          <h2>Quick check on your input</h2>
          <p>
            <strong>{body.field}:</strong> {body.reason}
          </p>
          <p>
            <button type="button" className="link" onClick={onRetry}>
              Edit and try again
            </button>
          </p>
        </section>
      );
    }
    case "configuration_missing": {
      return (
        <section className="result result-warning" aria-live="polite">
          <h2>The demo is still warming up</h2>
          <p>{body.message}</p>
        </section>
      );
    }
    // Exhaustiveness arm — see docs/qa-reports/slice-1.6.md F1. When a new
    // ApiResponseBody variant is added, this `never` assignment fails to
    // compile with a clear "Type X is not assignable to type never" error
    // pointing at the missing case, instead of the generic "function lacks
    // ending return statement" you'd otherwise see somewhere upstream.
    default: {
      const _exhaustive: never = body;
      throw new Error(
        `DegradationPanel: unhandled ApiResponseBody.kind — ` +
          `value=${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}
