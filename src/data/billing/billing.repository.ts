// Billing repository facade.
// Today it delegates to the existing `billing` implementation (SQLite + outbox).
// This file exists to keep the data layer structure consistent and allow incremental refactors.

export { billing } from './billing';

