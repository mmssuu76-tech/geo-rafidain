# A2.3 — Offline signed approval and gateway preview foundation

## Status / strict release boundary

Stacked on A2.2 head commit `a201703570f161b3f68f940affa5c5cb642f5f2d`, PR #12 (Draft).
Earlier PRs #9 (A0), #10 (A1), #11 (A2.1) also remain Draft until independently accepted.

**This deliverable is A2.3-P0, an offline control-plane foundation, NOT the completed A2.3 production gateway.** It creates no HTTP listener, model execution, SDK invocation, network permission, provider API call, production credential, GitHub write, SQL migration or Supabase integration. `cli.py --task` remains disabled. A2.2's Docker runtime remains a **synthetic security test image**, not an agent runtime.

### Implemented

1. `agent_service/trusted_control_plane/approvals.py` provides an optional, offline local SQLite ledger with HMAC-SHA256 record integrity, canonical JSON, request-digest binding, issuer/audience/scope claims, random opaque references and nonce, bounded expiry, and single-use consumption guarded by an atomic `BEGIN IMMEDIATE` transaction.
2. The grant is issued **only when an injected trusted IdentityVerifier returns human approval evidence** specifying the same request digest, MFA confirmation, correct scope, and fresh authentication/approval times. The shipped default verifier denies everyone. There is **no built-in trusted identity verifier**, grant-issuing endpoint, or approval UI. Tests use explicitly fake assertions and deterministic test keys.
3. Raw subject identifiers and raw assertions are not stored in the signed record. Subject tags use a keyed HMAC. The database must live at a private absolute local path; on POSIX a private directory and 0600-style regular database file are enforced. Windows requires independent ACL review; Python chmod is not a Windows security boundary.
4. `gateway_preview.py` validates a proposed provider/model/digest/limits against explicit allowlists and a **preflight-only** A2.1 decision. It does not construct HTTP URLs, load credentials, execute, sign approvals, or communicate with any API. The default provider/model allowlists are empty.
5. Tests cover replay, invalid signatures and modified claims, expiry, not-yet-valid timestamps, wrong issuer/audience/key/digest, unverified approval/MFA, bad scope, stale authentication, atomic double-consume across ledger instances, and A2.1's `execution_authorized=False` contract.

### Trust-boundary diagram

```text
(UNIMPLEMENTED: authenticated human UI + IdP/MFA + user confirmation)
         | externally verified bound consent
         v
TRUSTED CONTROL PLANE (local offline prototype)
  Verified identity callback --> SignedApprovalLedger [secret key + private SQLite]
         | one-time opaque approval reference, request digest
         v
A2.1 evaluate_runtime_policy [verified A1 snapshot] --> PREFLIGHT_ONLY
         | plain data; NEVER a signed execution authority
         v
A2.3 gateway_preview --> OFFLINE_PREVIEW_ONLY; network_called=False

A2.2 Linux synthetic sandbox -- separate verified test only
NO OPENAI SDK / HTTP GATEWAY / NETWORK / GITHUB / SUPABASE / PRODUCTION
```

### Important implementation and threat-model limits

- **Do not inject the signer, SQLite database, HMAC key or the identity callback into a model/agent process**. A Python package name alone does not enforce isolation. Production must use a separately deployed, authenticated control-plane service with hardened secrets and file/OS/network boundaries.
- **No actual identity provider integration exists**: passing `VerifiedHumanConsent` alone is not reliable identity evidence. Only an externally trusted verifier can assert successful MFA and **specific human approval of the canonical request digest**. A2.3 supplies only the callback interface; the bundled default verifier denies.
- A2.1's `PolicyDecision` is a forgeable Python dataclass. It must never serve as a provider-call authorization. No model execution can be inferred from the `preview_permitted` flag; `execution_authorized` remains false.
- The HMAC protects ledger record fields against modification by an attacker lacking the signing key. It does **not** prevent privileged users from deleting the database, restoring old database backups (rollback/replay), modifying the host clock, stealing keys, or reading/modifying trusted process memory. A production deployment needs KMS/HSM, key rotation and `kid`, trusted time, append-only audit / anti-rollback protection, durable replay prevention across replicas, and backup/restore safeguards.
- SQLite is local single-host evidence only, not distributed authoritative approval storage. The trusted service must control DB lifecycle and permissions, configure persistence, and prevent copies from being replayed. On Windows, enforce appropriate NTFS ACLs independently.
- Rate limiting, actual token/turn/time caps, billing/cost enforcement, egress allowlisting, redaction, content retention policies, request signing between services, MTLS/service authentication, cancellation, emergency kill switch, and provider failover are **not implemented** here.
- A2.2's Docker smoke tested one synthetic container. It is not proof of production-key or production-source isolation.

## Offline verification

From the repository root (no network or API keys needed):

```powershell
$env:PYTHONDONTWRITEBYTECODE = '1'
python -m unittest discover -s tests -p test_agent_a2_3_approval.py -v
python -m unittest discover -s tests -p test_agent_a2_3_gateway_preview.py -v
node --test tests/ci-workflow.test.mjs
```

A2.3 PR should be a **Draft** against `agents/secure-sandbox-a2-2`. PHV1 CI remains read-only and checks A0/A1/A2.1/A2.2/A2.3. The existing A2.2 synthetic Docker smoke remains unchanged and must also succeed.

## Remaining A2.3 acceptance tasks (NOT shipped)

1. Security-reviewed production identity-verifier adapter, verified active session and role, explicit human confirmation of a fully rendered request digest; no agent-controlled approval issuance.
2. Dedicated control-plane deployment with authentication, non-exportable managed keys/KMS, key IDs/rotation, private durable audited grant store, replay/rollback guarantees, correct TTL/clock discipline, request binding, logout/revocation and emergency stop.
3. Separate authenticated AI Gateway/service-to-service identity, strictly constrained outbound provider endpoints, secret isolation, rate limits, hard spend/tokens/time quotas, timeout/cancellation, scoped audit and provider retention controls.
4. Integrate through a reviewed end-to-end plan, with mock transport first. Only then a **separately authorized synthetic** real model test in sandbox under cost ceiling. Never pass production customer files through the smoke probe.

## Rollback / operational discipline

Do not merge A2.3 into `main`. Abandon/close its Draft PR if acceptance fails. No migrations, deployment, network calls, model executions, or production secrets are involved. No new GitHub permissions are needed. Review this as a security interface prototype, not as evidence of a secure deployed identity/gateway system.
