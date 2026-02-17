import React from 'react';
import { Badge } from './Badge';

export type SyncState = 'SYNCED' | 'PENDING' | 'FAILED' | 'ERROR';

export function SyncStatusBadge({ state }: { state: SyncState }) {
  const normalized = state === 'ERROR' ? 'FAILED' : state;
  const tone = normalized === 'FAILED' ? 'danger' : normalized === 'PENDING' ? 'info' : 'success';
  const icon = normalized === 'FAILED' ? 'alert-circle' : normalized === 'PENDING' ? 'sync' : 'check-circle';
  const label = normalized === 'FAILED' ? 'Failed' : normalized === 'PENDING' ? 'Pending' : 'Synced';
  return <Badge tone={tone} label={label} icon={icon} />;
}

