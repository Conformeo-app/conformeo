export type UUID = string;

export type OutboxOperation = {
  id: UUID;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount: number;
};

export type SyncDelta<T = unknown> = {
  entity: string;
  items: T[];
  cursor?: string;
};
