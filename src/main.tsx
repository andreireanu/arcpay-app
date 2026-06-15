import { Buffer } from "buffer/";
(globalThis as unknown as Record<string, unknown>).Buffer ??= Buffer;

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AppRoot from "./AppRoot";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
