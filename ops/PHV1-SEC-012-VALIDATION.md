# PHV1-SEC-012 — Authorization and service-journey verification

**Status:** code review / isolated test candidate. **No production changes.**
**Repository:** `mmssuu76-tech/geo-rafidain`.
**Production project ref:** `nrvewrdwmonlzamsvdjm` (READ-ONLY catalog checks only).

## 1. Security boundary

The task verifies four distinct identities: client A, client B, an admin with AAL1, and the same admin with verified AAL2. It must fail closed for cross-tenant operations, expired/demoted admin conditions, notification marking, and object-path ownership.

Do **not** create accounts, upload samples, invoke mutating RPCs, or replay SQL migrations in production. No service-role credentials, customer UUIDs, signed URLs, or secrets belong in test reports, GitHub issues, commits, or chat.

## 2. Implemented: isolated SQL workflow test

`tests/phv1-sec-012-service-journey.test.mjs` runs wholly inside **PGlite**, using synthetic `auth.users`, session claims, `storage.objects` **metadata** (not actual blobs), and the repository's existing bootstrap SQL, policies, triggers, and RPCs. It covers:

1. A/B isolated service requests and request-file metadata; cross-user upload denied.
2. Admin AAL1 cannot read private requests, quote, or upload a deliverable; verified AAL2 can issue a quote.
3. Client B cannot respond to A's offer; client A accepts once, and the second decision is denied; quote history is preserved.
4. Client and admin messages produce role-appropriate notifications; AAL1 admin cannot read admin notifications.
5. Admin AAL2 registers a valid deliverable path, but not one associated with another request; client B cannot view A's deliverable metadata, storage object, or messages.
6. Client A can mark their own delivery notification read; client B cannot mark it.
7. Removing the admin's verified factor invalidates even an AAL2-labelled session in the SQL fixture.

The CI workflow already runs `node --test tests/*.test.mjs`; the new file will be included automatically after merge. Execute locally:

```powershell
npm ci --ignore-scripts
node --test tests/phv1-sec-012-service-journey.test.mjs
npm test
```

`npm ci` uses `package-lock.json`; do not commit local credentials or change the lockfile to run this test. SQL simulation uses `test.uid` and `test.aal` session settings for deterministic roles; **it does not authenticate through Supabase GoTrue or test actual JWT, refresh, MFA enrollment, signed URLs or HTTP authorization.**

## 3. Production read-only inspection (2026-11-22)

Executed catalog queries only. Observed: `service_requests`, `user_notifications`, `request_messages`, `request_quote_events`, `request_files`, `request_deliverables` all have RLS enabled; both `request-files` and `request-deliverables` buckets are private. `anon` cannot execute the five tested communication/quote/delivery RPCs, whereas `authenticated` can invoke them subject to their internal checks.

Aggregate values at inspection: 2 service requests; 0 notifications, 0 request messages, 0 quote events, 0 request-file metadata, 0 deliverable metadata, 0 matching objects in either request bucket. These are time-of-check observations, not proof of correct client behavior. The recorded production migrations `20261121203845` and `20261121203937` are already applied and **must not be replayed**.

For repeatable catalog/aggregate inspection, use `ops/PHV1-SEC-012-readonly-audit.sql`. It only selects booleans, role permissions and counts; no client details or object paths.

## 4. Mandatory real HTTP / storage integration gate (NOT YET RUN)

**Prerequisite:** isolated staging Supabase project or a fully initialized local Supabase stack with a reproducible schema baseline. The current repository's bootstrap scripts are not a complete versioned production baseline; local SQL tests do not replace a faithful staging setup. An old paused staging project must not be assumed to be usable.

Create four **synthetic** account states in staging, with role assignment performed through an authorized administrator (never browser-injected metadata):

| Identity | Expected access |
|---|---|
| Client A | Own request, own notes/files, own quote decision, own notifications |
| Client B | Own request only; denied A's request, files, message history, quotation response and notification updates |
| Admin AAL1 | Denied administrative records, quoting, delivery upload and notification updates |
| Admin verified AAL2 | Authorized administrative operations; cannot associate deliverables with the wrong owner/request |
| Admin AAL2, factor revoked | Denied operations requiring current verified MFA |
| Anonymous | No access to private request data, storage objects or protected RPCs |

Run with real distinct browser sessions (or real Auth-issued access tokens) against **staging only**. Test request submission, quote sending and acceptance/rejection, notification creation/mark-read, actual Storage upload and download, signed URL generation/access expiry, deliverable registration, and refusal of cross-account object access. Check negative cases over direct REST/RPC endpoints as well as the UI. For every test record expected vs actual HTTP status and response type, account role, time, synthetic request reference, and redacted evidence. Do not log authorization headers or signed URL query strings.

HTTP status codes may differ by endpoint (401/403/404, or empty RLS result); **the test assertion is no unauthorized disclosure or state mutation**, not one universal numeric code.

**Acceptance gate:** 100% of required negative authorization cases pass; all happy-path service steps work; no object can be accessed through a guessed path or a leaked signed URL beyond its documented expiry; logs contain no tokens. Only after this and peer review may commercial release be considered. Production deletion remains blocked by `retention_maintenance` regardless of SEC-012 results.

## 5. Release and rollback policy

This change adds tests and documentation only. Do not deploy Edge Functions, issue SQL migrations, alter RLS in production, or enable live retention. On test failure leave the pull request as Draft and capture sanitized logs. For code review use a new `hardening/phv1-sec-012-journey` branch and normal protected-main pull-request checks. The current service-journey test has no live side effects and can be removed without database rollback if flawed.
