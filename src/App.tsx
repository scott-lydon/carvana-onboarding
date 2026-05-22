import { useEffect, useState } from "react";

/**
 * Slice 0 scaffold for the entry form. Renders nothing useful yet beyond a
 * health check against the Express server so the dev loop is fully exercised
 * end to end before slice 1 wires up the real vendor cascade.
 *
 * The actual EntryForm, OCRCapture, ResultPanel, and DegradationLayer
 * components arrive in slices 1 through 4. This file is intentionally tiny
 * so that the first qa-adversary pass attacks a known-empty surface, not
 * pre-baked stub data that will distract from the real review.
 */
export function App(): JSX.Element {
  const [serverStatus, setServerStatus] = useState<
    "checking" | "ok" | "unreachable"
  >("checking");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/health", { signal: controller.signal });
        if (cancelled) return;
        setServerStatus(res.ok ? "ok" : "unreachable");
      } catch {
        if (cancelled) return;
        setServerStatus("unreachable");
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return (
    <main className="app-root">
      <header>
        <h1>Carvana Onboarding Recovery Layer</h1>
        <p className="lede">
          Slice 0 scaffold. Entry-step lookup, OCR capture, and graceful
          degradation arrive in slices 1 through 4.
        </p>
      </header>
      <section aria-labelledby="server-status-heading">
        <h2 id="server-status-heading">Server</h2>
        <p data-testid="server-status">Status: {serverStatus}</p>
      </section>
    </main>
  );
}
