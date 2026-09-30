import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Providers } from "./app/providers";
import { router } from "./app/router";
import { ErrorBoundary } from "./components/error-boundary";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element missing");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </ErrorBoundary>
  </StrictMode>,
);
