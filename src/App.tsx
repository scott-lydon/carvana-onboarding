import { EntryForm } from "./components/EntryForm.tsx";
import type { JSX } from "react";

/**
 * App root. Slice 1.6 replaced the placeholder server-status scaffold with
 * the EntryForm — the actual entry-step UI on top of the live cascade.
 * Anyone landing on the deployed URL now sees the working product, not the
 * scaffold.
 */
export function App(): JSX.Element {
  return <EntryForm />;
}
