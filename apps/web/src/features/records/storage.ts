export type Density = "comfortable" | "compact";

function lastKey(userId: string): string {
  return `qsh.dataset.${userId}`;
}

function columnsKey(userId: string, datasetId: string): string {
  return `qsh.columns.${userId}.${datasetId}`;
}

function densityKey(userId: string): string {
  return `qsh.density.${userId}`;
}

export function rememberDataset(userId: string, datasetId: string): void {
  localStorage.setItem(lastKey(userId), datasetId);
}

export function lastDataset(userId: string): string | null {
  const value = localStorage.getItem(lastKey(userId));
  if (!value || value.includes("/") || value.length > 80) return null;
  return value;
}

export function readHiddenColumns(userId: string, datasetId: string): string[] | null {
  const raw = localStorage.getItem(columnsKey(userId, datasetId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeHiddenColumns(userId: string, datasetId: string, keys: string[]): void {
  localStorage.setItem(columnsKey(userId, datasetId), JSON.stringify(keys));
}

export function readDensity(userId: string): Density {
  return localStorage.getItem(densityKey(userId)) === "compact" ? "compact" : "comfortable";
}

export function writeDensity(userId: string, density: Density): void {
  localStorage.setItem(densityKey(userId), density);
}
