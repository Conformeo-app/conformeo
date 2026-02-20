import React from 'react';
import { Badge } from './Badge';
import type { IconName } from './Icon';

export type ReleaseState = 'ALPHA' | 'BETA' | 'READY';

export function ReleaseBadge({ state }: { state: ReleaseState }) {
  const label = state;
  const tone = state === 'READY' ? 'success' : state === 'BETA' ? 'info' : 'warning';
  const icon: IconName =
    state === 'READY' ? 'check-circle-outline' : state === 'BETA' ? 'flask-outline' : 'alert-outline';

  return <Badge tone={tone} label={label} icon={icon} />;
}
