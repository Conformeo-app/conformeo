import { billing } from './billing';

// Optional hooks for the sync runtime (billing is pushed via the generic outbox).
export const billingSync = {
  async warmNumbering() {
    await billing.warmNumbering();
  }
};

