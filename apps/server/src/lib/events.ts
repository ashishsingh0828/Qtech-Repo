import { EventEmitter } from "node:events";
import type { DomainEvent } from "@app/shared";

const emitter = new EventEmitter();

export function publishEvent(event: DomainEvent): void {
  emitter.emit("domain", event);
}

export function onDomainEvent(listener: (event: DomainEvent) => void): () => void {
  emitter.on("domain", listener);
  return () => {
    emitter.off("domain", listener);
  };
}
