export const securityPolicies = {
  maxSessionIdleMinutes: 30,
  maxSyncAttempts: 7,
  maxOfflineQueueItems: 5000,
  maxUploadSizeMb: 20,
  mfaRequiredRoles: ['owner', 'admin'] as const
};

export type SecurityRole = (typeof securityPolicies.mfaRequiredRoles)[number];
