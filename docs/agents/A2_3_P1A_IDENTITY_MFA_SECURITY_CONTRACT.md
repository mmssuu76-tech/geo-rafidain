# A2.3-P1A — Supabase identity + MFA trust contract (OFFLINE)

## Release classification

- **Parent:** A2.3-P0 Draft PR #15, commit `d9af2a101a77b2f85c2fb69bc59e9b6b759287a8`.
- **Current change:** offline validation adapter + tests + CI only; **not** an IdP integration, deployed authentication service, API endpoint, or authorization grant.
- **Invariant:** A2.1 `execution_authorized=False`, A2.2 synthetic-only Docker test, A2.3-P0 preview-only gateway; CLI `--task` remains disabled.
- **No production operations:** no credentials, HTTP requests, Supabase database changes, SQL migration, JWT parsing from untrusted input, model calls, Docker invocations, or secret manager access.

## What is implemented

`identity_contract.SupabaseMfaConsentBridge` implements the **existing** A2.3 `IdentityVerifier` protocol. Its default `DenyApprovalAuthority` always refuses issuance. An optional collaborator must be created **only by a separate, trusted control-plane service**. A forged Python `CheckedHumanApproval` value is not cryptographically trusted: it has to be delivered by a hardened, privileged adapter, never by a browser, agent, request body, or SDK tool.

For a trusted backend result, the bridge checks all conditions:

1. Exact Supabase Auth issuer and audience, `role=authenticated`, non-anonymous, properly shaped user and session UUIDs, signature-verified and non-expired JWT.
2. Live session validation was successful and checked within 10 seconds, **including revocation**; no reliance solely on `auth.getSession()` / browser-provided JWT data.
3. `aal2`, currently active verified factor, **recent TOTP** (`amr` method and timestamp within 300 seconds). This intentionally does not accept phone/SMS factor as a default policy.
4. Current `admin` authorization from privileged server-side lookup; **never from `user_metadata`** or user-writable JWT fields.
5. Human approval was explicitly given for the fully rendered, exact canonical request digest within 60 seconds; its opaque confirmation reference was **atomically consumed**.
6. All timestamps are bounded and past-or-present. Network errors, malformed evidence, missing fields, stale MFA, role changes, invalid project, and token expiry all deny.

Integration test: bridge → existing `SignedApprovalLedger.issue_for_verified_human` → one successful `verify_and_consume`, then repeat denied. No real Supabase or network access.

## Trusted authority adapter: REQUIRED before P1A is operational

The new `TrustedApprovalAuthority` is an abstract protocol, not a usable service. **Never implement it by merely accepting a JSON request claiming** `signature_verified=true`, `session_active=true`, `aal=aal2`, `role_from_server_lookup=true`, or `human_confirmation_consumed=true` — these fields are forgeable. Production must construct these fields from independently validated, authoritative systems under a server-only trust boundary.

Proposed deployment flow (not implemented):

```text
Client signs in → Supabase TOTP challenge/verify → new aal2 session
      |
      v
Private approval web route (HTTPS, CSRF/origin controls, same-site session)
      |
      +-- Verify JWT signature against pinned issuer/audience/JWKS + exp/nbf
      +-- Check live auth.sessions(session_id,user_id) + active MFA factors
      +-- Re-check role from private administrative role source
      +-- Derive actual amr last TOTP timestamp, reject stale MFA
      +-- Load immutable canonical approved-request view from trusted server
      +-- Display scope, affected files, model, max tokens/cost and digest
      +-- Record explicit click + binding nonce (not agent-controlled)
      +-- Atomic consume of one-time confirmation reference
      |
      v
Privileged TrustedApprovalAuthority → offline SupabaseMfaConsentBridge
      |
      v
A2.3-P0 SignedApprovalLedger → A2.1 PREFLIGHT_ONLY
      |
      v
No model execution (separate future authorization required)
```

