export type DomainEvent = {
  type: string;
  datasetId?: string;
  rowId?: string;
  actorId?: string;
  [key: string]: unknown;
};
