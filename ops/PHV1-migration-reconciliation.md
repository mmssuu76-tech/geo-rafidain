# Production migration reconciliation

The current register is [migration-reconciliation.json](migration-reconciliation.json). On 2026-11-22 the production migration ledger contained eight entries, including resumable administrator deletion. The retention claim, notification MFA and attachment path migrations are applied. Their archived SQL is evidence and must not be replayed. Earlier review comments in archived SQL describe pre-deployment status.

The aggregate preflight returned zero attachment metadata rows and no objects in either request bucket. No request-less notifications or mismatched non-admin recipients were found. The register covers recorded migrations only. Bootstrap SQL is not a reproducible baseline.
