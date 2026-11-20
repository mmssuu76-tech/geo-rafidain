# PHV1-FIX-007 — GitHub Actions security checks (review-only)

## Purpose

Create a **read-only CI workflow** for the Geo Rafidain review branch. This workflow is intended to detect JavaScript syntax errors, whitespace errors, regressions in simulated PostgreSQL RLS/MFA policies, path-validation regressions, and accidental mixing of archived and pending migrations.

## Intended events

- Pull requests targeting `main`.
- Pushes to `hardening/**` branches and `hardening-foundation-review`.
- Manually triggered runs after GitHub recognizes the workflow (`workflow_dispatch` availability may depend on the workflow being present on the default branch).

## Security boundaries

- Workflow token: `contents: read` only.
- Checkout uses `persist-credentials: false` and fetches full history so the comparison covers all changes since `main`.
- Actions are pinned to immutable 40-character commit SHAs.
- Uses GitHub-hosted ephemeral `ubuntu-latest`, Node.js 22, and `npm ci --ignore-scripts` from the committed lockfile.
- Runs `node --check` on tracked first-party JavaScript/modules, `git diff --check`, and the entire Node/PGlite test suite.
- No secrets, Supabase credentials, GitHub write privileges, database schema operations, automatic release or production deployment.
- GitHub-hosted CI can validate the PGlite mock, but **cannot prove real Supabase Auth, Storage, RPC, rate-limit or concurrency behavior**. These need separate approved staging/integration checks.

## Required later human review

1. Review `git diff` and all newly created untracked files, especially historical SQL fixture, stored snapshots, pending SQL and workflow file.
2. Confirm the workflow passes on GitHub **after** an explicitly approved commit and push to `hardening/phv1-reconcile-and-verify`. A local test passing does not mean GitHub Actions ran.
3. Protect `main` with a required passing check (`SQL and JS security regression`) and pull-request review if supported by repository settings. The workflow does not configure branch protection itself.
4. Keep both pending SQL files in `ops/pending/` — do **not** automatically deploy or move them into `supabase/migrations/`.
5. Review the production drift report and design the approved migration path, backup/rollback and real integration tests before a production rollout.

This artifact is review-only until verified against the actual GitHub Actions run after push.
