let activeKey = "";
const listeners = new Set<() => void>();

export function subscribeActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveKey(): string {
  return activeKey;
}

export function setActiveKey(key: string): void {
  if (key === activeKey) return;
  activeKey = key;
  for (const listener of listeners) listener();
}
