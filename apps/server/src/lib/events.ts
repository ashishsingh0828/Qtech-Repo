import { EventEmitter } from "node:events";
import type { DomainEvent } from "@app/shared";
import { logger } from "./logger";
import { enqueueOutbox } from "./outbox";

const emitter = new EventEmitter();

export function publishEvent(event: DomainEvent): void {
  try {
    emitter.emit("domain", event);
  } catch (error) {
    logger.error({ err: error }, "Domain listener failed");
  }
  void enqueueOutbox(event).catch((error: unknown) => {
    logger.error({ err: error }, "Failed to enqueue outbox event");
  });
}

export function onDomainEvent(listener: (event: DomainEvent) => void): () => void {
  emitter.on("domain", listener);
  return () => {
    emitter.off("domain", listener);
  };
}
