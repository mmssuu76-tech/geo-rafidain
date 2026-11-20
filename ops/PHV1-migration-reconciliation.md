# Geo Rafidain — PHV1-FIX-005 migration reconciliation

**Review date:** 2026-11-20
**Production project ref:** `nrvewrdwmonlzamsvdjm`
**Scope:** metadata-only, read-only checks of production migration history, catalog
constraints and access policies. **No migration was executed.**

## 1. Confirmed production history

| Version | Database migration name | Interpretation |
|---|---|---|
| `20261105231916` | `require_aal2_for_admin_mfa_ok` | Applied, but its function body is superseded by the stricter `20261120140209`; never replay it |
| `20261120140151` | `scope_new_request_attachment_paths` | Applied `NOT VALID` path CHECK on `public.request_files` |
| `20261120140209` | `require_verified_factor_for_admin_aal2` | Applied; current MFA helper demands a user, AAL2 and a verified factor |
| `20261120140210` | `validate_request_attachment_paths` | Applied; the request-files CHECK was confirmed validated (`convalidated = true`) |

All four statements are archived verbatim under `ops/applied-migrations/` **outside**
`supabase/migrations/`. The archive is an evidence trail, not a deployment mechanism.

## 2. Pending fixes — not applied to production

- **FIX-003:** `ops/pending/notification-mfa.sql`. Production still had the
  `notifications_read_own` recipient-only SELECT policy on the review date.
- **FIX-004:** `ops/pending/attachment-path-hardening.sql`. Production still had
  the older six `storage_request_*` policies; stricter request-parent/path helper
  and deliverable-registration rules are still candidate changes.
- The local source `supabase/communication-delivery.sql` combines both pending
  fixes for **fresh-environment bootstrap**. Do **not** execute the entire file
  against production as an ad hoc patch.

The production `request_files_scoped_object_path` constraint is already validated;
`supabase/foundation-hardening.sql` is **not** a safe reapplication script for
production because it contains an unguarded `ADD CONSTRAINT`.

## 3. Legacy-data audit, read-only

The aggregate catalog query run on 2026-11-20 returned:

| Scope | Metadata rows | Invalid rows | Unsupported extensions |
|---|---:|---:|---:|
| `public.request_files` | 0 | 0 | 0 |
| `public.request_deliverables` | 0 | 0 | 0 |

No `storage:` category rows appeared, consistent with no matching objects in
`storage.objects` for these two buckets at the time. **This is a point-in-time
metadata finding, not evidence that Storage integrations work or that future
objects will be safe.** It does not reveal client content, filenames or paths.

The reusable count-only SQL is in `ops/attachment-path-audit.sql`.

## 4. Deployment prerequisites — HOLD

1. Preserve a verified rollback/backup strategy and confirm administrative MFA
   and account recovery work on a separate staging project.
2. Run the legacy-path count audit immediately before deployment; check both
   buckets, request metadata, and any known storage cleanup operations.
3. Review the changed `SECURITY DEFINER` functions, grants, RLS behavior and
   deactivated/demoted-admin scenarios against **real authenticated sessions**.
4. Create **new, timestamped migrations via Supabase CLI**, first for FIX-003 and
   then FIX-004. Do not reuse production history filenames or reapply already
   executed migrations. Inspect `supabase migration list` and SQL diff before any
   `db push` or deployment.
5. Test client A/client B/admin AAL1/admin AAL2, direct REST, signed URLs,
   Storage upload/remove, RPCs and post-update notifications in staging.
6. Verify on production by read-only catalog queries **after** separately
   authorizing a deployment. No production deployment is authorized by this file.

## 5. Baseline gap

The GitHub repository's existing `supabase/*.sql` bootstrap scripts are not a
complete versioned migration history. The four database-recorded migrations
represent only subsequent patches, **not** a fully reproducible schema baseline.
A clean baseline and migration order are still needed for independent staging,
CI and future fresh installs. Avoid `db reset` / `db push` against production.

## 6. Verification boundary

Local PGlite tests passing does not validate production privileges, Auth JWT
refresh behavior, actual Storage APIs, Edge Function data races or retention
cleanup. The four snapshot hashes are checked locally for accidental drift;
they do not constitute a live cryptographic database attestation.
