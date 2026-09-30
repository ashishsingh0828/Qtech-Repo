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

const datasetListeners = new Set<() => void>();

export function subscribeDataset(listener: () => void): () => void {
  datasetListeners.add(listener);
  return () => {
    datasetListeners.delete(listener);
  };
}

function emitDataset(): void {
  for (const listener of datasetListeners) listener();
}

export function rememberDataset(userId: string, datasetId: string): void {
  localStorage.setItem(lastKey(userId), datasetId);
  emitDataset();
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

export type WorkspacePrefs = {
  tab: string;
  mine: boolean;
  city: string;
  contract: string;
};

const EMPTY_PREFS: WorkspacePrefs = { tab: "", mine: false, city: "", contract: "" };

function workspaceKey(userId: string): string {
  return `qsh.workspace.${userId}`;
}

export function readWorkspace(userId: string): WorkspacePrefs {
  const raw = localStorage.getItem(workspaceKey(userId));
  if (!raw) return EMPTY_PREFS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_PREFS;
    const record = parsed as Record<string, unknown>;
    return {
      tab: typeof record.tab === "string" ? record.tab : "",
      mine: record.mine === true,
      city: typeof record.city === "string" ? record.city : "",
      contract: typeof record.contract === "string" ? record.contract : "",
    };
  } catch {
    return EMPTY_PREFS;
  }
}

export function writeWorkspace(userId: string, prefs: WorkspacePrefs): void {
  localStorage.setItem(workspaceKey(userId), JSON.stringify(prefs));
}
