# Production Hardening v1

## Status
In Progress

## PHV1-001 — Fix 90-day retention cleanup for deliverables

**Priority:** P0

### Problem
The current retention lifecycle can delete the database record while physical delivery objects remain in `request-deliverables`, creating orphaned storage objects.

### Required behavior
`request-deliverables` → `request-files` → `service_requests`

If any Storage deletion fails, the parent `service_requests` record must remain so cleanup can be retried.

### Files
- `backend.js`
- `supabase/functions/retention-cleanup/index.ts`
- `RETENTION.md`
- `PRODUCTION_HARDENING_V1.md`

### Acceptance criteria
- Manual deletion removes both storage buckets before the DB row.
- Automated retention removes both storage buckets before the DB row.
- Storage failure prevents deletion of the DB row.
- Edge Function reports `scanned`, `deleted`, `failed`, `failures`, and `cutoff`.
- No secret or service-role key is added to frontend code.

## Next tasks
- PHV1-002: Enforce MFA/AAL2 for administrators.
- PHV1-003: Enable Turnstile before public launch.
- PHV1-004: Add automated security/retention tests.
- PHV1-005: Add CI and protect `main`.
- PHV1-006: Organize SQL into tracked Supabase migrations.
