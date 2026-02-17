import React from 'react';
import { Badge } from './Badge';

export type RiskLevel = 'OK' | 'WATCH' | 'RISK';

export function RiskBadge({ level }: { level: RiskLevel }) {
  const tone = level === 'RISK' ? 'danger' : level === 'WATCH' ? 'warning' : 'success';
  const icon = level === 'RISK' ? 'alert-circle' : level === 'WATCH' ? 'alert' : 'check-circle';
  const label = level === 'RISK' ? 'RISQUE' : level === 'WATCH' ? 'VIGILANCE' : 'OK';
  return <Badge tone={tone} label={label} icon={icon} />;
}
