import { ChatbotShell } from "./components/ChatbotShell.tsx";
import type { JSX } from "react";

/**
 * App root.
 *
 * v2 slice A: the chatbot is now the primary entry surface. The slice-1
 * EntryForm is still reachable via a "prefer a form?" link inside the
 * ChatbotShell, so anyone who hits a chat issue (or just wants a form) has
 * a one-click fallback.
 */
export function App(): JSX.Element {
  return <ChatbotShell />;
}
