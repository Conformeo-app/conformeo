import type { AppRole } from '../../core/identity-security';

export type BillingAccess = {
  canRead: boolean;
  canWrite: boolean;
  canExport: boolean;
  canWritePayments: boolean;
};

function matchesPermission(permission: string, granted: string) {
  const required = permission.trim();
  const candidate = granted.trim();
  if (!required || !candidate) return false;

  if (candidate === '*') return true;
  if (candidate === required) return true;

  if (candidate.endsWith(':*')) {
    const prefix = candidate.slice(0, -1); // keep trailing ':'
    return required.startsWith(prefix);
  }

  return false;
}

function hasPermission(permissions: string[], required: string) {
  const clean = required.trim();
  if (!clean) return false;

  return permissions.some((granted) => matchesPermission(clean, granted));
}

export function computeBillingAccess(input: {
  role: AppRole | null;
  permissions?: string[] | null;
}): BillingAccess {
  const perms = Array.isArray(input.permissions) ? input.permissions : [];

  const fallbackRead = input.role === 'ADMIN' || input.role === 'MANAGER' || input.role === 'FIELD';
  const fallbackWrite = input.role === 'ADMIN' || input.role === 'MANAGER';

  const canRead = perms.length > 0 ? hasPermission(perms, 'billing:read') : fallbackRead;
  const canWrite = perms.length > 0 ? hasPermission(perms, 'billing:write') : fallbackWrite;
  const canExport = perms.length > 0 ? hasPermission(perms, 'billing:export') : fallbackWrite;
  const canWritePayments =
    perms.length > 0 ? hasPermission(perms, 'billing:payments:write') || canWrite : fallbackWrite;

  return {
    canRead,
    canWrite,
    canExport,
    canWritePayments
  };
}

