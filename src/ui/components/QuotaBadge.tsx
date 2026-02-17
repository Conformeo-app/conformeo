import React from 'react';
import { Badge } from './Badge';

export type QuotaLevel = 'OK' | 'WARN' | 'CRIT';

export function QuotaBadge({ level }: { level: QuotaLevel }) {
  const tone = level === 'CRIT' ? 'danger' : level === 'WARN' ? 'warning' : 'success';
  const icon = level === 'CRIT' ? 'alert-circle' : level === 'WARN' ? 'alert' : 'check-circle';
  const label = level === 'CRIT' ? '95%+' : level === 'WARN' ? '80%' : 'OK';
  return <Badge tone={tone} label={`Quota ${label}`} icon={icon} />;
}

