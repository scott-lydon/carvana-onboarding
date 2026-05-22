import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  // If this throws in production something is catastrophically wrong with the
  // index.html template; surface immediately rather than silently rendering nothing.
  throw new Error(
    "Root element #root not found in index.html. " +
      "Check public/index.html or vite.config.ts publicDir.",
  );
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
