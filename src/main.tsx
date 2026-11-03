import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";

import "./styles.css";

const element = document.querySelector("#root");
if (!element) {
  throw new Error("Missing app root.");
}
createRoot(element).render(
  <StrictMode>
    <App />
  </StrictMode>
);
