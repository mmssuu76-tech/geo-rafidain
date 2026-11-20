# Applied production migration evidence — DO NOT REPLAY

These four files preserve the exact SQL statement text recorded in the **production**
`supabase_migrations.schema_migrations` table and reviewed read-only on 2026-11-20.
They are **historical evidence only**, not a complete baseline and not an approved
migration deployment source. Never copy them into `supabase/migrations/` or execute
them again: the first MFA function was superseded, and the path constraint already
exists and was validated. Replaying can weaken security or produce errors.

Use `../migration-reconciliation.json` for versions, provenance and SHA-256 digests.
The initial bootstrap SQL scripts are not represented by these four migrations.
The two new candidate fixes are in `../pending/`, still unexecuted in production.
No customer records, paths, tokens or application secrets are included here.
