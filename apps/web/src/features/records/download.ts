import { ApiError } from "../../lib/api";

export async function downloadWorkbook(datasetId: string, filename: string, rowIds?: string[]): Promise<void> {
  const response = await fetch(`/api/datasets/${datasetId}/export`, {
    method: rowIds ? "POST" : "GET",
    credentials: "same-origin",
    headers: rowIds ? { "Content-Type": "application/json" } : undefined,
    body: rowIds ? JSON.stringify({ rowIds }) : undefined,
  });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("unauthenticated", { detail: { path: `/api/datasets/${datasetId}/export` } }));
    throw new ApiError("Sign in required", 401, "UNAUTHENTICATED");
  }
  if (!response.ok) {
    let message = "Could not export the workbook.";
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && typeof payload.error === "string") message = payload.error;
    } catch {
      message = "Could not export the workbook.";
    }
    throw new ApiError(message, response.status, "UNKNOWN");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filenameFromDisposition(response.headers.get("Content-Disposition"), filename);
  link.click();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  const named = fallback.toLowerCase().endsWith(".xlsx") ? fallback : `${fallback}.xlsx`;
  if (!header) return named;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return encoded[1];
    }
  }
  const basic = /filename="([^"]+)"/i.exec(header);
  return basic?.[1] || named;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
