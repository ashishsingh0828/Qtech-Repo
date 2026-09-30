export function databaseAddress(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const host = url.hostname.length > 0 ? url.hostname : "unknown-host";
    const port = url.port.length > 0 ? url.port : "5432";
    return `${host}:${port}`;
  } catch {
    return "unknown-host";
  }
}
