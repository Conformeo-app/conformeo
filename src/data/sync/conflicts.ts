export type ConflictResolution = 'keep_local' | 'keep_remote' | 'merge_fields';

export type Conflict = {
  entity: string;
  local: Record<string, unknown>;
  remote: Record<string, unknown>;
};

export function resolveConflict(_conflict: Conflict): ConflictResolution {
  return 'keep_local';
}