**Important Supabase caveats:** local JWT signature checks do not guarantee immediate logout/session revocation; query authoritative session state on sensitive approvals. `aal2` alone does not prove a **recent** second factor — validate relevant `amr` method/timestamp and live verified factor status. Admin roles stored in client-controlled `user_metadata` must be ignored. If the project uses an `app_metadata` JWT claim, remember it can be stale; perform a fresh privileged authorization lookup at approval time. An admin UI MFA gate is necessary for UX but is not the server authority for agent approval. Do not expose service-role keys in the client.

## Remaining phases — NOT delivered by this patch

### P1B: non-exportable signing keys + durable anti-replay ledger

- Select an environment-specific managed KMS/HSM or Vault Transit; do not accept plaintext HMAC keys as a production substitute. Use stable `kid`, algorithm allowlist, key rotation, revoked-key behavior, and separated signing vs verifying service identities.
- Migrate from single-host SQLite to a **private** PostgreSQL schema (not Data API exposed), restricted DB roles, RLS as defense in depth, short TTL, atomic consume (`UPDATE ... WHERE consumed_at IS NULL RETURNING ...`), and unique idempotency constraint. Use a dedicated control-plane database role rather than application `service_role` token.
- Append-only audit event stream plus trusted external checkpoints (plain hash chain or DB alone is not append-only against a privileged attacker). Define retention/deletion and backup/restore anti-rollback controls. Ensure test/failover behavior is safe under replica lag, lost commit responses, and concurrent consumption.
- **No production migration** until the staging database, authorization service design, recovery process, and KMS tenant are approved and tested.

### P1C: authenticated AI Gateway with denied-by-default egress

- Only gateway process receives provider credentials; model/worker/LLM tools cannot access vault keys, user tokens, Docker socket, or a generic HTTP execution tool.
- Gateway requires fresh, independently signed, single-use execution authorization (not `PolicyDecision` dataclass or preview flag), full digest binding, tenant/resource permissions, and a concrete isolation boundary.
- Explicit model/provider allowlist and destination DNS/TLS pinning policy, request schema validation, redaction, cancellation, timeout, audit, and emergency off-switch.
- Start with local mock transport and never put real customer files in synthetic Docker smoke tests.

### P1D: quota and spend enforcement

- Reserve **maximum possible** in the authoritative store before admission: request, user, tenant, and monthly ceilings, with atomic idempotency and max output token/time constraints. Do not treat estimated price as a hard cap.
- Reconcile against actual provider usage and invoices. On timeouts, uncertain provider response or retry, keep reservation held and deny re-admission until reconciled; never release funds on an ambiguous outcome.
- Compare against applicable live pricing and provider-side account/organization limits; costs of cached inputs, tool calls, retries, currency rounding, and asynchronous billing must be accounted for.
- Require kill switch and negative/failure testing. Without provider-side hard controls, **perfect financial hard caps cannot be claimed**.

## Acceptance checklist

- [x] Offline P1A identity contract, negative tests and P0 ledger integration.
- [ ] Linux CI passes on this exact new branch/commit; no skipped POSIX path tests.
- [ ] Independent threat model + code review, with test evidence attached.
- [ ] Real Supabase Auth backend that validates JWT signature AND active sessions AND fresh MFA; test user logout/revocation and admin role removal.
- [ ] Trusted, single-use human consent store and safe approval UI, including concurrent replay tests.
- [ ] Managed KMS, durable audited ledger and explicit migration review.
- [ ] Gateway authenticated, isolated, mock-tested, and network egress constrained.
- [ ] Provider usage accounting and enforceable quotas with failure reconciliation.
- [ ] Only then separately authorize a bounded synthetic live model call; do not enable normal production traffic by merging this feature branch.

## References (current documentation; reverify before deployment)

- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/auth/auth-mfa/totp
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/guides/auth/jwt-fields
- https://supabase.com/docs/guides/database/postgres/row-level-security
