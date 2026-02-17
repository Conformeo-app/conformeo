import React from 'react';
import { Badge } from './Badge';

export function SafetyTag({ label = 'SAFETY' }: { label?: string }) {
  return <Badge tone="warning" label={label} icon="shield" />;
}

